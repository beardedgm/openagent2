import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Post, toPublicPost, type PostDoc } from '../models/Post.js';
import { createPost, deletePost, setPinned, updatePost } from '../services/postService.js';
import { createPostSchema, updatePostSchema } from '../validators/posts.js';

const PAGE_SIZE = 20;
const AUTHOR_FIELDS = 'displayName photoUrl';

export const postsRouter = Router();
postsRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Agents: published + (all-users or own office). Admins: everything. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  if (isAdmin(me.role)) return {};
  return {
    publishAt: { $lte: new Date() },
    $or: [{ officeId: null }, { officeId: me.officeId }],
  };
}

async function loadVisiblePost(req: Request): Promise<PostDoc> {
  const post = await Post.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!post) throw new AppError(404, 'Post not found');
  return post;
}

postsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const page = Math.max(1, Number(req.query.page) || 1);
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const filter: Record<string, unknown> = visibilityFilter(req);
    if (q) filter.$text = { $search: q };
    const [posts, total] = await Promise.all([
      Post.find(filter)
        .sort({ pinnedAt: -1, publishAt: -1 })
        .skip((page - 1) * PAGE_SIZE)
        .limit(PAGE_SIZE)
        .populate('authorId', AUTHOR_FIELDS),
      Post.countDocuments(filter),
    ]);
    res.json({ posts: posts.map(toPublicPost), total, page });
  }),
);

postsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const post = await loadVisiblePost(req);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createPostSchema),
  asyncHandler(async (req, res) => {
    const post = await createPost(req.body, req.user!);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.status(201).json({ post: toPublicPost(post) });
  }),
);

postsRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updatePostSchema),
  asyncHandler(async (req, res) => {
    const post = await updatePost(req.params.id, req.body);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    await deletePost(req.params.id);
    res.json({ ok: true });
  }),
);

postsRouter.post(
  '/:id/pin',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const post = await setPinned(req.params.id, true);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);

postsRouter.delete(
  '/:id/pin',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const post = await setPinned(req.params.id, false);
    await post.populate('authorId', AUTHOR_FIELDS);
    res.json({ post: toPublicPost(post) });
  }),
);
