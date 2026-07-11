import mongoose from 'mongoose';

// Stage 4 appends resourceUploaded.
export const ACTIVITY_TYPES = [
  'agentJoined',
  'announcementPosted',
  'taskAssigned',
  'taskCompleted',
  'eventCreated',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

const activityEventSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ACTIVITY_TYPES, required: true },
    message: { type: String, required: true },
    link: { type: String, default: '' },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // When set, the event is visible ONLY to this user (e.g. "you completed task X").
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    actorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    pinnedUntil: { type: Date, default: null },
  },
  { timestamps: true },
);
activityEventSchema.index({ createdAt: -1 });
activityEventSchema.index({ pinnedUntil: 1 });

export const ActivityEvent = mongoose.model('ActivityEvent', activityEventSchema);
export type ActivityEventDoc = InstanceType<typeof ActivityEvent>;
