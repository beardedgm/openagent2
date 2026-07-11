import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { Notification } from '../src/models/Notification.js';
import { Task } from '../src/models/Task.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { resolveAudience } from '../src/services/audience.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { completeTask, createTask, instantiateTemplate } from '../src/services/taskService.js';

async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('resolveAudience', () => {
  it('resolves all / office / users to active intranet members', async () => {
    const officeA = '64b000000000000000000001';
    const broker = await makeUser('a1@x.com', 'broker');
    const inOffice = await makeUser('a2@x.com', 'agent', officeA);
    await makeUser('a3@x.com', 'agent', '64b000000000000000000002');
    const deactivated = await makeUser('a4@x.com', 'agent', officeA);
    deactivated.status = 'deactivated';
    await deactivated.save();

    const all = await resolveAudience({ type: 'all', userIds: [], officeId: null });
    expect(all).toHaveLength(3); // broker + 2 active agents, deactivated excluded

    const office = await resolveAudience({ type: 'office', userIds: [], officeId: officeA });
    expect(office.map(String)).toEqual([inOffice.id]); // members of that office only (the broker has officeId null, so is excluded)

    const users = await resolveAudience({ type: 'users', userIds: [broker.id, deactivated.id], officeId: null });
    expect(users.map(String)).toEqual([broker.id]); // deactivated filtered out
  });

  it('rejects an office audience without an officeId', async () => {
    await expect(resolveAudience({ type: 'office', userIds: [], officeId: null })).rejects.toThrow(/office/i);
  });
});

describe('Task / TaskTemplate models', () => {
  it('applies defaults and stores completion subdocs', async () => {
    const broker = await makeUser('m1@x.com', 'broker');
    const agent = await makeUser('m2@x.com', 'agent');
    const t = await Task.create({
      title: 'File paperwork',
      createdBy: broker.id,
      audience: { type: 'users', userIds: [agent.id], officeId: null },
      completions: [{ userId: agent.id }],
    });
    expect(t.priority).toBe('Medium');
    expect(t.dueAt).toBeNull();
    expect(t.recurrence).toBe('none');
    expect(t.isOnboarding).toBe(false);
    expect(t.completions[0].completedAt).toBeNull();
    expect(t.completions[0].note).toBe('');
  });

  it('templates hold an ordered item list', async () => {
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [
        { title: 'Sign policies', dueInDays: 3 },
        { title: 'Meet your office admin', priority: 'High' },
      ],
    });
    expect(tpl.items).toHaveLength(2);
    expect(tpl.items[0].dueInDays).toBe(3);
    expect(tpl.items[1].priority).toBe('High');
    expect(tpl.items[1].dueInDays).toBeNull();
  });
});

describe('taskService', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('createTask resolves the audience, sanitizes, notifies in-app; no email for Medium/far-due', async () => {
    const broker = await makeUser('t1@x.com', 'broker');
    const a1 = await makeUser('t2@x.com', 'agent');
    const a2 = await makeUser('t3@x.com', 'agent');
    const task = await createTask(
      {
        title: 'Update your license record',
        descriptionHtml: '<p>Do <script>x()</script>it</p>',
        audience: { type: 'all' },
        dueAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      },
      broker,
    );
    expect(task.descriptionHtml).toBe('<p>Do it</p>');
    expect(task.completions).toHaveLength(3); // broker + both agents
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: a1.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: a2.id })).toBe(1);
    expect(await Notification.countDocuments({ type: 'taskAssigned', userId: broker.id })).toBe(0); // creator excluded
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await ActivityEvent.countDocuments({ type: 'taskAssigned' })).toBe(1);
  });

  it('High priority (or due <48h) assignment emails assignees per prefs', async () => {
    const broker = await makeUser('t4@x.com', 'broker');
    await makeUser('t5@x.com', 'agent');
    const optedOut = await makeUser('t6@x.com', 'agent');
    optedOut.emailPrefs = new Map([['taskAssigned', false]]) as never;
    await optedOut.save();
    await createTask({ title: 'Urgent', audience: { type: 'all' }, priority: 'High' }, broker);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('t5@x.com');
  });

  it('completeTask sets note, emits user-scoped activity, logs engagement, rejects double-complete', async () => {
    const broker = await makeUser('t7@x.com', 'broker');
    const agent = await makeUser('t8@x.com', 'agent');
    const task = await createTask({ title: 'Sign form', audience: { type: 'users', userIds: [agent.id] } }, broker);
    await completeTask(task.id, agent, 'Done at the office');
    const fresh = (await Task.findById(task.id))!;
    expect(fresh.completions[0].completedAt).not.toBeNull();
    expect(fresh.completions[0].note).toBe('Done at the office');
    const act = (await ActivityEvent.findOne({ type: 'taskCompleted' }))!;
    expect(String(act.userId)).toBe(agent.id); // visible only to the completer
    expect(await EngagementEvent.countDocuments({ type: 'taskComplete', userId: agent.id })).toBe(1);
    await expect(completeTask(task.id, agent, '')).rejects.toThrow(/already/i);
  });

  it('admin completes on behalf; non-assignee cannot complete', async () => {
    const broker = await makeUser('t9@x.com', 'broker');
    const agent = await makeUser('t10@x.com', 'agent');
    const outsider = await makeUser('t11@x.com', 'agent');
    const task = await createTask({ title: 'X', audience: { type: 'users', userIds: [agent.id] } }, broker);
    await expect(completeTask(task.id, outsider, '')).rejects.toThrow(/not assigned/i);
    await completeTask(task.id, broker, 'verified in person', agent.id); // on-behalf
    const fresh = (await Task.findById(task.id))!;
    expect(fresh.completions[0].completedAt).not.toBeNull();
  });

  it('instantiateTemplate creates one task per item with relative due dates', async () => {
    const broker = await makeUser('t12@x.com', 'broker');
    const agent = await makeUser('t13@x.com', 'agent');
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [
        { title: 'Sign policies', dueInDays: 3 },
        { title: 'Office tour', priority: 'High' },
      ],
    });
    const tasks = await instantiateTemplate(tpl.id, { type: 'users', userIds: [agent.id] }, broker.id, {
      isOnboarding: true,
    });
    expect(tasks).toHaveLength(2);
    expect(tasks[0].isOnboarding).toBe(true);
    expect(tasks[0].dueAt).not.toBeNull();
    expect(tasks[1].dueAt).toBeNull();
    expect(String(tasks[0].templateId)).toBe(tpl.id);
    expect(tasks[0].completions).toHaveLength(1);
  });
});
