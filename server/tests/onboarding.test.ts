import { createHash } from 'node:crypto';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Invitation } from '../src/models/Invitation.js';
import { getSettings } from '../src/models/Settings.js';
import { Task } from '../src/models/Task.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

async function registerViaInvite(app: ReturnType<typeof createApp>, inviterId: string, email: string) {
  const token = `tok-${email}`;
  await Invitation.create({
    email, role: 'agent', invitedBy: inviterId,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 86_400_000),
  });
  const agent = request.agent(app);
  const res = await agent.post('/api/v1/auth/register').send({ token, password: 'Password1!', displayName: email });
  return { agent, status: res.status };
}

describe('onboarding', () => {
  it('registration auto-assigns the configured template; progress endpoints report it', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'ob1@x.com', 'broker');
    const brokerUser = (await User.findOne({ email: 'ob1@x.com' }))!;
    const tpl = await TaskTemplate.create({
      name: 'Onboarding',
      items: [{ title: 'Sign policies', dueInDays: 3 }, { title: 'Office tour' }],
    });
    const settings = await getSettings();
    settings.onboardingTaskTemplateId = tpl.id;
    await settings.save();

    const { agent: newbie, status } = await registerViaInvite(app, brokerUser.id, 'newagent@x.com');
    expect(status).toBe(201);
    expect(await Task.countDocuments({ isOnboarding: true })).toBe(2);

    const mine = await newbie.get('/api/v1/tasks/onboarding/mine');
    expect(mine.body).toEqual({ total: 2, completed: 0 });

    // Complete one onboarding task and re-check.
    const myTasks = await newbie.get('/api/v1/tasks?scope=mine');
    const first = myTasks.body.tasks.find((t: { isOnboarding: boolean }) => t.isOnboarding);
    await newbie.post(`/api/v1/tasks/${first.id}/complete`).send({});
    expect((await newbie.get('/api/v1/tasks/onboarding/mine')).body).toEqual({ total: 2, completed: 1 });

    // Admin status view.
    const statusRes = await broker.get('/api/v1/tasks/onboarding/status');
    const newbieUser = (await User.findOne({ email: 'newagent@x.com' }))!;
    const row = statusRes.body.statuses.find((s: { userId: string }) => s.userId === String(newbieUser._id));
    expect(row).toEqual({ userId: String(newbieUser._id), total: 2, completed: 1 });
  });

  it('registration works fine with no template configured; status endpoint is admin-only', async () => {
    const app = createApp();
    await loginAs(app, 'ob2@x.com', 'broker');
    const brokerUser = (await User.findOne({ email: 'ob2@x.com' }))!;
    const { agent: newbie, status } = await registerViaInvite(app, brokerUser.id, 'plain@x.com');
    expect(status).toBe(201);
    expect(await Task.countDocuments()).toBe(0);
    expect((await newbie.get('/api/v1/tasks/onboarding/mine')).body).toEqual({ total: 0, completed: 0 });
    expect((await newbie.get('/api/v1/tasks/onboarding/status')).status).toBe(403);
  });
});
