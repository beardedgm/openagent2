import { z } from 'zod';

export const inviteSchema = z.object({
  email: z.string().trim().max(254).email(),
  role: z.enum(['broker', 'officeAdmin', 'agent']),
  officeId: z.string().nullable().optional(),
});

export const updateUserSchema = z.object({
  displayName: z.string().min(1).max(80).optional(),
  phone: z.string().max(30).optional(),
  bio: z.string().max(1000).optional(),
  emailPrefs: z.record(z.boolean()).optional(),
  role: z.enum(['broker', 'officeAdmin', 'agent']).optional(),
  officeId: z.string().nullable().optional(),
});
