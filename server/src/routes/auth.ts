import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import { toPublicUser } from '../models/User.js';
import { login, logout, register } from '../services/authService.js';
import { loginSchema, registerSchema } from '../validators/auth.js';

export const authRouter = Router();

const authLimiter = rateLimit({ name: 'auth', max: 30, windowMs: 15 * 60 * 1000 });

const loginEmailLimiter = rateLimit({
  name: 'authEmail',
  max: 10,
  windowMs: 15 * 60 * 1000,
  keyFn: (req) => String((req.body as { email?: string })?.email ?? '').toLowerCase(),
});

authRouter.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  loginEmailLimiter,
  asyncHandler(async (req, res) => {
    const user = await login(req, req.body);
    res.json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  asyncHandler(async (req, res) => {
    const user = await register(req, req.body);
    res.status(201).json({ user: toPublicUser(user) });
  }),
);

authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await logout(req);
    res.json({ ok: true });
  }),
);

authRouter.get('/me', requireAuth, (req, res) => {
  res.json({ user: toPublicUser(req.user!) });
});
