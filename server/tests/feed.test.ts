import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { RssItem } from '../src/models/RssItem.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

describe('feed', () => {
  it('merges internal and external items newest-first with a working cursor', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'f1@x.com', 'agent');
    for (let i = 0; i < 15; i++) {
      const e = await ActivityEvent.create({ type: 'agentJoined', message: `internal ${i}` });
      // Back-date through the raw collection — mongoose marks createdAt immutable,
      // so a mongoose-level update would silently drop the $set.
      await ActivityEvent.collection.updateOne({ _id: e._id }, { $set: { createdAt: daysAgo(i * 2) } });
      await RssItem.create({
        feedUrl: 'f',
        guid: `g${i}`,
        title: `external ${i}`,
        publishedAt: daysAgo(i * 2 + 1),
      });
    }
    const page1 = await agent.get('/api/v1/feed');
    expect(page1.status).toBe(200);
    expect(page1.body.items).toHaveLength(20);
    expect(page1.body.items[0].title).toBe('internal 0');
    expect(page1.body.items[1].title).toBe('external 0'); // strict date interleave
    expect(page1.body.nextCursor).toBeTruthy();

    const page2 = await agent.get(`/api/v1/feed?before=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.body.items).toHaveLength(10);
    const all = [...page1.body.items, ...page2.body.items].map((i: { title: string }) => i.title);
    expect(new Set(all).size).toBe(30); // no duplicates across pages
  });

  it('filters internal-only and external-only', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'f2@x.com', 'agent');
    await ActivityEvent.create({ type: 'agentJoined', message: 'int' });
    await RssItem.create({ feedUrl: 'f', guid: 'g', title: 'ext', publishedAt: new Date() });
    const internal = await agent.get('/api/v1/feed?filter=internal');
    expect(internal.body.items.map((i: { kind: string }) => i.kind)).toEqual(['internal']);
    const external = await agent.get('/api/v1/feed?filter=external');
    expect(external.body.items.map((i: { kind: string }) => i.kind)).toEqual(['external']);
  });

  it('office-scoped events hide from other offices, show to admins', async () => {
    const app = createApp();
    const officeA = '64b000000000000000000001';
    const agentB = await loginAs(app, 'f3@x.com', 'agent', '64b000000000000000000002');
    const broker = await loginAs(app, 'f4@x.com', 'broker');
    await ActivityEvent.create({ type: 'announcementPosted', message: 'A only', officeId: officeA });
    expect((await agentB.get('/api/v1/feed')).body.items).toHaveLength(0);
    expect((await broker.get('/api/v1/feed')).body.items).toHaveLength(1);
  });

  it('broker pins an item to the top for 7 days; agents cannot pin', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'f5@x.com', 'broker');
    const agent = await loginAs(app, 'f6@x.com', 'agent');
    const e = await ActivityEvent.create({ type: 'agentJoined', message: 'pin me' });
    await ActivityEvent.create({ type: 'agentJoined', message: 'newer' });

    expect((await agent.post(`/api/v1/feed/${e.id}/pin`)).status).toBe(403);
    const pinRes = await broker.post(`/api/v1/feed/${e.id}/pin`);
    expect(pinRes.status).toBe(200);
    const until = new Date(pinRes.body.item.pinnedUntil).getTime();
    expect(until).toBeGreaterThan(Date.now() + 6.9 * 86_400_000);
    expect(until).toBeLessThan(Date.now() + 7.1 * 86_400_000);

    const feed = await agent.get('/api/v1/feed');
    expect(feed.body.pinned).toHaveLength(1);
    expect(feed.body.pinned[0].title).toBe('pin me');
    expect(feed.body.items.map((i: { title: string }) => i.title)).toEqual(['newer']); // pinned excluded from stream

    expect((await broker.delete(`/api/v1/feed/${e.id}/pin`)).status).toBe(200);
    const after = await agent.get('/api/v1/feed');
    expect(after.body.pinned).toHaveLength(0);
    expect(after.body.items).toHaveLength(2);
  });

  it('user-scoped events show only to that user', async () => {
    const app = createApp();
    const alice = await loginAs(app, 'f7@x.com', 'agent');
    const bob = await loginAs(app, 'f8@x.com', 'agent');
    const aliceUser = (await User.findOne({ email: 'f7@x.com' }))!;
    await ActivityEvent.create({ type: 'taskCompleted', message: 'You completed: File taxes', userId: aliceUser.id });
    await ActivityEvent.create({ type: 'agentJoined', message: 'public event' });

    const aliceFeed = await alice.get('/api/v1/feed');
    expect(aliceFeed.body.items.map((i: { title: string }) => i.title).sort()).toEqual([
      'You completed: File taxes',
      'public event',
    ]);
    const bobFeed = await bob.get('/api/v1/feed');
    expect(bobFeed.body.items.map((i: { title: string }) => i.title)).toEqual(['public event']);
  });
});
