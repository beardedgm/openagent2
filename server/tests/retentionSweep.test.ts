import { describe, expect, it } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { RssItem } from '../src/models/RssItem.js';
import { Task } from '../src/models/Task.js';
import { User } from '../src/models/User.js';
import { sweepRetention } from '../src/jobs/retentionSweep.js';

function daysAgo(n: number): Date {
  return new Date(Date.now() - n * 86_400_000);
}

// Mongoose marks createdAt immutable, so a mongoose-level update silently drops
// the $set — back-date through the raw collection instead (precedent: feed.test.ts).
async function backdate(collection: { updateOne: (filter: object, update: object) => Promise<unknown> }, id: unknown, createdAt: Date) {
  await collection.updateOne({ _id: id }, { $set: { createdAt } });
}

describe('sweepRetention', () => {
  it('deletes ActivityEvent older than 90 days unless pinned into the future', async () => {
    const old = await ActivityEvent.create({ type: 'agentJoined', message: 'old unpinned' });
    await backdate(ActivityEvent.collection, old._id, daysAgo(91));

    const recent = await ActivityEvent.create({ type: 'agentJoined', message: 'recent' });
    await backdate(ActivityEvent.collection, recent._id, daysAgo(89));

    const pinned = await ActivityEvent.create({
      type: 'agentJoined',
      message: 'old but pinned',
      pinnedUntil: daysAgo(-7), // 7 days in the future
    });
    await backdate(ActivityEvent.collection, pinned._id, daysAgo(91));

    const counts = await sweepRetention();

    expect(counts.activity).toBe(1);
    expect(await ActivityEvent.findById(old._id)).toBeNull();
    expect(await ActivityEvent.findById(recent._id)).not.toBeNull();
    expect(await ActivityEvent.findById(pinned._id)).not.toBeNull();
  });

  it('deletes RssItem older than 30 days, keeps newer items', async () => {
    const old = await RssItem.create({ feedUrl: 'f', guid: 'old', title: 'old item', publishedAt: new Date() });
    await backdate(RssItem.collection, old._id, daysAgo(31));

    const recent = await RssItem.create({ feedUrl: 'f', guid: 'recent', title: 'recent item', publishedAt: new Date() });
    await backdate(RssItem.collection, recent._id, daysAgo(29));

    const counts = await sweepRetention();

    expect(counts.rss).toBe(1);
    expect(await RssItem.findById(old._id)).toBeNull();
    expect(await RssItem.findById(recent._id)).not.toBeNull();
  });

  it('deletes Task history older than 2 years unless it is still an active recurrence', async () => {
    const broker = await User.create({ email: 'ret1@x.com', hashedPassword: 'x', role: 'broker', displayName: 'ret1' });

    const old = await Task.create({ title: 'ancient one-off', createdBy: broker.id, audience: { type: 'all' } });
    await backdate(Task.collection, old._id, daysAgo(25 * 30));

    const oldRecurring = await Task.create({
      title: 'ancient recurring parent',
      createdBy: broker.id,
      audience: { type: 'all' },
      recurrence: 'weekly',
      nextRecurrenceAt: new Date(Date.now() + 3_600_000),
    });
    await backdate(Task.collection, oldRecurring._id, daysAgo(25 * 30));

    const recent = await Task.create({ title: 'recent one-off', createdBy: broker.id, audience: { type: 'all' } });
    await backdate(Task.collection, recent._id, daysAgo(23 * 30));

    const counts = await sweepRetention();

    expect(counts.tasks).toBe(1);
    expect(await Task.findById(old._id)).toBeNull();
    expect(await Task.findById(oldRecurring._id)).not.toBeNull();
    expect(await Task.findById(recent._id)).not.toBeNull();
  });

  it('returns per-collection deleted counts', async () => {
    const broker = await User.create({ email: 'ret2@x.com', hashedPassword: 'x', role: 'broker', displayName: 'ret2' });

    const oldActivity = await ActivityEvent.create({ type: 'agentJoined', message: 'old' });
    await backdate(ActivityEvent.collection, oldActivity._id, daysAgo(91));
    const oldRss = await RssItem.create({ feedUrl: 'f', guid: 'g1', title: 'old', publishedAt: new Date() });
    await backdate(RssItem.collection, oldRss._id, daysAgo(31));
    const oldTask = await Task.create({ title: 'old', createdBy: broker.id, audience: { type: 'all' } });
    await backdate(Task.collection, oldTask._id, daysAgo(25 * 30));

    const counts = await sweepRetention();

    expect(counts).toEqual({ activity: 1, rss: 1, tasks: 1 });
  });
});
