import { describe, expect, it } from 'vitest';
import { Task } from '../src/models/Task.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { resolveAudience } from '../src/services/audience.js';

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
    expect(office.map(String)).toEqual([inOffice.id]); // office members only, not admins

    const users = await resolveAudience({ type: 'users', userIds: [broker.id, deactivated.id], officeId: null });
    expect(users.map(String)).toEqual([broker.id]); // deactivated filtered out
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
