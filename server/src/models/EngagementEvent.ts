import mongoose from 'mongoose';

export const ENGAGEMENT_TYPES = ['login', 'pageView', 'download', 'taskComplete', 'bannerClick'] as const;
export type EngagementType = (typeof ENGAGEMENT_TYPES)[number];

const engagementEventSchema = new mongoose.Schema({
  type: { type: String, enum: ENGAGEMENT_TYPES, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  meta: { type: mongoose.Schema.Types.Mixed, default: {} },
  createdAt: { type: Date, default: Date.now },
});
engagementEventSchema.index({ type: 1, createdAt: -1 });
engagementEventSchema.index({ userId: 1, createdAt: -1 });

export const EngagementEvent = mongoose.model('EngagementEvent', engagementEventSchema);
