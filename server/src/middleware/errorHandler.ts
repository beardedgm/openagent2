import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';
import multer from 'multer';
import { ZodError } from 'zod';
import { logger } from '../config/logger.js';

export class AppError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Not found' });
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 5MB)' : 'Upload failed',
    });
    return;
  }
  // Document-level cast failures (e.g. a bad ObjectId set on a field) surface as a
  // ValidationError wrapping CastErrors, so treat both as a client error.
  if (
    err instanceof mongoose.Error.CastError ||
    (err instanceof mongoose.Error.ValidationError &&
      Object.values(err.errors).some((e) => e instanceof mongoose.Error.CastError))
  ) {
    res.status(400).json({ error: 'Invalid identifier' });
    return;
  }
  if (err instanceof ZodError) {
    res.status(400).json({
      error: 'Validation failed',
      issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
    return;
  }
  logger.error(err);
  res.status(500).json({ error: 'Internal server error' });
}
