import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const sent: { to: string; html: string }[] = [];
vi.mock('../src/services/emailService.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../src/services/emailService.js')>();
  return {
    ...mod,
    sendEmail: vi.fn(async (to: string, _subject: string, html: string) => {
      sent.push({ to, html });
    }),
  };
});

const { createApp } = await import('../src/app.js');

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('users & invitations', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
    sent.length = 0;
  });

  it('officeAdmin can invite; agent cannot; token in email registers the user', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'agent@x.com', 'agent');

    expect(
      (await agent.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).status,
    ).toBe(403);

    const res = await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' });
    expect(res.status).toBe(201);
    expect(res.body.emailSent).toBe(true);
    expect(sent).toHaveLength(1);
    const token = sent[0].html.match(/token=([A-Za-z0-9_-]+)/)![1];

    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'New Agent' });
    expect(reg.status).toBe(201);
    expect(reg.body.user.role).toBe('agent');
  });

  it('rejects duplicate invites and invites for existing users', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'admin@x.com', role: 'agent' })).status,
    ).toBe(409);
    await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' });
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).status,
    ).toBe(409);
  });

  it('rejects overlong invite emails', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const res = await admin
      .post('/api/v1/users/invite')
      .send({ email: 'x'.repeat(250) + '@x.com', role: 'agent' });
    expect(res.status).toBe(400);
  });

  it('only broker can invite a broker', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    expect(
      (await admin.post('/api/v1/users/invite').send({ email: 'b@x.com', role: 'broker' })).status,
    ).toBe(403);
    const broker = await loginAs(app, 'broker@x.com', 'broker');
    expect(
      (await broker.post('/api/v1/users/invite').send({ email: 'b@x.com', role: 'broker' })).status,
    ).toBe(201);
  });

  it('resend reissues a working token', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const inv = (await admin.post('/api/v1/users/invite').send({ email: 'n@x.com', role: 'agent' })).body
      .invitation;
    await admin.post(`/api/v1/users/invitations/${inv.id}/resend`);
    expect(sent).toHaveLength(2);
    const token2 = sent[1].html.match(/token=([A-Za-z0-9_-]+)/)![1];
    const reg = await request(app)
      .post('/api/v1/auth/register')
      .send({ token: token2, password: 'Password1!', displayName: 'N' });
    expect(reg.status).toBe(201);
  });

  it('lists users (deactivated only for admins), updates profiles, enforces edit rules', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'agent@x.com', 'agent');
    const other = await User.create({
      email: 'other@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'agent',
      displayName: 'Other',
      status: 'deactivated',
    });

    const agentList = await agent.get('/api/v1/users');
    expect(agentList.body.users.every((u: { status: string }) => u.status === 'active')).toBe(true);
    const adminList = await admin.get('/api/v1/users?includeDeactivated=true');
    expect(adminList.body.users.some((u: { id: string }) => u.id === other.id)).toBe(true);

    const meId = agentList.body.users.find((u: { email: string }) => u.email === 'agent@x.com').id;
    expect((await agent.patch(`/api/v1/users/${meId}`).send({ bio: 'Hi' })).status).toBe(200);
    expect((await agent.patch(`/api/v1/users/${meId}`).send({ role: 'broker' })).status).toBe(403);
    expect((await agent.patch(`/api/v1/users/${other.id}`).send({ bio: 'x' })).status).toBe(403);
    expect((await admin.patch(`/api/v1/users/${meId}`).send({ role: 'officeAdmin' })).status).toBe(200);
  });

  it('deactivates users with guards', async () => {
    const admin = await loginAs(app, 'admin@x.com', 'officeAdmin');
    const broker = await User.create({
      email: 'boss@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'broker',
      displayName: 'Boss',
    });
    const target = await User.create({
      email: 't@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'agent',
      displayName: 'T',
    });
    expect((await admin.delete(`/api/v1/users/${broker.id}`)).status).toBe(403);
    expect((await admin.delete(`/api/v1/users/${target.id}`)).status).toBe(200);
    const adminId = (await admin.get('/api/v1/auth/me')).body.user.id;
    expect((await admin.delete(`/api/v1/users/${adminId}`)).status).toBe(400);
  });
});
