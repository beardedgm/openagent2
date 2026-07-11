import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { Invitation } from '../src/models/Invitation.js';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const { notifyMock } = vi.hoisted(() => ({ notifyMock: vi.fn() }));
// Spread the original module and delegate to the real notify by default so the
// happy-path registration test still creates real Notification docs; individual
// tests can queue a one-shot rejection to exercise the failure path.
vi.mock('../src/services/notificationService.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/services/notificationService.js')>();
  notifyMock.mockImplementation(original.notify);
  return { ...original, notify: notifyMock };
});

async function makeUser(email: string, role = 'agent', status = 'active') {
  return User.create({
    email,
    hashedPassword: await hashPassword('Password1!'),
    role,
    status,
    displayName: 'Test User',
  });
}

describe('auth', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('logs in, reports me, logs out', async () => {
    await makeUser('a@x.com');
    const agent = request.agent(app);
    const login = await agent.post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'Password1!' });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe('a@x.com');
    expect(login.body.user.hashedPassword).toBeUndefined();

    const me = await agent.get('/api/v1/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe('a@x.com');

    await agent.post('/api/v1/auth/logout');
    expect((await agent.get('/api/v1/auth/me')).status).toBe(401);
  });

  it('rejects bad credentials and deactivated users identically', async () => {
    await makeUser('a@x.com');
    await makeUser('gone@x.com', 'agent', 'deactivated');
    const bad = await request(app).post('/api/v1/auth/login').send({ email: 'a@x.com', password: 'nope' });
    expect(bad.status).toBe(401);
    const gone = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'gone@x.com', password: 'Password1!' });
    expect(gone.status).toBe(401);
    expect(gone.body.error).toBe(bad.body.error);
  });

  it('registers via a valid invitation and rejects reuse', async () => {
    const admin = await makeUser('admin@x.com', 'officeAdmin');
    const token = 'raw-token-for-test';
    await Invitation.create({
      email: 'new@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const agent = request.agent(app);
    const reg = await agent
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'Newbie' });
    expect(reg.status).toBe(201);
    expect((await agent.get('/api/v1/auth/me')).body.user.email).toBe('new@x.com');

    const reuse = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'Again' });
    expect(reuse.status).toBe(400);
  });

  it('rejects expired invitations', async () => {
    const admin = await makeUser('admin2@x.com', 'officeAdmin');
    await Invitation.create({
      email: 'late@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update('expired-token').digest('hex'),
      expiresAt: new Date(Date.now() - 1000),
    });
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ token: 'expired-token', password: 'Password1!', displayName: 'Late' });
    expect(res.status).toBe(400);
  });

  it('handles concurrent registration attempts with the same token', async () => {
    const admin = await makeUser('admin3@x.com', 'officeAdmin');
    await Invitation.create({
      email: 'race@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update('race-token').digest('hex'),
      expiresAt: new Date(Date.now() + 86400000),
    });
    const [r1, r2] = await Promise.all([
      request(app)
        .post('/api/v1/auth/register')
        .send({ token: 'race-token', password: 'Password1!', displayName: 'A' }),
      request(app)
        .post('/api/v1/auth/register')
        .send({ token: 'race-token', password: 'Password1!', displayName: 'B' }),
    ]);
    const statuses = [r1.status, r2.status].sort();
    expect(statuses[0]).toBe(201);
    expect(statuses[1]).toBe(400);
  });

  it('rate limits per-email login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'flood@x.com', password: 'x' });
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('rate limits by IP across malformed attempts', async () => {
    let last = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(app).post('/api/v1/auth/login').send({ nope: true });
      last = res.status;
    }
    expect(last).toBe(429);
  }, 20000);

  it('registration notifies the inviting admin and emits an agentJoined event', async () => {
    const app = createApp();
    const admin = await User.create({
      email: 'inviter@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'broker',
      displayName: 'Inviter',
    });
    const token = 'stage2-test-token';
    await Invitation.create({
      email: 'newagent@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'New Agent' });
    expect(res.status).toBe(201);

    const notifications = await Notification.find({ userId: admin.id });
    expect(notifications).toHaveLength(1);
    expect(notifications[0].type).toBe('invitationAccepted');
    expect(notifications[0].title).toContain('New Agent');
    const events = await ActivityEvent.find({ type: 'agentJoined' });
    expect(events).toHaveLength(1);
    expect(events[0].message).toContain('New Agent');
  });

  it('registration succeeds even when a post-registration side effect fails', async () => {
    const app = createApp();
    const admin = await User.create({
      email: 'inviter2@x.com',
      hashedPassword: await hashPassword('Password1!'),
      role: 'broker',
      displayName: 'Inviter Two',
    });
    const token = 'stage2-resilience-token';
    await Invitation.create({
      email: 'resilient@x.com',
      role: 'agent',
      invitedBy: admin.id,
      tokenHash: createHash('sha256').update(token).digest('hex'),
      expiresAt: new Date(Date.now() + 86_400_000),
    });
    notifyMock.mockRejectedValueOnce(new Error('notification pipeline down'));

    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ token, password: 'Password1!', displayName: 'Resilient Agent' });
    expect(res.status).toBe(201);
    expect(await User.findOne({ email: 'resilient@x.com' })).not.toBeNull();
    // Proves the rejection actually fired: the failed notify created no docs.
    expect(await Notification.find({ userId: admin.id })).toHaveLength(0);
  });
});
