import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { Category } from '../src/models/Category.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('categories', () => {
  it('admin creates a two-level tree; agents read it; agents cannot write', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c1@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'c2@x.com', 'agent');

    const top = await admin.post('/api/v1/categories').send({ name: 'Marketing' });
    expect(top.status).toBe(201);
    const sub = await admin.post('/api/v1/categories').send({ name: 'Templates', parentId: top.body.category.id });
    expect(sub.status).toBe(201);
    expect(sub.body.category.parentId).toBe(top.body.category.id);

    const tree = await agent.get('/api/v1/categories');
    expect(tree.status).toBe(200);
    expect(tree.body.categories).toHaveLength(2);
    const names = tree.body.categories.map((c: { name: string }) => c.name).sort();
    expect(names).toEqual(['Marketing', 'Templates']);

    expect((await agent.post('/api/v1/categories').send({ name: 'Nope' })).status).toBe(403);
  });

  it('enforces two-level depth: a subcategory cannot be a parent', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c3@x.com', 'broker');
    const top = (await admin.post('/api/v1/categories').send({ name: 'Compliance' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Forms', parentId: top.id })).body.category;
    const res = await admin.post('/api/v1/categories').send({ name: 'Too deep', parentId: sub.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/two levels/i);
  });

  it('rename works; deletion is refused while children exist, allowed after', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'c4@x.com', 'broker');
    const top = (await admin.post('/api/v1/categories').send({ name: 'Training' })).body.category;
    const sub = (await admin.post('/api/v1/categories').send({ name: 'Scripts', parentId: top.id })).body.category;

    const renamed = await admin.patch(`/api/v1/categories/${top.id}`).send({ name: 'Training & Dev' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.category.name).toBe('Training & Dev');

    expect((await admin.delete(`/api/v1/categories/${top.id}`)).status).toBe(400); // has a child
    expect((await admin.delete(`/api/v1/categories/${sub.id}`)).status).toBe(200);
    expect((await admin.delete(`/api/v1/categories/${top.id}`)).status).toBe(200); // now empty
    expect(await Category.countDocuments()).toBe(0);
  });
});
