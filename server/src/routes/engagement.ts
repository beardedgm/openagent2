import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { logEngagement } from '../services/engagementService.js';

const pageViewSchema = z.object({ path: z.string().min(1).max(300) });

export const engagementRouter = Router();
engagementRouter.use(requireAuth);

engagementRouter.post('/page-view', validate(pageViewSchema), (req, res) => {
  logEngagement('pageView', req.user!.id, { path: req.body.path });
  res.status(204).end();
});
