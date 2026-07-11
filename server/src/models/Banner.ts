import mongoose from 'mongoose';

const bannerSchema = new mongoose.Schema(
  {
    kind: { type: String, enum: ['image', 'text'], required: true },
    title: { type: String, required: true, trim: true, maxlength: 120 },
    imageUrl: { type: String, default: '' }, // public URL from the uploads route (image banners)
    bodyHtml: { type: String, default: '' }, // sanitized server-side (text banners)
    ctaLabel: { type: String, default: '', maxlength: 40 },
    ctaUrl: { type: String, default: '' },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Denormalized for the admin list; EngagementEvent is the analytical record.
    clickCount: { type: Number, default: 0 },
  },
  { timestamps: true },
);
bannerSchema.index({ startAt: 1, endAt: 1 });

export const Banner = mongoose.model('Banner', bannerSchema);
export type BannerDoc = InstanceType<typeof Banner>;

export function toPublicBanner(b: BannerDoc) {
  return {
    id: b.id as string,
    kind: b.kind,
    title: b.title,
    imageUrl: b.imageUrl,
    bodyHtml: b.bodyHtml,
    ctaLabel: b.ctaLabel,
    ctaUrl: b.ctaUrl,
    officeId: b.officeId,
    startAt: b.startAt,
    endAt: b.endAt,
    clickCount: b.clickCount,
    createdAt: b.get('createdAt') as Date,
  };
}
