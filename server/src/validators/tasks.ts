import { z } from 'zod';
import { AUDIENCE_TYPES, TASK_PRIORITIES } from '../models/Task.js';
import { RECURRENCE } from '../utils/recurrence.js';

export const createTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  descriptionHtml: z.string().max(100_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueAt: z.string().datetime({ offset: true }).nullable().optional(),
  recurrence: z.enum(RECURRENCE).optional(),
  audience: z.object({
    type: z.enum(AUDIENCE_TYPES),
    userIds: z.array(z.string()).max(500).optional(),
    officeId: z.string().nullable().optional(),
  }),
});

export const completeTaskSchema = z.object({
  note: z.string().trim().max(1000).optional(),
  userId: z.string().optional(), // admin completes on behalf
});

const templateItemSchema = z.object({
  title: z.string().trim().min(1).max(200),
  descriptionHtml: z.string().max(100_000).optional(),
  priority: z.enum(TASK_PRIORITIES).optional(),
  dueInDays: z.number().int().min(0).max(365).nullable().optional(),
});

export const templateSchema = z.object({
  name: z.string().trim().min(1).max(120),
  items: z.array(templateItemSchema).max(50),
});

export const updateTemplateSchema = templateSchema.partial();
