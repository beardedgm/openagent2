import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('uploads', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('broker uploads a logo; url saved to settings and file is served', async () => {
    const broker = await loginAs(app, 'b@x.com', 'broker');
    const res = await broker
      .post('/api/v1/uploads/logo')
      .attach('file', PNG, { filename: 'logo.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/^\/files\/logo\//);
    expect((await getSettings()).logoUrl).toBe(res.body.url);
    expect((await broker.get(res.body.url)).status).toBe(200);
  });

  it('agent cannot upload a logo but can upload an avatar', async () => {
    const agent = await loginAs(app, 'a@x.com', 'agent');
    expect(
      (
        await agent
          .post('/api/v1/uploads/logo')
          .attach('file', PNG, { filename: 'l.png', contentType: 'image/png' })
      ).status,
    ).toBe(403);
    const res = await agent
      .post('/api/v1/uploads/avatar')
      .attach('file', PNG, { filename: 'me.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect((await agent.get('/api/v1/auth/me')).body.user.photoUrl).toBe(res.body.url);
  });

  it('rejects non-image mimetypes', async () => {
    const broker = await loginAs(app, 'b2@x.com', 'broker');
    const res = await broker
      .post('/api/v1/uploads/avatar')
      .attach('file', Buffer.from('plain'), { filename: 'x.txt', contentType: 'text/plain' });
    expect(res.status).toBe(400);
  });

  it('stores extension from mimetype, not client filename', async () => {
    const broker = await loginAs(app, 'b3@x.com', 'broker');
    const res = await broker
      .post('/api/v1/uploads/avatar')
      .attach('file', PNG, { filename: 'evil.html', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toMatch(/\.png$/);
    const served = await broker.get(res.body.url);
    expect(served.status).toBe(200);
    expect(served.headers['content-type']).toContain('image/png');
  });

  it('rejects oversized uploads with 400', async () => {
    const broker = await loginAs(app, 'b4@x.com', 'broker');
    const big = Buffer.alloc(5 * 1024 * 1024 + 1);
    const res = await broker
      .post('/api/v1/uploads/avatar')
      .attach('file', big, { filename: 'big.png', contentType: 'image/png' });
    expect(res.status).toBe(400);
  });

  it('agent cannot upload a post-image but officeAdmin can', async () => {
    const agent = await loginAs(app, 'a2@x.com', 'agent');
    expect(
      (
        await agent
          .post('/api/v1/uploads/post-image')
          .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' })
      ).status,
    ).toBe(403);
    const officeAdmin = await loginAs(app, 'oa@x.com', 'officeAdmin');
    const res = await officeAdmin
      .post('/api/v1/uploads/post-image')
      .attach('file', PNG, { filename: 'p.png', contentType: 'image/png' });
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });
});
