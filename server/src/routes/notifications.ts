import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { Notification, toPublicNotification } from '../models/Notification.js';

const PAGE_SIZE = 20;

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const userId = req.user!.id;
    const filter: Record<string, unknown> = { userId };
    const before = typeof req.query.before === 'string' ? new Date(req.query.before) : null;
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before };
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1 }).limit(PAGE_SIZE),
      Notification.countDocuments({ userId, readAt: null }),
    ]);
    res.json({
      notifications: notifications.map(toPublicNotification),
      unreadCount,
      nextCursor:
        notifications.length === PAGE_SIZE
          ? (notifications[notifications.length - 1].get('createdAt') as Date).toISOString()
          : null,
    });
  }),
);

notificationsRouter.post(
  '/:id/read',
  asyncHandler(async (req, res) => {
    const n = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user!.id },
      { $set: { readAt: new Date() } },
      { new: true },
    );
    if (!n) throw new AppError(404, 'Notification not found');
    res.json({ notification: toPublicNotification(n) });
  }),
);

notificationsRouter.post(
  '/read-all',
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user!.id, readAt: null }, { $set: { readAt: new Date() } });
    res.json({ ok: true });
  }),
);
