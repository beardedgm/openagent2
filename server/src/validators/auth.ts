import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().trim().max(254).email(),
  password: z.string().min(1),
  turnstileToken: z.string().optional(),
});

export const registerSchema = z.object({
  token: z.string().min(1),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  displayName: z.string().min(1).max(80),
  turnstileToken: z.string().optional(),
});
