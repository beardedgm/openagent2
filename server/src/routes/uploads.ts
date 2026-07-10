import { Router } from 'express';
import multer from 'multer';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { getSettings } from '../models/Settings.js';
import { makeKey, storage } from '../services/storage.js';

const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

function requireImage(file?: Express.Multer.File): Express.Multer.File {
  if (!file) throw new AppError(400, 'File is required');
  if (!IMAGE_TYPES.has(file.mimetype)) throw new AppError(400, 'Only PNG, JPEG, or WebP images are allowed');
  return file;
}

export const uploadsRouter = Router();
uploadsRouter.use(requireAuth);

uploadsRouter.post(
  '/logo',
  requireRole('broker'),
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('logo', file.originalname), file.buffer, file.mimetype);
    const settings = await getSettings();
    settings.logoUrl = url;
    await settings.save();
    res.json({ url });
  }),
);

uploadsRouter.post(
  '/avatar',
  upload.single('file'),
  asyncHandler(async (req, res) => {
    const file = requireImage(req.file);
    const url = await storage.putPublic(makeKey('avatars', file.originalname), file.buffer, file.mimetype);
    req.user!.photoUrl = url;
    await req.user!.save();
    res.json({ url });
  }),
);
