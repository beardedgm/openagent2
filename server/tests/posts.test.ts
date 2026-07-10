import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { Comment } from '../src/models/Comment.js';
import { Notification } from '../src/models/Notification.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createPost, publishPostSideEffects, setPinned, updatePost } from '../src/services/postService.js';

describe('Post model', () => {
  it('applies defaults', async () => {
    const u = await User.create({ email: 'a@x.com', hashedPassword: 'x', role: 'broker', displayName: 'a' });
    const p = await Post.create({ title: 'Hello', authorId: u.id });
    expect(p.officeId).toBeNull();
    expect(p.important).toBe(false);
    expect(p.commentsEnabled).toBe(true);
    expect(p.pinnedAt).toBeNull();
    expect(p.notifiedAt).toBeNull();
    expect(p.publishAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  it('supports keyword text search over title and bodyText', async () => {
    const u = await User.create({ email: 'b@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b' });
    await Post.create({ title: 'Commission update', bodyText: 'new split schedule', authorId: u.id });
    await Post.create({ title: 'Holiday party', bodyText: 'rooftop venue', authorId: u.id });
    await Post.init(); // ensure the text index exists before querying it
    const hits = await Post.find({ $text: { $search: 'rooftop' } });
    expect(hits).toHaveLength(1);
    expect(hits[0].title).toBe('Holiday party');
  });
});

describe('Comment model', () => {
  it('stores a flat comment against a post', async () => {
    const u = await User.create({ email: 'c@x.com', hashedPassword: 'x', role: 'agent', displayName: 'c' });
    const p = await Post.create({ title: 'T', authorId: u.id });
    const c = await Comment.create({ postId: p.id, authorId: u.id, body: 'Nice!' });
    expect(c.body).toBe('Nice!');
  });
});

async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('postService', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('createPost sanitizes html, derives bodyText, and announces immediately', async () => {
    const broker = await makeUser('br@x.com', 'broker');
    const agent = await makeUser('ag@x.com', 'agent');
    const post = await createPost(
      { title: 'Welcome', bodyHtml: '<p>Hi <script>x()</script><strong>all</strong></p>' },
      broker,
    );
    expect(post.bodyHtml).toBe('<p>Hi <strong>all</strong></p>');
    expect(post.bodyText).toBe('Hi all');
    expect(post.notifiedAt).not.toBeNull();
    expect(await ActivityEvent.countDocuments({ type: 'announcementPosted' })).toBe(1);
    // author excluded, agent notified
    expect(await Notification.countDocuments({ userId: agent.id, type: 'postPublished' })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(0);
    expect(sendEmailMock).not.toHaveBeenCalled(); // not important → no email
  });

  it('important posts email recipients per prefs', async () => {
    const broker = await makeUser('br2@x.com', 'broker');
    await makeUser('ag2@x.com', 'agent');
    const optedOut = await makeUser('ag3@x.com', 'agent');
    optedOut.emailPrefs = new Map([['postPublished', false]]) as never;
    await optedOut.save();
    await createPost({ title: 'Urgent', bodyHtml: '<p>x</p>', important: true }, broker);
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('ag2@x.com');
  });

  it('office-targeted posts notify that office plus admins only', async () => {
    const broker = await makeUser('br3@x.com', 'broker'); // officeId null — must still be notified
    const author = await makeUser('oa@x.com', 'officeAdmin');
    const officeA = '64b000000000000000000001';
    const inOffice = await makeUser('in@x.com', 'agent', officeA);
    const outOffice = await makeUser('out@x.com', 'agent', '64b000000000000000000002');
    await createPost({ title: 'Office A only', bodyHtml: '', officeId: officeA }, author);
    expect(await Notification.countDocuments({ userId: inOffice.id })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(1);
    expect(await Notification.countDocuments({ userId: outOffice.id })).toBe(0);
  });

  it('scheduled posts do not announce at creation; side effects run once when due', async () => {
    const broker = await makeUser('br4@x.com', 'broker');
    await makeUser('ag4@x.com', 'agent');
    const future = new Date(Date.now() + 60 * 60 * 1000);
    const post = await createPost({ title: 'Later', bodyHtml: '', publishAt: future.toISOString() }, broker);
    expect(post.notifiedAt).toBeNull();
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0);

    await publishPostSideEffects(post.id); // fires "early" — publishAt guard blocks it
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0);

    await Post.updateOne({ _id: post.id }, { $set: { publishAt: new Date(Date.now() - 1000) } });
    await publishPostSideEffects(post.id);
    await publishPostSideEffects(post.id); // idempotent — second call is a no-op
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(1);
    expect(await ActivityEvent.countDocuments({ type: 'announcementPosted' })).toBe(1);
  });

  it('updatePost re-sanitizes and cannot reschedule an already-announced post', async () => {
    const broker = await makeUser('br5@x.com', 'broker');
    const post = await createPost({ title: 'T', bodyHtml: '<p>a</p>' }, broker);
    const updated = await updatePost(post.id, {
      bodyHtml: '<p onclick="x()">b</p>',
      publishAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(updated.bodyHtml).toBe('<p>b</p>');
    expect(updated.notifiedAt).not.toBeNull(); // still announced
    expect(await Notification.countDocuments({ type: 'postPublished' })).toBe(0); // no re-announcement (broker was sole user)
  });

  it('setPinned enforces the max of 3', async () => {
    const broker = await makeUser('br6@x.com', 'broker');
    const posts = [];
    for (let i = 0; i < 4; i++) posts.push(await createPost({ title: `P${i}`, bodyHtml: '' }, broker));
    for (let i = 0; i < 3; i++) await setPinned(posts[i].id, true);
    await expect(setPinned(posts[3].id, true)).rejects.toThrow(/3 pinned/);
    await setPinned(posts[0].id, false);
    await expect(setPinned(posts[3].id, true)).resolves.toBeTruthy();
  });
});
