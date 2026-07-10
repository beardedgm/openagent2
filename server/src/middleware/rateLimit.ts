import type { NextFunction, Request, Response } from 'express';
import mongoose from 'mongoose';

const hitSchema = new mongoose.Schema({
  key: { type: String, required: true, index: true },
  createdAt: { type: Date, default: Date.now, expires: 3600 },
});

export const RateLimitHit = mongoose.model('RateLimitHit', hitSchema);

export interface RateLimitOptions {
  name: string;
  max: number;
  windowMs: number;
  keyFn?: (req: Request) => string;
}

export function rateLimit(opts: RateLimitOptions) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const key = `${opts.name}:${opts.keyFn ? opts.keyFn(req) : (req.ip ?? 'unknown')}`;
      const since = new Date(Date.now() - opts.windowMs);
      const count = await RateLimitHit.countDocuments({ key, createdAt: { $gt: since } });
      if (count >= opts.max) {
        res.status(429).json({ error: 'Too many requests. Try again later.' });
        return;
      }
      await RateLimitHit.create({ key });
      next();
    } catch (err) {
      next(err);
    }
  };
}
