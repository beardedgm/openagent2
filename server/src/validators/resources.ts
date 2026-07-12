import { z } from 'zod';

const webUrl = z.string().url().refine((u) => u.startsWith('https://') || u.startsWith('http://'), 'Must be a web URL');

export const createResourceSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(2000).optional(),
  kind: z.enum(['file', 'link']),
  externalUrl: webUrl.optional(),
  categoryId: z.string(),
  subcategoryId: z.string().nullable().optional(),
  officeId: z.string().nullable().optional(),
});

export const updateResourceSchema = createResourceSchema.omit({ kind: true }).partial();
