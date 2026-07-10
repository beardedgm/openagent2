import type { NextFunction, Request, Response } from 'express';
import { ROLE_RANK, User, type Role, type UserDoc } from '../models/User.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserDoc;
    }
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const userId = req.session.userId;
    if (!userId) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    const user = await User.findById(userId);
    if (!user || user.status !== 'active' || ROLE_RANK[user.role as Role] < 1) {
      req.session.destroy(() => {});
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireRole(minRole: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user || ROLE_RANK[req.user.role as Role] < ROLE_RANK[minRole]) {
      res.status(403).json({ error: 'Insufficient permissions' });
      return;
    }
    next();
  };
}
