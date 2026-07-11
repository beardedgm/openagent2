import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { Task, type TaskDoc, type TaskPriority } from '../models/Task.js';
import { TaskTemplate } from '../models/TaskTemplate.js';
import type { UserDoc } from '../models/User.js';
import { addMonthsClamped } from '../utils/recurrence.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { resolveAudience, type Audience } from './audience.js';
import { taskAssignedEmail } from './emailService.js';
import { logEngagement } from './engagementService.js';
import { notify } from './notificationService.js';

const EMAIL_DUE_WINDOW_MS = 48 * 3_600_000;

export interface TaskInput {
  title: string;
  descriptionHtml?: string;
  priority?: TaskPriority;
  dueAt?: string | null;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  audience: { type: 'users' | 'office' | 'all'; userIds?: string[]; officeId?: string | null };
}

function nextRecurrence(from: Date, recurrence: string): Date {
  if (recurrence === 'daily') return new Date(from.getTime() + 86_400_000);
  if (recurrence === 'weekly') return new Date(from.getTime() + 7 * 86_400_000);
  return addMonthsClamped(from, 1);
}

// createTask only needs the creator's id — the loose type lets template
// instantiation pass a bare id without holding a full UserDoc.
export async function createTask(
  input: TaskInput,
  creator: { id: string },
  opts: { isOnboarding?: boolean; templateId?: string | null } = {},
): Promise<TaskDoc> {
  const audience: Audience = {
    type: input.audience.type,
    userIds: input.audience.userIds ?? [],
    officeId: input.audience.officeId ?? null,
  };
  const memberIds = await resolveAudience(audience);
  if (memberIds.length === 0) throw new AppError(400, 'No active users match that audience');

  const now = new Date();
  const task = await Task.create({
    title: input.title,
    descriptionHtml: sanitizePostHtml(input.descriptionHtml ?? ''),
    descriptionText: htmlToText(input.descriptionHtml ?? ''),
    createdBy: creator.id,
    priority: input.priority ?? 'Medium',
    dueAt: input.dueAt ? new Date(input.dueAt) : null,
    recurrence: input.recurrence ?? 'none',
    nextRecurrenceAt: input.recurrence && input.recurrence !== 'none' ? nextRecurrence(now, input.recurrence) : null,
    audience,
    completions: memberIds.map((userId) => ({ userId })),
    isOnboarding: opts.isOnboarding ?? false,
    templateId: opts.templateId ?? null,
  });

  const recipients = memberIds.map(String).filter((id) => id !== creator.id);
  const emailWorthy =
    task.priority === 'High' || (task.dueAt != null && task.dueAt.getTime() - now.getTime() < EMAIL_DUE_WINDOW_MS);
  await notify(
    recipients,
    { type: 'taskAssigned', title: `New task: ${task.title}`, link: `/tasks/${task.id}` },
    emailWorthy
      ? taskAssignedEmail(task.title, task.dueAt ? task.dueAt.toISOString() : null, `${env.APP_DOMAIN}/tasks/${task.id}`)
      : undefined,
  );
  // Feed: office/all audiences get an office-scoped event; individually-targeted tasks
  // skip the feed (assignees already got the in-app notification — no broadcast value).
  if (audience.type !== 'users') {
    await emitActivity({
      type: 'taskAssigned',
      message: `New task: ${task.title}`,
      link: `/tasks/${task.id}`,
      officeId: audience.type === 'office' ? String(audience.officeId) : null,
      actorId: creator.id,
    });
  }
  return task;
}

/** Completes for `onBehalfUserId` when provided (admins only — routes enforce role). */
export async function completeTask(
  taskId: string,
  actor: UserDoc,
  note: string,
  onBehalfUserId?: string,
): Promise<TaskDoc> {
  const targetUserId = onBehalfUserId ?? actor.id;
  const isAdmin = actor.role === 'broker' || actor.role === 'officeAdmin';
  if (onBehalfUserId && onBehalfUserId !== actor.id && !isAdmin)
    throw new AppError(403, 'Insufficient permissions');
  const task = await Task.findById(taskId);
  if (!task) throw new AppError(404, 'Task not found');
  const completion = task.completions.find((c) => String(c.userId) === targetUserId);
  if (!completion) throw new AppError(400, 'That user is not assigned to this task');
  if (completion.completedAt) throw new AppError(400, 'Task is already completed for that user');
  // Claim atomically so concurrent completes (double-click, retry) can't double-fire
  // the activity + engagement side effects below.
  const claimed = await Task.updateOne(
    { _id: taskId, completions: { $elemMatch: { userId: targetUserId, completedAt: null } } },
    { $set: { 'completions.$.completedAt': new Date(), 'completions.$.note': note, 'completions.$.completedBy': actor.id } },
  );
  if (claimed.matchedCount === 0) throw new AppError(400, 'Task is already completed for that user');
  const onBehalf = targetUserId !== actor.id;
  await emitActivity({
    type: 'taskCompleted',
    message: onBehalf ? `${task.title} was marked complete for you` : `You completed: ${task.title}`,
    link: `/tasks/${task.id}`,
    userId: targetUserId, // visible only to the assignee (PRD 5.2 "your own")
    actorId: actor.id,
  });
  logEngagement('taskComplete', targetUserId, { taskId: task.id });
  return (await Task.findById(taskId))!;
}

export async function instantiateTemplate(
  templateId: string,
  audience: TaskInput['audience'],
  creatorId: string,
  opts: { isOnboarding?: boolean } = {},
): Promise<TaskDoc[]> {
  const tpl = await TaskTemplate.findById(templateId);
  if (!tpl) throw new AppError(404, 'Template not found');
  const creator = { id: creatorId };
  const out: TaskDoc[] = [];
  for (const item of tpl.items) {
    out.push(
      await createTask(
        {
          title: item.title,
          descriptionHtml: item.descriptionHtml,
          priority: item.priority as TaskPriority,
          dueAt: item.dueInDays != null ? new Date(Date.now() + item.dueInDays * 86_400_000).toISOString() : null,
          audience,
        },
        creator,
        { isOnboarding: opts.isOnboarding ?? false, templateId: tpl.id },
      ),
    );
  }
  return out;
}
