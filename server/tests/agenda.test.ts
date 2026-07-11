import { describe, expect, it } from 'vitest';
import type { Agenda } from 'agenda';
import { User } from '../src/models/User.js';
import { Post } from '../src/models/Post.js';
import { Notification } from '../src/models/Notification.js';
import { schedulePostPublish } from '../src/config/agenda.js';
import { registerJobs } from '../src/jobs/index.js';

type Handler = (job: { attrs: { data?: unknown } }) => Promise<void>;

function captureHandlers() {
  const handlers = new Map<string, Handler>();
  // Pick keeps the fake's define signature type-checked against the real Agenda.
  const fakeAgenda: Pick<Agenda, 'define'> = {
    define(name, options) {
      handlers.set(name, options as Handler);
    },
  };
  registerJobs(fakeAgenda as unknown as Agenda);
  return handlers;
}

describe('job registry', () => {
  it('registers publish-post and poll-rss', () => {
    const handlers = captureHandlers();
    expect([...handlers.keys()].sort()).toEqual(['event-reminders', 'poll-rss', 'publish-post']);
  });

  it('publish-post handler announces a due post exactly once', async () => {
    const broker = await User.create({ email: 'j@x.com', hashedPassword: 'x', role: 'broker', displayName: 'j' });
    const agent = await User.create({ email: 'k@x.com', hashedPassword: 'x', role: 'agent', displayName: 'k' });
    const post = await Post.create({ title: 'Due now', authorId: broker.id, publishAt: new Date(Date.now() - 1000) });
    const handler = captureHandlers().get('publish-post')!;
    await handler({ attrs: { data: { postId: post.id } } });
    await handler({ attrs: { data: { postId: post.id } } }); // Agenda retry — must be a no-op
    expect(await Notification.countDocuments({ userId: agent.id, type: 'postPublished' })).toBe(1);
  });

  it('schedulePostPublish cancels before scheduling (source-order guard)', () => {
    // The live ordering can't be exercised here: the module-level agenda instance
    // is null in tests (by design — the helpers no-op outside index.ts boot), and
    // mocking it would need an API change or a heavyweight vi.mock of 'agenda'.
    // So pin the cancel-then-schedule invariant statically via the function
    // source: repeated post edits must replace the pending job, never accumulate.
    const src = schedulePostPublish.toString();
    const cancelIdx = src.indexOf('.cancel(');
    const scheduleIdx = src.indexOf('.schedule(');
    expect(cancelIdx).toBeGreaterThan(-1);
    expect(scheduleIdx).toBeGreaterThan(-1);
    expect(cancelIdx).toBeLessThan(scheduleIdx);
  });
});
