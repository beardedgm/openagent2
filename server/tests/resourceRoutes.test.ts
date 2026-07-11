import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Resource } from '../src/models/Resource.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('resource routes', () => {
  it('office targeting: agents see all-users + own office; admins see everything; fileless file-resources hidden from agents; category delete guarded', async () => {
    const app = createApp();
    const officeA = '64b000000000000000000001';
    const admin = await loginAs(app, 'rr1@x.com', 'officeAdmin');
    const agentA = await loginAs(app, 'rr2@x.com', 'agent', officeA);
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Marketing' })).body.category;

    await admin.post('/api/v1/resources').send({ title: 'Everyone', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id });
    await admin.post('/api/v1/resources').send({ title: 'Office A only', kind: 'link', externalUrl: 'https://b.example.com', categoryId: cat.id, officeId: officeA });
    await admin.post('/api/v1/resources').send({ title: 'Other office', kind: 'link', externalUrl: 'https://c.example.com', categoryId: cat.id, officeId: '64b000000000000000000002' });
    await admin.post('/api/v1/resources').send({ title: 'Pending file', kind: 'file', categoryId: cat.id }); // no file yet

    const forAgent = await agentA.get('/api/v1/resources');
    expect(forAgent.body.resources.map((r: { title: string }) => r.title).sort()).toEqual(['Everyone', 'Office A only']);
    const forAdmin = await admin.get('/api/v1/resources');
    expect(forAdmin.body.total).toBe(4);
    // detail parity: invisible = 404
    const hidden = (await Resource.findOne({ title: 'Other office' }))!.id;
    expect((await agentA.get(`/api/v1/resources/${hidden}`)).status).toBe(404);
    // Task 1's raw-collection delete guard is now active: the category has resources → 400
    expect((await admin.delete(`/api/v1/categories/${cat.id}`)).status).toBe(400);
  });

  it('search + filters: q matches title/description, categoryId includes subcategories, fileType filters', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr3@x.com', 'broker');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Training' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Scripts', parentId: cat.id })).body.category;
    await admin.post('/api/v1/resources').send({ title: 'Cold call script', description: 'openers and objections', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id, subcategoryId: sub.id });
    await admin.post('/api/v1/resources').send({ title: 'Brand book', kind: 'link', externalUrl: 'https://b.example.com', categoryId: cat.id });

    expect((await admin.get('/api/v1/resources?q=objections')).body.resources).toHaveLength(1);
    expect((await admin.get(`/api/v1/resources?categoryId=${cat.id}`)).body.resources).toHaveLength(2); // parent includes child
    expect((await admin.get(`/api/v1/resources?categoryId=${sub.id}`)).body.resources).toHaveLength(1);
    expect((await admin.get('/api/v1/resources?fileType=link')).body.resources).toHaveLength(2);
    expect((await admin.get('/api/v1/resources?fileType=pdf')).body.resources).toHaveLength(0);
  });

  it('bookmark round-trip: toggle, bookmarked flag in lists, scope=mine', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr4@x.com', 'broker');
    const agent = await loginAs(app, 'rr5@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Forms' })).body.category;
    const r = (await admin.post('/api/v1/resources').send({ title: 'W-9', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect((await agent.post(`/api/v1/resources/${r.id}/bookmark`)).status).toBe(200);
    expect((await agent.post(`/api/v1/resources/${r.id}/bookmark`)).status).toBe(200); // idempotent
    const list = await agent.get('/api/v1/resources');
    expect(list.body.resources[0].bookmarked).toBe(true);
    expect((await agent.get('/api/v1/resources?scope=mine')).body.resources).toHaveLength(1);
    await agent.delete(`/api/v1/resources/${r.id}/bookmark`);
    expect((await agent.get('/api/v1/resources?scope=mine')).body.resources).toHaveLength(0);
  });

  it('featured: broker-only toggle, featured endpoint respects visibility, agents cannot write resources', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'rr6@x.com', 'broker');
    const officeAdmin = await loginAs(app, 'rr7@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rr8@x.com', 'agent');
    const cat = (await broker.post('/api/v1/categories').send({ name: 'Hot' })).body.category;
    const r = (await broker.post('/api/v1/resources').send({ title: 'Playbook', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect((await officeAdmin.post(`/api/v1/resources/${r.id}/featured`)).status).toBe(403); // PRD: Broker/Owner marks featured
    expect((await broker.post(`/api/v1/resources/${r.id}/featured`)).status).toBe(200);
    expect((await agent.get('/api/v1/resources/featured')).body.resources.map((x: { title: string }) => x.title)).toEqual(['Playbook']);
    expect((await broker.delete(`/api/v1/resources/${r.id}/featured`)).status).toBe(200);
    expect((await agent.get('/api/v1/resources/featured')).body.resources).toHaveLength(0);
    expect((await agent.post('/api/v1/resources').send({ title: 'Nope', kind: 'link', externalUrl: 'https://x.example.com', categoryId: cat.id })).status).toBe(403);
  });

  it('detail includes versions for admins only; PATCH and DELETE work', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'rr9@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'rr10@x.com', 'agent');
    const cat = (await admin.post('/api/v1/categories').send({ name: 'Docs' })).body.category;
    const r = (await admin.post('/api/v1/resources').send({ title: 'Guide', kind: 'link', externalUrl: 'https://a.example.com', categoryId: cat.id })).body.resource;

    expect('versions' in (await admin.get(`/api/v1/resources/${r.id}`)).body.resource).toBe(true);
    expect('versions' in (await agent.get(`/api/v1/resources/${r.id}`)).body.resource).toBe(false);
    const patched = await admin.patch(`/api/v1/resources/${r.id}`).send({ title: 'Guide v2' });
    expect(patched.status).toBe(200);
    expect(patched.body.resource.title).toBe('Guide v2');
    expect((await admin.delete(`/api/v1/resources/${r.id}`)).status).toBe(200);
    expect((await admin.get(`/api/v1/resources/${r.id}`)).status).toBe(404);
  });
});
