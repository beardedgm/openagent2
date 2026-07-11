import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { TaskTemplate, toPublicTemplate } from '../models/TaskTemplate.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { templateSchema, updateTemplateSchema } from '../validators/tasks.js';

export const taskTemplatesRouter = Router();
taskTemplatesRouter.use(requireAuth, requireRole('broker'));

type ItemInput = { title: string; descriptionHtml?: string; priority?: string; dueInDays?: number | null };

function sanitizeItems(items: ItemInput[]) {
  return items.map((i) => ({
    title: i.title,
    descriptionHtml: sanitizePostHtml(i.descriptionHtml ?? ''),
    descriptionText: htmlToText(i.descriptionHtml ?? ''),
    priority: i.priority ?? 'Medium',
    dueInDays: i.dueInDays ?? null,
  }));
}

taskTemplatesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    const templates = await TaskTemplate.find().sort({ name: 1 });
    res.json({ templates: templates.map(toPublicTemplate) });
  }),
);

taskTemplatesRouter.post(
  '/',
  validate(templateSchema),
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.create({ name: req.body.name, items: sanitizeItems(req.body.items) });
    res.status(201).json({ template: toPublicTemplate(tpl) });
  }),
);

taskTemplatesRouter.patch(
  '/:id',
  validate(updateTemplateSchema),
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.findById(req.params.id);
    if (!tpl) throw new AppError(404, 'Template not found');
    if (req.body.name !== undefined) tpl.name = req.body.name;
    if (req.body.items !== undefined) tpl.items = sanitizeItems(req.body.items) as never;
    await tpl.save();
    res.json({ template: toPublicTemplate(tpl) });
  }),
);

taskTemplatesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const tpl = await TaskTemplate.findByIdAndDelete(req.params.id);
    if (!tpl) throw new AppError(404, 'Template not found');
    res.json({ ok: true });
  }),
);
