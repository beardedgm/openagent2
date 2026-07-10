import { cancelPostPublish, schedulePostPublish } from '../config/agenda.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { Comment } from '../models/Comment.js';
import { Post, type PostDoc } from '../models/Post.js';
import { User, type UserDoc } from '../models/User.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { importantPostEmail } from './emailService.js';
import { notify } from './notificationService.js';

const MAX_PINNED = 3;

export interface PostInput {
  title?: string;
  bodyHtml?: string;
  officeId?: string | null;
  important?: boolean;
  commentsEnabled?: boolean;
  publishAt?: string;
}

export async function createPost(input: PostInput, author: UserDoc): Promise<PostDoc> {
  const post = await Post.create({
    title: input.title,
    bodyHtml: sanitizePostHtml(input.bodyHtml ?? ''),
    bodyText: htmlToText(input.bodyHtml ?? ''),
    authorId: author.id,
    officeId: input.officeId ?? null,
    important: input.important ?? false,
    commentsEnabled: input.commentsEnabled ?? true,
    publishAt: input.publishAt ? new Date(input.publishAt) : new Date(),
  });
  await announceOrSchedule(post);
  return post;
}

export async function updatePost(id: string, input: PostInput): Promise<PostDoc> {
  const post = await Post.findById(id);
  if (!post) throw new AppError(404, 'Post not found');
  if (input.title !== undefined) post.title = input.title;
  if (input.bodyHtml !== undefined) {
    post.bodyHtml = sanitizePostHtml(input.bodyHtml);
    post.bodyText = htmlToText(input.bodyHtml);
  }
  if (input.officeId !== undefined) post.officeId = (input.officeId ?? null) as never;
  if (input.important !== undefined) post.important = input.important;
  if (input.commentsEnabled !== undefined) post.commentsEnabled = input.commentsEnabled;
  // Rescheduling only makes sense before the post was announced.
  if (input.publishAt !== undefined && !post.notifiedAt) post.publishAt = new Date(input.publishAt);
  await post.save();
  if (!post.notifiedAt) await announceOrSchedule(post);
  return post;
}

export async function deletePost(id: string): Promise<void> {
  const post = await Post.findByIdAndDelete(id);
  if (!post) throw new AppError(404, 'Post not found');
  await Comment.deleteMany({ postId: id });
  await cancelPostPublish(id);
}

export async function setPinned(id: string, pinned: boolean): Promise<PostDoc> {
  const post = await Post.findById(id);
  if (!post) throw new AppError(404, 'Post not found');
  if (pinned && !post.pinnedAt) {
    const pinnedCount = await Post.countDocuments({ pinnedAt: { $ne: null } });
    if (pinnedCount >= MAX_PINNED) throw new AppError(400, 'Maximum of 3 pinned posts — unpin one first');
    post.pinnedAt = new Date();
  }
  if (!pinned) post.pinnedAt = null;
  await post.save();
  return post;
}

async function announceOrSchedule(post: PostDoc): Promise<void> {
  if (post.publishAt <= new Date()) {
    await publishPostSideEffects(post.id);
    // publishPostSideEffects re-fetches its own document, so sync the caller's
    // in-memory copy — the guard above guarantees the update just succeeded.
    post.notifiedAt = new Date();
  } else {
    await schedulePostPublish(post.id, post.publishAt);
  }
}

/** Idempotent: the notifiedAt latch is claimed atomically, so job retries,
 * reschedule races, and double calls announce exactly once. */
export async function publishPostSideEffects(postId: string): Promise<void> {
  const post = await Post.findOneAndUpdate(
    { _id: postId, notifiedAt: null, publishAt: { $lte: new Date() } },
    { $set: { notifiedAt: new Date() } },
  );
  if (!post) return; // already announced, deleted, or not yet due
  await emitActivity({
    type: 'announcementPosted',
    message: `New announcement: ${post.title}`,
    link: `/board/${post.id}`,
    officeId: post.officeId ? String(post.officeId) : null,
    actorId: String(post.authorId),
  });
  const recipients = await User.find({
    status: 'active',
    role: { $in: ['broker', 'officeAdmin', 'agent'] },
    _id: { $ne: post.authorId },
    ...(post.officeId
      ? { $or: [{ officeId: post.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
      : {}),
  }).select('_id');
  await notify(
    recipients.map((r) => String(r._id)),
    { type: 'postPublished', title: `New announcement: ${post.title}`, link: `/board/${post.id}` },
    post.important ? importantPostEmail(post.title, `${env.APP_DOMAIN}/board/${post.id}`) : undefined,
  );
}
