import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Banner, toPublicBanner } from '../models/Banner.js';
import { activeBannersFor, createBanner, duplicateBanner, updateBanner } from '../services/bannerService.js';
import { logEngagement } from '../services/engagementService.js';
import { createBannerSchema, updateBannerSchema } from '../validators/banners.js';

export const bannersRouter = Router();
bannersRouter.use(requireAuth);

// Declared before '/:id' routes; every user reads the homepage slot from here.
bannersRouter.get(
  '/active',
  asyncHandler(async (req, res) => {
    const banners = await activeBannersFor(req.user!);
    res.json({ banners: banners.map(toPublicBanner) });
  }),
);

bannersRouter.post(
  '/:id/click',
  asyncHandler(async (req, res) => {
    // Gated like /active: only banners the viewer can actually see are clickable,
    // so clickCount/engagement cannot be inflated for hidden or expired banners.
    const now = new Date();
    const banner = await Banner.findOneAndUpdate(
      {
        _id: req.params.id,
        startAt: { $lte: now },
        endAt: { $gte: now },
        $or: [{ officeId: null }, { officeId: req.user!.officeId }],
      },
      { $inc: { clickCount: 1 } },
    );
    if (!banner) throw new AppError(404, 'Banner not found');
    logEngagement('bannerClick', req.user!.id, { bannerId: banner.id });
    res.json({ ok: true });
  }),
);

bannersRouter.get(
  '/',
  requireRole('officeAdmin'),
  asyncHandler(async (_req, res) => {
    const banners = await Banner.find().sort({ startAt: -1 });
    res.json({ banners: banners.map(toPublicBanner) });
  }),
);

bannersRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createBannerSchema),
  asyncHandler(async (req, res) => {
    const banner = await createBanner(req.body, req.user!);
    res.status(201).json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.post(
  '/:id/duplicate',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const banner = await duplicateBanner(req.params.id, req.user!);
    res.status(201).json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.patch(
  '/:id',
  requireRole('officeAdmin'),
  validate(updateBannerSchema),
  asyncHandler(async (req, res) => {
    const banner = await updateBanner(req.params.id, req.body);
    res.json({ banner: toPublicBanner(banner) });
  }),
);

bannersRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const banner = await Banner.findByIdAndDelete(req.params.id);
    if (!banner) throw new AppError(404, 'Banner not found');
    res.json({ ok: true });
  }),
);
