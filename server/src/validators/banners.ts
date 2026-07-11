import { z } from 'zod';

export const createBannerSchema = z.object({
  kind: z.enum(['image', 'text']),
  title: z.string().trim().min(1).max(120),
  imageUrl: z.string().max(500).optional(),
  bodyHtml: z.string().max(5000).optional(),
  ctaLabel: z.string().max(40).optional(),
  // Absolute web URL or internal path ("/resources/…")
  ctaUrl: z
    .string()
    .max(500)
    .refine((u) => !u || u.startsWith('/') || u.startsWith('https://') || u.startsWith('http://'), 'Must be a URL or internal path')
    .optional(),
  officeId: z.string().nullable().optional(),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
});

export const updateBannerSchema = createBannerSchema.omit({ kind: true }).partial();
