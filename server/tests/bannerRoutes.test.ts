import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Banner } from '../src/models/Banner.js';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

const DAY = 24 * 60 * 60 * 1000;
const live = { startAt: new Date(Date.now() - DAY).toISOString(), endAt: new Date(Date.now() + DAY).toISOString() };

describe('banner routes', () => {
  it('admin CRUD + duplicate; agents can read active but not manage', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'br2@x.com', 'agent');

    const created = await admin.post('/api/v1/banners').send({ kind: 'text', title: 'Promo', bodyHtml: '<p>Go</p>', ctaLabel: 'Open', ctaUrl: 'https://x.example.com', ...live });
    expect(created.status).toBe(201);
    const id = created.body.banner.id;

    expect((await agent.get('/api/v1/banners/active')).body.banners).toHaveLength(1);
    expect((await agent.get('/api/v1/banners')).status).toBe(403);
    expect((await agent.post('/api/v1/banners').send({ kind: 'text', title: 'No', bodyHtml: '<p>x</p>', ...live })).status).toBe(403);

    const dup = await admin.post(`/api/v1/banners/${id}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.banner.title).toBe('Promo (copy)');
    expect((await admin.get('/api/v1/banners')).body.banners).toHaveLength(2); // admin list includes everything

    const patched = await admin.patch(`/api/v1/banners/${id}`).send({ title: 'Promo 2' });
    expect(patched.status).toBe(200);
    expect(patched.body.banner.title).toBe('Promo 2');
    expect((await admin.delete(`/api/v1/banners/${id}`)).status).toBe(200);
    expect(await Banner.countDocuments()).toBe(1);
  });

  it('click endpoint logs bannerClick engagement and bumps the denormalized count', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br3@x.com', 'broker');
    const agent = await loginAs(app, 'br4@x.com', 'agent');
    const id = (await admin.post('/api/v1/banners').send({ kind: 'text', title: 'C', bodyHtml: '<p>x</p>', ...live })).body.banner.id;

    expect((await agent.post(`/api/v1/banners/${id}/click`)).status).toBe(200);
    expect((await agent.post(`/api/v1/banners/${id}/click`)).status).toBe(200);
    // logEngagement is fire-and-forget — give it a beat
    await new Promise((r) => setTimeout(r, 50));
    expect(await EngagementEvent.countDocuments({ type: 'bannerClick', 'meta.bannerId': id })).toBe(2);
    expect((await Banner.findById(id))!.clickCount).toBe(2);

    // Clicks are gated like /active: banners outside the live window or targeted at
    // another office (the clicking agent has officeId null) 404 and never bump the count.
    const expiredId = (
      await admin.post('/api/v1/banners').send({
        kind: 'text',
        title: 'Old',
        bodyHtml: '<p>x</p>',
        startAt: new Date(Date.now() - 3 * DAY).toISOString(),
        endAt: new Date(Date.now() - DAY).toISOString(),
      })
    ).body.banner.id;
    const otherOfficeId = (
      await admin.post('/api/v1/banners').send({ kind: 'text', title: 'Elsewhere', bodyHtml: '<p>x</p>', officeId: '64b000000000000000000002', ...live })
    ).body.banner.id;
    expect((await agent.post(`/api/v1/banners/${expiredId}/click`)).status).toBe(404);
    expect((await agent.post(`/api/v1/banners/${otherOfficeId}/click`)).status).toBe(404);
    expect((await Banner.findById(expiredId))!.clickCount).toBe(0);
    expect((await Banner.findById(otherOfficeId))!.clickCount).toBe(0);
  });

  it('banner-image upload: officeAdmin+, image types only', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'br5@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'br6@x.com', 'agent');
    const png = Buffer.from('89504e470d0a1a0a', 'hex');
    const ok = await admin.post('/api/v1/uploads/banner-image').attach('file', png, { filename: 'ad.png', contentType: 'image/png' });
    expect(ok.status).toBe(200);
    expect(ok.body.url).toContain('/files/banners/');
    expect((await agent.post('/api/v1/uploads/banner-image').attach('file', png, { filename: 'ad.png', contentType: 'image/png' })).status).toBe(403);
    expect((await admin.post('/api/v1/uploads/banner-image').attach('file', Buffer.from('x'), { filename: 'a.txt', contentType: 'text/plain' })).status).toBe(400);
  });
});
