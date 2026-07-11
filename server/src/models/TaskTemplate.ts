import mongoose from 'mongoose';
import { TASK_PRIORITIES } from './Task.js';

const templateItemSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },
    // Due date relative to instantiation; null = no due date.
    dueInDays: { type: Number, default: null, min: 0, max: 365 },
  },
  { _id: false },
);

const taskTemplateSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    items: { type: [templateItemSchema], default: [] },
  },
  { timestamps: true },
);

export const TaskTemplate = mongoose.model('TaskTemplate', taskTemplateSchema);
export type TaskTemplateDoc = InstanceType<typeof TaskTemplate>;

export function toPublicTemplate(t: TaskTemplateDoc) {
  return {
    id: t.id as string,
    name: t.name,
    items: t.items.map((i) => ({
      title: i.title,
      descriptionHtml: i.descriptionHtml,
      priority: i.priority,
      dueInDays: i.dueInDays,
    })),
    createdAt: t.get('createdAt') as Date,
  };
}
