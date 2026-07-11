import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

let catCounter = 0;
async function makeFileResource(admin: ReturnType<typeof request.agent>) {
  const cat = (await admin.post('/api/v1/categories').send({ name: `Cat${catCounter++}` })).body.category;
  const r = (await admin.post('/api/v1/resources').send({ title: 'Guide', kind: 'file', categoryId: cat.id })).body.resource;
  return { resource: r, categoryId: cat.id as string };
}

describe('resource files', () => {
  it('first upload sets fileType, announces to bookmarkers of the category, and makes it agent-visible', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf2@x.com', 'agent');
    const { resource: r, categoryId } = await makeFileResource(admin);
    // agent bookmarks ANOTHER resource in the same category to become a category follower
    const peer = (await admin.post('/api/v1/resources').send({ title: 'Peer', kind: 'link', externalUrl: 'https://a.example.com', categoryId })).body.resource;
    await agent.post(`/api/v1/resources/${peer.id}/bookmark`);
    await Notification.deleteMany({});

    expect((await agent.get(`/api/v1/resources/${r.id}`)).status).toBe(404); // fileless → hidden
    const up = await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('%PDF-1.4 fake'), 'guide.pdf');
    expect(up.status).toBe(200);
    expect(up.body.resource.fileType).toBe('pdf');
    expect(up.body.resource.currentFile.name).toBe('guide.pdf');
    expect((await agent.get(`/api/v1/resources/${r.id}`)).status).toBe(200); // now visible
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(1);
  });

  it('re-upload appends a version (no second announcement); admins see history, agents download current', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf3@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf4@x.com', 'agent');
    const { resource: r } = await makeFileResource(admin);
    // .txt on purpose: supertest parses text/plain bodies into `res.text`, so the byte
    // assertions below stay simple (a .pdf response would be buffered as binary).
    await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('v1'), 'w9-2025.txt');
    await Notification.deleteMany({});
    const up2 = await admin.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('v2!'), 'w9-2026.txt');
    expect(up2.body.resource.versions).toHaveLength(2);
    expect(await Notification.countDocuments({ type: 'bookmarkedResource' })).toBe(0);

    // local driver in tests → res.download streams the CURRENT file
    const dl = await agent.get(`/api/v1/resources/${r.id}/download`);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-disposition']).toContain('w9-2026.txt');
    expect(dl.text).toBe('v2!');

    // download engagement logged with userId + resourceId (PRD 5.6). Fire-and-forget → wait a beat.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const events = await EngagementEvent.find({ type: 'download' });
    expect(events).toHaveLength(1);
    expect(events[0].meta).toMatchObject({ resourceId: r.id });

    // version param: agents 403, admins fetch history
    expect((await agent.get(`/api/v1/resources/${r.id}/download?version=1`)).status).toBe(403);
    const old = await admin.get(`/api/v1/resources/${r.id}/download?version=1`);
    expect(old.text).toBe('v1');
  });

  it('guards: upload to a link resource 400; upload by agent 403; download of fileless resource 404', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rf5@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rf6@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'LinkCat' })).body.category;
    const link = (await admin.post('/api/v1/resources').send({ title: 'Site', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;
    expect((await admin.post(`/api/v1/resources/${link.id}/file`).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(400);
    const { resource: r } = await makeFileResource(admin);
    expect((await agent.post(`/api/v1/resources/${r.id}/file`).attach('file', Buffer.from('x'), 'a.txt')).status).toBe(403);
    expect((await admin.get(`/api/v1/resources/${r.id}/download`)).status).toBe(404);
  });
});
