import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { getSettings } from '../models/Settings.js';
import { TaskTemplate } from '../models/TaskTemplate.js';
import { sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { updateSettingsSchema } from '../validators/settings.js';

export const settingsRouter = Router();

settingsRouter.get(
  '/public',
  asyncHandler(async (_req, res) => {
    const s = await getSettings();
    res.json({ settings: { brandName: s.brandName, logoUrl: s.logoUrl, primaryColor: s.primaryColor } });
  }),
);

settingsRouter.get(
  '/',
  requireAuth,
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings() });
  }),
);

export const adminSettingsRouter = Router();
adminSettingsRouter.use(requireAuth, requireRole('broker'));

adminSettingsRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ settings: await getSettings() });
  }),
);

adminSettingsRouter.patch(
  '/',
  validate(updateSettingsSchema),
  asyncHandler(async (req, res) => {
    if (req.body.onboardingTaskTemplateId != null) {
      if (!(await TaskTemplate.findById(req.body.onboardingTaskTemplateId))) {
        throw new AppError(400, 'Unknown task template');
      }
    }
    if (typeof req.body.welcomeMessage === 'string') {
      // Welcome message renders as rich HTML on the dashboard — same trust boundary as post bodies.
      req.body.welcomeMessage = sanitizePostHtml(req.body.welcomeMessage);
    }
    const s = await getSettings();
    Object.assign(s, req.body);
    await s.save();
    res.json({ settings: s });
  }),
);
