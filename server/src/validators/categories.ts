import { z } from 'zod';

export const createCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
  parentId: z.string().nullable().optional(),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1).max(80),
});
