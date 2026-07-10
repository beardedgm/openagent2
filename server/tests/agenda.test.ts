import { describe, expect, it } from 'vitest';
import { User } from '../src/models/User.js';
import { Post } from '../src/models/Post.js';
import { Notification } from '../src/models/Notification.js';
import { registerJobs } from '../src/jobs/index.js';

type Handler = (job: { attrs: { data?: unknown } }) => Promise<void>;

function captureHandlers() {
  const handlers = new Map<string, Handler>();
  const fakeAgenda = { define: (name: string, fn: Handler) => handlers.set(name, fn) };
  registerJobs(fakeAgenda as never);
  return handlers;
}

describe('job registry', () => {
  it('registers publish-post and poll-rss', () => {
    const handlers = captureHandlers();
    expect([...handlers.keys()].sort()).toEqual(['poll-rss', 'publish-post']);
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
});
