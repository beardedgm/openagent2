import mongoose from 'mongoose';

// Stage 4 adds bookmarkedResource — extend this enum, never hardcode strings.
export const NOTIFICATION_TYPES = [
  'invitationAccepted',
  'postPublished',
  'taskAssigned',
  'taskDueSoon',
  'taskOverdue',
  'mandatoryEvent',
  'bookmarkedResource',
] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: NOTIFICATION_TYPES, required: true },
    title: { type: String, required: true },
    link: { type: String, default: '' },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);
notificationSchema.index({ userId: 1, createdAt: -1 });
notificationSchema.index({ userId: 1, readAt: 1 });

export const Notification = mongoose.model('Notification', notificationSchema);
export type NotificationDoc = InstanceType<typeof Notification>;

export function toPublicNotification(n: NotificationDoc) {
  return {
    id: n.id as string,
    type: n.type,
    title: n.title,
    link: n.link,
    readAt: n.readAt,
    createdAt: n.get('createdAt') as Date,
  };
}
