import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { ActivityEvent } from '../models/ActivityEvent.js';
import { getFeed, type FeedFilter } from '../services/feedService.js';

const PIN_DAYS = 7;

export const feedRouter = Router();
feedRouter.use(requireAuth);

feedRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const filter: FeedFilter =
      req.query.filter === 'internal' || req.query.filter === 'external' ? req.query.filter : 'all';
    const raw = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    const before = raw && !Number.isNaN(raw.getTime()) ? raw : null;
    res.json(await getFeed(req.user!, filter, before));
  }),
);

feedRouter.post(
  '/:id/pin',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    const item = await ActivityEvent.findByIdAndUpdate(
      req.params.id,
      { $set: { pinnedUntil: new Date(Date.now() + PIN_DAYS * 86_400_000) } },
      { new: true },
    );
    if (!item) throw new AppError(404, 'Feed item not found');
    res.json({ item: { id: item.id, pinnedUntil: item.pinnedUntil } });
  }),
);

feedRouter.delete(
  '/:id/pin',
  requireRole('broker'),
  asyncHandler(async (req, res) => {
    const item = await ActivityEvent.findByIdAndUpdate(req.params.id, { $set: { pinnedUntil: null } }, { new: true });
    if (!item) throw new AppError(404, 'Feed item not found');
    res.json({ item: { id: item.id, pinnedUntil: item.pinnedUntil } });
  }),
);
