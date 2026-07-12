import { AppError } from '../middleware/errorHandler.js';
import { Bookmark } from '../models/Bookmark.js';
import { Category } from '../models/Category.js';
import { Resource, type ResourceDoc } from '../models/Resource.js';
import { Task } from '../models/Task.js';
import { User, type UserDoc } from '../models/User.js';
import { emitActivity } from './activityService.js';
import { notify } from './notificationService.js';

const MAX_FEATURED = 6;

export interface ResourceInput {
  title: string;
  description?: string;
  kind: 'file' | 'link';
  externalUrl?: string;
  categoryId: string;
  subcategoryId?: string | null;
  officeId?: string | null;
}

/** Category must exist and be top-level; subcategory (if any) must be its child. */
async function assertCategoryPair(categoryId: string, subcategoryId?: string | null): Promise<void> {
  const category = await Category.findById(categoryId);
  if (!category || category.parentId) throw new AppError(400, 'Pick a top-level category');
  if (subcategoryId) {
    const sub = await Category.findById(subcategoryId);
    if (!sub || String(sub.parentId) !== categoryId) {
      throw new AppError(400, 'That subcategory does not belong to the chosen category');
    }
  }
}

/** Notification (PRD 5.9.2, locked interpretation: users who bookmarked any resource in
 * this category) + feed entry. Called at create for links, at FIRST file upload for files
 * — a file resource with no file yet is invisible to agents, so announcing it would 404. */
export async function announceResource(resource: ResourceDoc, actorId: string): Promise<void> {
  const categoryPeers = await Resource.find({ categoryId: resource.categoryId, _id: { $ne: resource.id } }).distinct('_id');
  let userIds = (await Bookmark.distinct('userId', { resourceId: { $in: categoryPeers } }))
    .map(String)
    .filter((id) => id !== actorId);
  if (resource.officeId && userIds.length > 0) {
    // Office-targeted resources must not announce outside their audience (PRD 5.6:
    // agents see only resources they're authorized to access).
    const audience = await User.find({
      _id: { $in: userIds },
      $or: [{ officeId: resource.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }],
    }).distinct('_id');
    userIds = audience.map(String);
  }
  const category = await Category.findById(resource.categoryId);
  await notify(
    userIds,
    { type: 'bookmarkedResource', title: `New resource in ${category?.name ?? 'a category you follow'}: ${resource.title}`, link: `/resources/${resource.id}` },
    {
      subject: `New resource: ${resource.title}`,
      html: `<p>A new resource was added to <strong>${category?.name ?? 'a category you follow'}</strong>: ${resource.title}.</p><p>Open the Resource Hub to view it.</p>`,
    },
  );
  await emitActivity({
    type: 'resourceUploaded',
    message: `New resource: ${resource.title}`,
    link: `/resources/${resource.id}`,
    officeId: resource.officeId ? String(resource.officeId) : null,
    actorId,
  });
}

export async function createResource(input: ResourceInput, creator: UserDoc): Promise<ResourceDoc> {
  await assertCategoryPair(input.categoryId, input.subcategoryId);
  if (input.kind === 'link' && !input.externalUrl) throw new AppError(400, 'Link resources need a URL');
  const resource = await Resource.create({
    title: input.title,
    description: input.description ?? '',
    kind: input.kind,
    externalUrl: input.kind === 'link' ? input.externalUrl : '',
    fileType: input.kind === 'link' ? 'link' : 'other',
    categoryId: input.categoryId,
    subcategoryId: input.subcategoryId ?? null,
    uploadedBy: creator.id,
    officeId: input.officeId ?? null,
  });
  if (resource.kind === 'link') await announceResource(resource, creator.id);
  return resource;
}

export async function updateResource(id: string, patch: Partial<ResourceInput>): Promise<ResourceDoc> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  const categoryId = patch.categoryId ?? String(resource.categoryId);
  const subcategoryId = patch.subcategoryId !== undefined ? patch.subcategoryId : resource.subcategoryId ? String(resource.subcategoryId) : null;
  await assertCategoryPair(categoryId, subcategoryId);
  if (patch.title !== undefined) resource.title = patch.title;
  if (patch.description !== undefined) resource.description = patch.description;
  if (patch.externalUrl !== undefined && resource.kind === 'link') resource.externalUrl = patch.externalUrl;
  resource.categoryId = categoryId as never;
  resource.subcategoryId = subcategoryId as never;
  if (patch.officeId !== undefined) resource.officeId = (patch.officeId ?? null) as never;
  await resource.save();
  return resource;
}

/** PRD 5.6: at most 6 featured at any time. Same read-then-write shape as post pinning —
 * fine for a single-instance app. */
export async function setFeatured(id: string, featured: boolean): Promise<ResourceDoc> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  if (featured && !resource.featured) {
    const count = await Resource.countDocuments({ featured: true });
    if (count >= MAX_FEATURED) throw new AppError(400, `Up to ${MAX_FEATURED} resources can be featured — unfeature one first`);
  }
  resource.featured = featured;
  await resource.save();
  return resource;
}

/** Bookmarks go with the resource. Stored version files are retained (PRD: indefinitely). */
export async function deleteResource(id: string): Promise<void> {
  const resource = await Resource.findById(id);
  if (!resource) throw new AppError(404, 'Resource not found');
  await Bookmark.deleteMany({ resourceId: resource.id });
  // Clear dangling task links — a dangling relatedResourceId would 400 the existence
  // guard in createTask and silently kill future recurring-task spawns.
  await Task.updateMany({ relatedResourceId: resource.id }, { $set: { relatedResourceId: null } });
  await resource.deleteOne();
}
