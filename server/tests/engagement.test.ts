import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('engagement routes', () => {
  it('logs a pageView engagement event for the authenticated user', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'eg1@x.com', 'agent');

    const res = await agent.post('/api/v1/engagement/page-view').send({ path: '/board' });
    expect(res.status).toBe(204);

    // logEngagement is fire-and-forget — give it a beat
    await new Promise((r) => setTimeout(r, 50));
    expect(await EngagementEvent.countDocuments({ type: 'pageView', 'meta.path': '/board' })).toBe(1);
  });

  it('requires authentication', async () => {
    const app = createApp();
    const res = await request(app).post('/api/v1/engagement/page-view').send({ path: '/board' });
    expect(res.status).toBe(401);
  });

  it('rejects a path longer than 300 characters', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'eg2@x.com', 'agent');

    const res = await agent.post('/api/v1/engagement/page-view').send({ path: 'a'.repeat(301) });
    expect(res.status).toBe(400);
  });
});
