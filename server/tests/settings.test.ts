import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { TaskTemplate } from '../src/models/TaskTemplate.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: role });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('settings', () => {
  let app: ReturnType<typeof createApp>;
  beforeEach(() => {
    app = createApp();
  });

  it('serves public branding without auth', async () => {
    const res = await request(app).get('/api/v1/settings/public');
    expect(res.status).toBe(200);
    expect(res.body.settings.brandName).toBe('My Brokerage');
    expect(res.body.settings.primaryColor).toBe('#1d4ed8');
  });

  it('broker updates settings; officeAdmin cannot', async () => {
    const broker = await loginAs(app, 'b@x.com', 'broker');
    const admin = await loginAs(app, 'a@x.com', 'officeAdmin');
    const patch = {
      brandName: 'Acme Realty',
      primaryColor: '#0f766e',
      officeLocations: [{ name: 'HQ', address: '1 Main St', timezone: 'America/New_York' }],
      rssFeeds: ['https://example.com/feed.xml'],
    };
    expect((await admin.patch('/api/v1/admin/settings').send(patch)).status).toBe(403);
    const res = await broker.patch('/api/v1/admin/settings').send(patch);
    expect(res.status).toBe(200);
    expect(res.body.settings.brandName).toBe('Acme Realty');
    expect(res.body.settings.officeLocations[0].name).toBe('HQ');
    expect((await request(app).get('/api/v1/settings/public')).body.settings.primaryColor).toBe('#0f766e');
  });

  it('rejects invalid colors and >10 rss feeds', async () => {
    const broker = await loginAs(app, 'b2@x.com', 'broker');
    expect((await broker.patch('/api/v1/admin/settings').send({ primaryColor: 'red' })).status).toBe(400);
    const feeds = Array.from({ length: 11 }, (_, i) => `https://e.com/${i}.xml`);
    expect((await broker.patch('/api/v1/admin/settings').send({ rssFeeds: feeds })).status).toBe(400);
  });

  it('authenticated users can read full settings', async () => {
    const agent = await loginAs(app, 'ag@x.com', 'agent');
    const res = await agent.get('/api/v1/settings');
    expect(res.status).toBe(200);
    expect(res.body.settings.homepageLayout).toContain('welcome');
  });

  it('broker manages reservable resources', async () => {
    const broker = await loginAs(app, 'b3@x.com', 'broker');
    const res = await broker
      .patch('/api/v1/admin/settings')
      .send({ reservableResources: [{ name: 'Conference Room A' }, { name: 'Training Room' }] });
    expect(res.status).toBe(200);
    expect(res.body.settings.reservableResources).toHaveLength(2);
    expect(res.body.settings.reservableResources[0].name).toBe('Conference Room A');
    expect(res.body.settings.reservableResources[0]._id).toBeTruthy(); // events reference this id

    // Round-trip: echoed _ids must survive an edit — calendar events reference them,
    // so regenerating ids on every admin save would dangle those references.
    const firstId = res.body.settings.reservableResources[0]._id;
    const secondId = res.body.settings.reservableResources[1]._id;
    const edited = await broker.patch('/api/v1/admin/settings').send({
      reservableResources: [
        { _id: firstId, name: 'Conference Room A' },
        { _id: secondId, name: 'Training Room B' },
      ],
    });
    expect(edited.status).toBe(200);
    expect(edited.body.settings.reservableResources[0]._id).toBe(firstId);
    expect(edited.body.settings.reservableResources[1].name).toBe('Training Room B');
  });

  it('validates onboardingTaskTemplateId against real templates and allows clearing it', async () => {
    const broker = await loginAs(app, 'b4@x.com', 'broker');

    const bogus = await broker.patch('/api/v1/admin/settings').send({ onboardingTaskTemplateId: '64b0000000000000000000ff' });
    expect(bogus.status).toBe(400);

    const tpl = await TaskTemplate.create({ name: 'Onboarding', items: [{ title: 'Sign policies' }] });
    const real = await broker.patch('/api/v1/admin/settings').send({ onboardingTaskTemplateId: tpl.id });
    expect(real.status).toBe(200);
    expect(real.body.settings.onboardingTaskTemplateId).toBe(tpl.id);

    const cleared = await broker.patch('/api/v1/admin/settings').send({ onboardingTaskTemplateId: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.settings.onboardingTaskTemplateId).toBeNull();
  });
});
