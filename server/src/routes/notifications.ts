import { Router } from 'express';
import mongoose from 'mongoose';
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
    // Compound (createdAt, _id) cursor — "<ISO date>|<id>" — so same-millisecond
    // rows straddling a page boundary are never skipped. Malformed cursors are
    // ignored and the first page is served.
    if (typeof req.query.before === 'string') {
      const sep = req.query.before.indexOf('|');
      const beforeDate = sep > 0 ? new Date(req.query.before.slice(0, sep)) : null;
      const beforeId = sep > 0 ? req.query.before.slice(sep + 1) : '';
      if (
        beforeDate &&
        !Number.isNaN(beforeDate.getTime()) &&
        mongoose.Types.ObjectId.isValid(beforeId)
      ) {
        filter.$or = [
          { createdAt: { $lt: beforeDate } },
          { createdAt: beforeDate, _id: { $lt: beforeId } },
        ];
      }
    }
    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).limit(PAGE_SIZE),
      Notification.countDocuments({ userId, readAt: null }),
    ]);
    const last = notifications.length === PAGE_SIZE ? notifications[notifications.length - 1] : null;
    res.json({
      notifications: notifications.map(toPublicNotification),
      unreadCount,
      nextCursor: last ? `${(last.get('createdAt') as Date).toISOString()}|${last.id as string}` : null,
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
