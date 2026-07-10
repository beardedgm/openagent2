import { z } from 'zod';

export const createPostSchema = z.object({
  title: z.string().trim().min(1).max(200),
  bodyHtml: z.string().max(100_000),
  officeId: z.string().nullable().optional(),
  important: z.boolean().optional(),
  commentsEnabled: z.boolean().optional(),
  publishAt: z.string().datetime({ offset: true }).optional(),
});

export const updatePostSchema = createPostSchema.partial();

export const createCommentSchema = z.object({
  body: z.string().trim().min(1).max(2000),
});
