import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { Task, type TaskDoc } from '../models/Task.js';
import { User } from '../models/User.js';
import { taskDueEmail } from '../services/emailService.js';
import { notify } from '../services/notificationService.js';
import { createTask } from '../services/taskService.js';
import { addMonthsClamped } from '../utils/recurrence.js';

const DUE_SOON_MS = 24 * 3_600_000;

export async function sweepTasks(): Promise<void> {
  const now = new Date();
  await sweepDueSoon(now);
  await sweepOverdue(now);
  await sweepRecurrence(now);
}

async function sweepDueSoon(now: Date): Promise<void> {
  const soon = new Date(now.getTime() + DUE_SOON_MS);
  const tasks = await Task.find({
    dueAt: { $gt: now, $lte: soon },
    completions: { $elemMatch: { completedAt: null, dueSoonNotifiedAt: null } },
  });
  for (const task of tasks) {
    for (const c of task.completions) {
      if (c.completedAt || c.dueSoonNotifiedAt) continue;
      const claimed = await Task.updateOne(
        { _id: task.id, completions: { $elemMatch: { userId: c.userId, completedAt: null, dueSoonNotifiedAt: null } } },
        { $set: { 'completions.$.dueSoonNotifiedAt': now } },
      );
      if (claimed.modifiedCount !== 1) continue;
      await safeNotify(task, String(c.userId), 'taskDueSoon', 'due-soon', false);
    }
  }
}

async function sweepOverdue(now: Date): Promise<void> {
  // No lower time floor: scans all historical overdue-incomplete-unlatched tasks each
  // sweep — bounded and cheap at single-brokerage scale with 2y retention (latch keeps
  // it one notice per user ever).
  const tasks = await Task.find({
    dueAt: { $lt: now },
    completions: { $elemMatch: { completedAt: null, overdueNotifiedAt: null } },
  });
  for (const task of tasks) {
    for (const c of task.completions) {
      if (c.completedAt || c.overdueNotifiedAt) continue;
      const claimed = await Task.updateOne(
        { _id: task.id, completions: { $elemMatch: { userId: c.userId, completedAt: null, overdueNotifiedAt: null } } },
        { $set: { 'completions.$.overdueNotifiedAt': now } },
      );
      if (claimed.modifiedCount !== 1) continue;
      await safeNotify(task, String(c.userId), 'taskOverdue', 'overdue', true); // PRD 5.9.3: cannot be disabled
    }
  }
}

async function safeNotify(
  task: TaskDoc,
  userId: string,
  type: 'taskDueSoon' | 'taskOverdue',
  emailKind: 'due-soon' | 'overdue',
  nonDisableable: boolean,
): Promise<void> {
  try {
    const { subject, html } = taskDueEmail(emailKind, task.title, `${env.APP_DOMAIN}/tasks/${task.id}`);
    await notify(
      [userId],
      {
        type,
        title: emailKind === 'due-soon' ? `Due soon: ${task.title}` : `Overdue: ${task.title}`,
        link: `/tasks/${task.id}`,
      },
      { subject, html, nonDisableable },
    );
  } catch (err) {
    logger.error({ err, taskId: task.id, userId }, 'task sweep notification failed');
  }
}

async function sweepRecurrence(now: Date): Promise<void> {
  // Advances anchor to sweep-time now (drift under late execution, but no backfill
  // storm after outages — deliberate, mirrors the reminder sweeper's skip-by-design).
  // Advance dates are constants relative to `now` — computed once in JS (not inside
  // the aggregation pipeline) so the monthly branch can use addMonthsClamped, which
  // clamps end-of-month overflow (Jan 31 + 1mo = Feb 28) the way a raw $dateAdd /
  // setUTCMonth expression cannot.
  const advances = {
    daily: new Date(now.getTime() + 86_400_000),
    weekly: new Date(now.getTime() + 7 * 86_400_000),
    monthly: addMonthsClamped(now, 1),
  };
  // Claim one task at a time by atomically advancing nextRecurrenceAt.
  for (;;) {
    const parent = await Task.findOneAndUpdate(
      { nextRecurrenceAt: { $lte: now } },
      [
        {
          $set: {
            nextRecurrenceAt: {
              $switch: {
                branches: [
                  { case: { $eq: ['$recurrence', 'daily'] }, then: advances.daily },
                  { case: { $eq: ['$recurrence', 'weekly'] }, then: advances.weekly },
                ],
                default: advances.monthly,
              },
            },
          },
        },
      ] as never,
      { new: false },
    );
    if (!parent) return;
    try {
      const creator = await User.findById(parent.createdBy);
      if (!creator) {
        logger.warn({ taskId: parent.id }, 'recurring task creator missing — series skipped this period');
        continue;
      }
      const dueOffset = parent.dueAt ? parent.dueAt.getTime() - (parent.get('createdAt') as Date).getTime() : null;
      await createTask(
        {
          title: parent.title,
          descriptionHtml: parent.descriptionHtml,
          priority: parent.priority as never,
          dueAt: dueOffset !== null ? new Date(now.getTime() + dueOffset).toISOString() : null,
          relatedResourceId: parent.relatedResourceId ? String(parent.relatedResourceId) : null,
          audience: {
            type: parent.audience.type as never,
            userIds: parent.audience.userIds.map(String),
            officeId: parent.audience.officeId ? String(parent.audience.officeId) : null,
          },
        },
        { id: creator.id },
        { isOnboarding: false, templateId: parent.templateId ? String(parent.templateId) : null },
      );
    } catch (err) {
      logger.error({ err, taskId: parent.id }, 'recurring task spawn failed');
    }
  }
}
