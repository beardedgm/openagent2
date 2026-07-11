import { AppError } from '../middleware/errorHandler.js';
import { Banner, type BannerDoc } from '../models/Banner.js';
import type { UserDoc } from '../models/User.js';
import { sanitizePostHtml } from '../utils/sanitizeHtml.js';

export interface BannerInput {
  kind: 'image' | 'text';
  title: string;
  imageUrl?: string;
  bodyHtml?: string;
  ctaLabel?: string;
  ctaUrl?: string;
  officeId?: string | null;
  startAt: Date;
  endAt: Date;
}

function assertScheduleOrder(startAt: Date, endAt: Date): void {
  if (endAt <= startAt) throw new AppError(400, 'The end date must be after the start date');
}

export async function createBanner(input: BannerInput, creator: UserDoc): Promise<BannerDoc> {
  assertScheduleOrder(input.startAt, input.endAt);
  const bodyHtml = sanitizePostHtml(input.bodyHtml ?? '');
  if (input.kind === 'text' && !bodyHtml) throw new AppError(400, 'Text banners need content');
  if (input.kind === 'image' && !input.imageUrl) throw new AppError(400, 'Image banners need an image');
  return Banner.create({ ...input, bodyHtml, createdBy: creator.id });
}

export async function updateBanner(id: string, patch: Partial<BannerInput>): Promise<BannerDoc> {
  const banner = await Banner.findById(id);
  if (!banner) throw new AppError(404, 'Banner not found');
  if (patch.title !== undefined) banner.title = patch.title;
  if (patch.imageUrl !== undefined) banner.imageUrl = patch.imageUrl;
  if (patch.bodyHtml !== undefined) banner.bodyHtml = sanitizePostHtml(patch.bodyHtml);
  if (patch.ctaLabel !== undefined) banner.ctaLabel = patch.ctaLabel;
  if (patch.ctaUrl !== undefined) banner.ctaUrl = patch.ctaUrl;
  if (patch.officeId !== undefined) banner.officeId = (patch.officeId ?? null) as never;
  if (patch.startAt !== undefined) banner.startAt = patch.startAt;
  if (patch.endAt !== undefined) banner.endAt = patch.endAt;
  assertScheduleOrder(banner.startAt, banner.endAt);
  if (banner.kind === 'text' && !banner.bodyHtml) throw new AppError(400, 'Text banners need content');
  if (banner.kind === 'image' && !banner.imageUrl) throw new AppError(400, 'Image banners need an image');
  await banner.save();
  return banner;
}

/** Homepage slot: live now + targeted at this viewer's office (or everyone). */
export async function activeBannersFor(user: UserDoc): Promise<BannerDoc[]> {
  const now = new Date();
  return Banner.find({
    startAt: { $lte: now },
    endAt: { $gte: now },
    $or: [{ officeId: null }, { officeId: user.officeId }],
  }).sort({ startAt: 1 });
}

/** PRD 5.5: "duplicated and rescheduled" — the copy keeps the schedule; the admin edits it next. */
export async function duplicateBanner(id: string, creator: UserDoc): Promise<BannerDoc> {
  const banner = await Banner.findById(id);
  if (!banner) throw new AppError(404, 'Banner not found');
  return Banner.create({
    kind: banner.kind,
    title: `${banner.title} (copy)`.slice(0, 120),
    imageUrl: banner.imageUrl,
    bodyHtml: banner.bodyHtml,
    ctaLabel: banner.ctaLabel,
    ctaUrl: banner.ctaUrl,
    officeId: banner.officeId,
    startAt: banner.startAt,
    endAt: banner.endAt,
    createdBy: creator.id,
  });
}
