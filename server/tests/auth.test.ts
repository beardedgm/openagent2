import { createHash } from 'node:crypto';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Invitation } from '../src/models/Invitation.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

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

  it('rate limits login attempts', async () => {
    let last = 0;
    for (let i = 0; i < 11; i++) {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({ email: 'flood@x.com', password: 'x' });
      last = res.status;
    }
    expect(last).toBe(429);
  });
});
