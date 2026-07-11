import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Notification } from '../src/models/Notification.js';
import { Task } from '../src/models/Task.js';
import { User } from '../src/models/User.js';
import { addMonthsClamped } from '../src/utils/recurrence.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createTask } from '../src/services/taskService.js';
import { sweepTasks } from '../src/jobs/taskSweep.js';

async function makeUser(email: string, role = 'agent') {
  return User.create({ email, hashedPassword: 'x', role, displayName: email });
}

describe('sweepTasks', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('due-soon notifies incomplete assignees exactly once, honoring prefs', async () => {
    const broker = await makeUser('s1@x.com', 'broker');
    const agent = await makeUser('s2@x.com');
    const optedOut = await makeUser('s3@x.com');
    optedOut.emailPrefs = new Map([['taskDueSoon', false]]) as never;
    await optedOut.save();
    await createTask(
      { title: 'Due soon', audience: { type: 'all' }, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      broker,
    );
    sendEmailMock.mockClear(); // discard assignment emails (due <48h emails on assignment)
    await sweepTasks();
    await sweepTasks(); // latch: no repeats
    expect(await Notification.countDocuments({ type: 'taskDueSoon', userId: agent.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskDueSoon', userId: optedOut.id })).toBe(1); // in-app always
    // email respects the pref: only the non-opted-out assignees get mail (agent + broker)
    const emailTargets = sendEmailMock.mock.calls.map((c) => c[0]).sort();
    expect(emailTargets).toEqual(['s1@x.com', 's2@x.com']);
  });

  it('overdue emails are non-disableable and fire once', async () => {
    const broker = await makeUser('s4@x.com', 'broker');
    const optedOut = await makeUser('s5@x.com');
    optedOut.emailPrefs = new Map([['taskOverdue', false]]) as never;
    await optedOut.save();
    const task = await createTask(
      { title: 'Late', audience: { type: 'users', userIds: [optedOut.id] }, dueAt: new Date(Date.now() + 3_600_000).toISOString() },
      broker,
    );
    await Task.updateOne({ _id: task.id }, { $set: { dueAt: new Date(Date.now() - 3_600_000) } });
    sendEmailMock.mockClear();
    await sweepTasks();
    await sweepTasks();
    expect(await Notification.countDocuments({ type: 'taskOverdue', userId: optedOut.id })).toBe(1);
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // pref ignored — nonDisableable
    expect(sendEmailMock.mock.calls[0][0]).toBe('s5@x.com');
  });

  it('completed assignees are not nagged', async () => {
    const broker = await makeUser('s6@x.com', 'broker');
    const agent = await makeUser('s7@x.com');
    const task = await createTask(
      { title: 'Done already', audience: { type: 'users', userIds: [agent.id] }, dueAt: new Date(Date.now() + 3 * 3_600_000).toISOString() },
      broker,
    );
    await Task.updateOne(
      { _id: task.id, 'completions.userId': agent.id },
      { $set: { 'completions.$.completedAt': new Date() } },
    );
    await sweepTasks();
    expect(await Notification.countDocuments({ type: 'taskDueSoon' })).toBe(0);
  });

  it('spawns recurring instances, re-resolving the audience, exactly once per due date', async () => {
    const broker = await makeUser('s8@x.com', 'broker');
    await makeUser('s9@x.com');
    const parent = await createTask({ title: 'Weekly report', audience: { type: 'all' }, recurrence: 'weekly' }, broker);
    await Task.updateOne({ _id: parent.id }, { $set: { nextRecurrenceAt: new Date(Date.now() - 60_000) } });
    await makeUser('s10@x.com'); // joins AFTER parent creation — must be in the spawned instance
    await sweepTasks();
    await sweepTasks(); // advanced latch: no double spawn
    const spawned = await Task.find({ title: 'Weekly report', _id: { $ne: parent.id } });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].recurrence).toBe('none');
    expect(spawned[0].completions).toHaveLength(3); // broker + both agents (fresh resolution)
    const freshParent = (await Task.findById(parent.id))!;
    expect(freshParent.nextRecurrenceAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it('spawned instances keep the parent created->due offset relative to sweep time', async () => {
    const broker = await makeUser('s12@x.com', 'broker');
    const parent = await createTask(
      {
        title: 'Offset report',
        audience: { type: 'all' },
        recurrence: 'weekly',
        dueAt: new Date(Date.now() + 4 * 86_400_000).toISOString(),
      },
      broker,
    );
    await Task.updateOne({ _id: parent.id }, { $set: { nextRecurrenceAt: new Date(Date.now() - 60_000) } });
    // Compute the expected offset from the PERSISTED parent fields — Mongo's
    // stored createdAt/dueAt are what the sweeper reads back.
    const freshParent = (await Task.findById(parent.id))!;
    const offset = freshParent.dueAt!.getTime() - (freshParent.get('createdAt') as Date).getTime();
    const sweepStart = Date.now();
    await sweepTasks();
    const spawned = await Task.find({ title: 'Offset report', _id: { $ne: parent.id } });
    expect(spawned).toHaveLength(1);
    expect(spawned[0].dueAt).not.toBeNull();
    // The sweeper's own `now` is captured a few ms after sweepStart — allow +-5s.
    expect(Math.abs(spawned[0].dueAt!.getTime() - (sweepStart + offset))).toBeLessThanOrEqual(5000);
  });

  it('advances a monthly recurrence via addMonthsClamped, not a raw setUTCMonth overflow', async () => {
    const broker = await makeUser('s11@x.com', 'broker');
    const parent = await createTask({ title: 'Monthly review', audience: { type: 'all' }, recurrence: 'monthly' }, broker);
    await Task.updateOne({ _id: parent.id }, { $set: { nextRecurrenceAt: new Date(Date.now() - 60_000) } });
    // Captured just before the sweep — the job's own `now` is created a few ms
    // later, so we compare with a small tolerance rather than exact equality.
    const sweepStart = new Date();
    await sweepTasks();
    const expected = addMonthsClamped(sweepStart, 1);
    const freshParent = (await Task.findById(parent.id))!;
    expect(freshParent.nextRecurrenceAt).not.toBeNull();
    // The day-of-month is the component a naive setUTCMonth overflow would corrupt
    // at month boundaries (Jan 31 -> Mar 3 instead of Feb 28) — pin it exactly.
    expect(freshParent.nextRecurrenceAt!.getUTCDate()).toBe(expected.getUTCDate());
    expect(freshParent.nextRecurrenceAt!.getUTCMonth()).toBe(expected.getUTCMonth());
    expect(freshParent.nextRecurrenceAt!.getUTCFullYear()).toBe(expected.getUTCFullYear());
    expect(Math.abs(freshParent.nextRecurrenceAt!.getTime() - expected.getTime())).toBeLessThanOrEqual(5000);
  });
});
