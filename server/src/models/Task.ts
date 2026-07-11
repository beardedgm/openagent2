import mongoose from 'mongoose';
import { RECURRENCE } from '../utils/recurrence.js';

export const TASK_PRIORITIES = ['High', 'Medium', 'Low'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const AUDIENCE_TYPES = ['users', 'office', 'all'] as const;
export type AudienceType = (typeof AUDIENCE_TYPES)[number];

const audienceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: AUDIENCE_TYPES, required: true },
    userIds: { type: [mongoose.Schema.Types.ObjectId], default: [] },
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { _id: false },
);

const completionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    completedAt: { type: Date, default: null },
    note: { type: String, default: '', maxlength: 1000 },
    // Sweeper latches (task-sweep job): set once per user when the notice went out.
    dueSoonNotifiedAt: { type: Date, default: null },
    overdueNotifiedAt: { type: Date, default: null },
  },
  { _id: false },
);

const attachmentSchema = new mongoose.Schema(
  {
    key: { type: String, required: true },
    name: { type: String, required: true, maxlength: 120 },
    size: { type: Number, required: true },
    contentType: { type: String, required: true },
  },
  { _id: false },
);

const taskSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    priority: { type: String, enum: TASK_PRIORITIES, default: 'Medium' },
    dueAt: { type: Date, default: null },
    attachments: { type: [attachmentSchema], default: [] },
    // Field ships per PRD 5.7; the Resource Hub (and its UI) arrives in Stage 4.
    relatedResourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    recurrence: { type: String, enum: RECURRENCE, default: 'none' },
    // Sweeper claims this atomically to spawn the next instance.
    nextRecurrenceAt: { type: Date, default: null },
    audience: { type: audienceSchema, required: true },
    completions: { type: [completionSchema], default: [] },
    isOnboarding: { type: Boolean, default: false },
    templateId: { type: mongoose.Schema.Types.ObjectId, default: null },
  },
  { timestamps: true },
);
taskSchema.index({ 'completions.userId': 1, dueAt: 1 });
taskSchema.index({ nextRecurrenceAt: 1 });
taskSchema.index({ dueAt: 1 });

export const Task = mongoose.model('Task', taskSchema);
export type TaskDoc = InstanceType<typeof Task>;

export function toPublicTask(t: TaskDoc, viewerId: string) {
  const mine = t.completions.find((c) => String(c.userId) === viewerId);
  const completed = t.completions.filter((c) => c.completedAt).length;
  return {
    id: t.id as string,
    title: t.title,
    descriptionHtml: t.descriptionHtml,
    createdBy: String(t.createdBy),
    priority: t.priority,
    dueAt: t.dueAt,
    attachments: t.attachments.map((a) => ({ name: a.name, size: a.size, contentType: a.contentType })),
    recurrence: t.recurrence,
    isOnboarding: t.isOnboarding,
    myCompletion: mine ? { completedAt: mine.completedAt, note: mine.note } : null,
    counts: { total: t.completions.length, completed },
    createdAt: t.get('createdAt') as Date,
  };
}
