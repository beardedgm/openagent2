import { Router, type Request } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { Task, toPublicTask, type TaskDoc } from '../models/Task.js';
import { makeAttachmentKey, storage } from '../services/storage.js';
import { completeTask, createTask } from '../services/taskService.js';
import { completeTaskSchema, createTaskSchema } from '../validators/tasks.js';

export const tasksRouter = Router();
tasksRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

const attachmentUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 25 * 1024 * 1024 } });
const MAX_ATTACHMENTS = 5;
// Mimetype is client-asserted (multer reports the multipart header) — acceptable here:
// uploaders are trusted admins, downloads always force attachment disposition, and the
// allowlist excludes inline-renderable types (html/svg).
const ATTACHMENT_TYPES = new Set([
  'application/pdf',
  'image/png',
  'image/jpeg',
  'image/webp',
  'text/plain',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]);

/** Assignees, the creator, and admins can open a task; others see 404. */
async function loadVisibleTask(req: Request): Promise<TaskDoc> {
  const me = req.user!;
  const task = await Task.findById(req.params.id);
  if (!task) throw new AppError(404, 'Task not found');
  const assigned = task.completions.some((c) => String(c.userId) === me.id);
  if (!assigned && String(task.createdBy) !== me.id && !isAdmin(me.role)) throw new AppError(404, 'Task not found');
  return task;
}

tasksRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const scope = req.query.scope === 'all' ? 'all' : 'mine';
    if (scope === 'all' && !isAdmin(me.role)) throw new AppError(403, 'Insufficient permissions');
    const filter = scope === 'all' ? {} : { 'completions.userId': me.id };
    const tasks = await Task.find(filter).sort({ dueAt: 1, createdAt: -1 });
    res.json({ tasks: tasks.map((t) => toPublicTask(t, me.id)) });
  }),
);

tasksRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const me = req.user!;
    const task = await loadVisibleTask(req);
    const body: Record<string, unknown> = { task: toPublicTask(task, me.id) };
    if (String(task.createdBy) === me.id || isAdmin(me.role)) {
      await task.populate('completions.userId', 'displayName');
      body.matrix = task.completions.map((c) => ({
        userId: String((c.userId as unknown as { _id: unknown })._id ?? c.userId),
        displayName: (c.userId as unknown as { displayName?: string })?.displayName ?? 'Unknown',
        completedAt: c.completedAt,
        note: c.note,
      }));
    }
    res.json(body);
  }),
);

tasksRouter.post(
  '/',
  requireRole('officeAdmin'),
  validate(createTaskSchema),
  asyncHandler(async (req, res) => {
    const task = await createTask(req.body, { id: req.user!.id });
    res.status(201).json({ task: toPublicTask(task, req.user!.id) });
  }),
);

tasksRouter.post(
  '/:id/complete',
  validate(completeTaskSchema),
  asyncHandler(async (req, res) => {
    await loadVisibleTask(req);
    const task = await completeTask(req.params.id, req.user!, req.body.note ?? '', req.body.userId);
    res.json({ task: toPublicTask(task, req.body.userId ?? req.user!.id) });
  }),
);

tasksRouter.delete(
  '/:id',
  requireRole('officeAdmin'),
  asyncHandler(async (req, res) => {
    const task = await Task.findByIdAndDelete(req.params.id);
    if (!task) throw new AppError(404, 'Task not found');
    res.json({ ok: true });
  }),
);

tasksRouter.post(
  '/:id/attachments',
  requireRole('officeAdmin'),
  attachmentUpload.single('file'),
  asyncHandler(async (req, res) => {
    const task = await loadVisibleTask(req);
    const file = req.file;
    if (!file) throw new AppError(400, 'File is required');
    if (!ATTACHMENT_TYPES.has(file.mimetype)) throw new AppError(400, 'File type not allowed');
    if (task.attachments.length >= MAX_ATTACHMENTS) throw new AppError(400, 'Maximum of 5 attachments per task');
    const key = makeAttachmentKey('tasks', file.originalname);
    await storage.putPrivate(key, file.buffer, file.mimetype);
    task.attachments.push({
      key,
      name: file.originalname.slice(0, 120),
      size: file.size,
      contentType: file.mimetype,
    } as never);
    await task.save();
    res.status(201).json({ task: toPublicTask(task, req.user!.id) });
  }),
);

tasksRouter.get(
  '/:id/attachments/:index/download',
  asyncHandler(async (req, res) => {
    const task = await loadVisibleTask(req); // assignee/creator/admin — others 404
    const attachment = task.attachments[Number(req.params.index)];
    if (!attachment) throw new AppError(404, 'Attachment not found');
    const target = await storage.resolveDownload(attachment.key, attachment.name);
    if (target.kind === 'url') {
      res.redirect(302, target.url); // 15-minute presigned R2 URL
    } else {
      res.download(target.path, attachment.name);
    }
  }),
);
