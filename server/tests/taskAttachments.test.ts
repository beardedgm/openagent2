import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

const PDF = Buffer.from('%PDF-1.4 fake');

describe('task attachments', () => {
  it('creator uploads (type-allowlisted), assignee downloads, outsider cannot', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'at1@x.com', 'broker');
    const agent = await loginAs(app, 'at2@x.com', 'agent');
    const outsider = await loginAs(app, 'at3@x.com', 'agent');
    const agentUser = (await User.findOne({ email: 'at2@x.com' }))!;
    const id = (
      await broker.post('/api/v1/tasks').send({ title: 'Read this', audience: { type: 'users', userIds: [agentUser.id] } })
    ).body.task.id;

    expect(
      (await agent.post(`/api/v1/tasks/${id}/attachments`).attach('file', PDF, 'guide.pdf')).status,
    ).toBe(403); // assignees don't upload
    expect(
      (
        await broker
          .post(`/api/v1/tasks/${id}/attachments`)
          .attach('file', Buffer.from('MZ fake exe'), { filename: 'evil.exe', contentType: 'application/x-msdownload' })
      ).status,
    ).toBe(400); // type not allowlisted
    const up = await broker
      .post(`/api/v1/tasks/${id}/attachments`)
      .attach('file', PDF, { filename: 'guide.pdf', contentType: 'application/pdf' });
    expect(up.status).toBe(201);
    expect(up.body.task.attachments).toHaveLength(1);
    expect(up.body.task.attachments[0].name).toBe('guide.pdf');

    const dl = await agent.get(`/api/v1/tasks/${id}/attachments/0/download`);
    expect(dl.status).toBe(200); // local driver streams
    expect(dl.headers['content-disposition']).toContain('guide.pdf');
    expect((await outsider.get(`/api/v1/tasks/${id}/attachments/0/download`)).status).toBe(404);
    expect((await agent.get(`/api/v1/tasks/${id}/attachments/9/download`)).status).toBe(404);
  });

  it('enforces the 5-attachment cap', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'at4@x.com', 'broker');
    const id = (await broker.post('/api/v1/tasks').send({ title: 'Full', audience: { type: 'all' } })).body.task.id;
    for (let i = 0; i < 5; i++) {
      const r = await broker
        .post(`/api/v1/tasks/${id}/attachments`)
        .attach('file', PDF, { filename: `f${i}.pdf`, contentType: 'application/pdf' });
      expect(r.status).toBe(201);
    }
    const sixth = await broker
      .post(`/api/v1/tasks/${id}/attachments`)
      .attach('file', PDF, { filename: 'f5.pdf', contentType: 'application/pdf' });
    expect(sixth.status).toBe(400);
  });

  it('the local /files mount refuses private keys', async () => {
    const app = createApp();
    const res = await request(app).get('/files/private/tasks/aaaaaaaaaaaaaaaaaaaaaaaa/x.pdf');
    expect(res.status).toBe(404);
  });
});
