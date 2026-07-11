import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Bookmark } from '../models/Bookmark.js';
import { Resource, toPublicResource, type ResourceDoc } from '../models/Resource.js';
import { createResource, deleteResource, setFeatured, updateResource } from '../services/resourceService.js';
import { createResourceSchema, updateResourceSchema } from '../validators/resources.js';

const PAGE_SIZE = 20;

export const resourcesRouter = Router();
resourcesRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Agents: all-users or own office, and file resources only once a file exists
 * (metadata is created before the upload — see resourceService.announceResource).
 * Admins: everything. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  if (isAdmin(me.role)) return {};
  return {
    $and: [
      { $or: [{ officeId: null }, { officeId: me.officeId }] },
      { $or: [{ kind: 'link' }, { 'versions.0': { $exists: true } }] },
    ],
  };
}

export async function loadVisibleResource(req: Request): Promise<ResourceDoc> {
  const resource = await Resource.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!resource) throw new AppError(404, 'Resource not found');
  return resource;
}

/** Adds the viewer's `bookmarked` flag to mapped resources in one query. */
async function withBookmarks(docs: ResourceDoc[], userId: string, includeVersions: boolean) {
  const marked = new Set(
    (await Bookmark.find({ userId, resourceId: { $in: docs.map((d) => d.id) } })).map((b) => String(b.resourceId)),
  );
  return docs.map((d) => ({ ...toPublicResource(d, includeVersions), bookmarked: marked.has(d.id) }));
}

resourcesRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const clauses: Record<string, unknown>[] = [visibilityFilter(req)];
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    if (q) clauses.push({ $text: { $search: q } });
    if (typeof req.query.categoryId === 'string' && req.query.categoryId) {
      // A top-level category folds in its subcategories' resources.
      clauses.push({ $or: [{ categoryId: req.query.categoryId }, { subcategoryId: req.query.categoryId }] });
    }
    if (typeof req.query.fileType === 'string' && req.query.fileType) clauses.push({ fileType: req.query.fileType });
    if (req.query.scope === 'mine') {
      const mine = await Bookmark.find({ userId: me.id }).distinct('resourceId');
      clauses.push({ _id: { $in: mine } });
    }
    const filter = { $and: clauses };
    const [docs, total] = await Promise.all([
      Resource.find(filter).sort({ createdAt: -1 }).skip((page - 1) * PAGE_SIZE).limit(PAGE_SIZE),
      Resource.countDocuments(filter),
    ]);
    res.json({ resources: await withBookmarks(docs, me.id, isAdmin(me.role)), total, page });
  }),
);

resourcesRouter.get(
  '/featured',
  asyncHandler(async (req, res) => {
    const docs = await Resource.find({ featured: true, ...visibilityFilter(req) }).sort({ updatedAt: -1 }).limit(6);
    res.json({ resources: await withBookmarks(docs, req.user!.id, isAdmin(req.user!.role)) });
  }),
);

resourcesRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    const [mapped] = await withBookmarks([resource], req.user!.id, isAdmin(req.user!.role));
    res.json({ resource: mapped });
  }),
);

resourcesRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createResourceSchema),
  asyncHandler(async (req, res) => {
    const resource = await createResource(req.body, req.user!);
    res.status(201).json({ resource: { ...toPublicResource(resource, true), bookmarked: false } });
  }),
);

resourcesRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateResourceSchema),
  asyncHandler(async (req, res) => {
    const resource = await updateResource(req.params.id, req.body);
    const [mapped] = await withBookmarks([resource], req.user!.id, true);
    res.json({ resource: mapped });
  }),
);

resourcesRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    await deleteResource(req.params.id);
    res.json({ ok: true });
  }),
);

// PRD 5.6: "Broker/Owner marks up to 6 resources as Featured" — broker-only, unlike CRUD.
resourcesRouter.post(
  '/:id/featured',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    await setFeatured(req.params.id, true);
    res.json({ ok: true });
  }),
);

resourcesRouter.delete(
  '/:id/featured',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    await setFeatured(req.params.id, false);
    res.json({ ok: true });
  }),
);

resourcesRouter.post(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    const resource = await loadVisibleResource(req);
    await Bookmark.updateOne(
      { userId: req.user!.id, resourceId: resource.id },
      { $setOnInsert: { userId: req.user!.id, resourceId: resource.id } },
      { upsert: true },
    );
    res.json({ bookmarked: true });
  }),
);

resourcesRouter.delete(
  '/:id/bookmark',
  asyncHandler(async (req, res) => {
    await Bookmark.deleteOne({ userId: req.user!.id, resourceId: req.params.id });
    res.json({ bookmarked: false });
  }),
);
