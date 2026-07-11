import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { Comment } from '../src/models/Comment.js';
import { Notification } from '../src/models/Notification.js';
import { Post } from '../src/models/Post.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createPost, deletePost, publishPostSideEffects, setPinned, updatePost } from '../src/services/postService.js';

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

  it('deletePost removes the post and cascades to its comments', async () => {
    const broker = await makeUser('br7@x.com', 'broker');
    const post = await createPost({ title: 'Doomed', bodyHtml: '' }, broker);
    await Comment.create({ postId: post.id, authorId: broker.id, body: 'one' });
    await Comment.create({ postId: post.id, authorId: broker.id, body: 'two' });
    await deletePost(post.id);
    expect(await Post.findById(post.id)).toBeNull();
    expect(await Comment.countDocuments({ postId: post.id })).toBe(0);
    await expect(deletePost('64b000000000000000000009')).rejects.toThrow(/not found/i);
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

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('post routes', () => {
  it('officeAdmin creates a post; agent cannot', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pa@x.com', 'officeAdmin');
    const agent = await loginAs(app, 'pb@x.com', 'agent');
    expect((await agent.post('/api/v1/posts').send({ title: 'No', bodyHtml: '' })).status).toBe(403);
    const res = await admin.post('/api/v1/posts').send({ title: 'Yes', bodyHtml: '<p>hi</p>' });
    expect(res.status).toBe(201);
    expect(res.body.post.author.displayName).toBe('pa@x.com');
    expect(res.body.post.bodyHtml).toBe('<p>hi</p>');
  });

  it('agents see published all/own-office posts only; admins see scheduled too', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pc@x.com', 'broker');
    const officeA = '64b000000000000000000001';
    const agent = await loginAs(app, 'pd@x.com', 'agent', officeA);
    await admin.post('/api/v1/posts').send({ title: 'For everyone', bodyHtml: '' });
    await admin.post('/api/v1/posts').send({ title: 'For office A', bodyHtml: '', officeId: officeA });
    await admin.post('/api/v1/posts').send({ title: 'For office B', bodyHtml: '', officeId: '64b000000000000000000002' });
    await admin.post('/api/v1/posts').send({
      title: 'Scheduled',
      bodyHtml: '',
      publishAt: new Date(Date.now() + 3_600_000).toISOString(),
    });

    const agentList = await agent.get('/api/v1/posts');
    expect(agentList.body.posts.map((p: { title: string }) => p.title).sort()).toEqual(['For everyone', 'For office A']);
    const adminList = await admin.get('/api/v1/posts');
    expect(adminList.body.total).toBe(4);

    const officeB = adminList.body.posts.find((p: { title: string }) => p.title === 'For office B');
    expect((await agent.get(`/api/v1/posts/${officeB.id}`)).status).toBe(404);
    expect((await admin.get(`/api/v1/posts/${officeB.id}`)).status).toBe(200);
  });

  it('keyword search matches body text', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pe@x.com', 'broker');
    await admin.post('/api/v1/posts').send({ title: 'A', bodyHtml: '<p>quarterly commission schedule</p>' });
    await admin.post('/api/v1/posts').send({ title: 'B', bodyHtml: '<p>parking reminder</p>' });
    const res = await admin.get('/api/v1/posts?q=commission');
    expect(res.body.posts).toHaveLength(1);
    expect(res.body.posts[0].title).toBe('A');
  });

  it('pins via route with the max-3 limit surfaced as 400', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pf@x.com', 'broker');
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const r = await admin.post('/api/v1/posts').send({ title: `P${i}`, bodyHtml: '' });
      ids.push(r.body.post.id);
    }
    for (let i = 0; i < 3; i++) expect((await admin.post(`/api/v1/posts/${ids[i]}/pin`)).status).toBe(200);
    expect((await admin.post(`/api/v1/posts/${ids[3]}/pin`)).status).toBe(400);
    expect((await admin.delete(`/api/v1/posts/${ids[0]}/pin`)).status).toBe(200);
    expect((await admin.post(`/api/v1/posts/${ids[3]}/pin`)).status).toBe(200);
    // pinned posts sort first
    const list = await admin.get('/api/v1/posts');
    expect(list.body.posts[0].pinnedAt).not.toBeNull();
  });

  it('deleting a post removes its comments', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'pg@x.com', 'broker');
    const r = await admin.post('/api/v1/posts').send({ title: 'Del', bodyHtml: '' });
    const adminUser = (await User.findOne({ email: 'pg@x.com' }))!;
    await Comment.create({ postId: r.body.post.id, authorId: adminUser.id, body: 'hi' });
    expect((await admin.delete(`/api/v1/posts/${r.body.post.id}`)).status).toBe(200);
    expect(await Comment.countDocuments()).toBe(0);
    expect((await admin.get(`/api/v1/posts/${r.body.post.id}`)).status).toBe(404);
  });

  it('rejects invalid bodies', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'ph@x.com', 'broker');
    expect((await admin.post('/api/v1/posts').send({ bodyHtml: '' })).status).toBe(400); // no title
    expect((await admin.post('/api/v1/posts').send({ title: 'x', bodyHtml: '', publishAt: 'tomorrow' })).status).toBe(400);
  });
});

describe('comment routes', () => {
  it('any user comments on a visible post; author and admin can delete, others cannot', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'ca@x.com', 'broker');
    const alice = await loginAs(app, 'cb@x.com', 'agent');
    const bob = await loginAs(app, 'cc@x.com', 'agent');
    const post = (await admin.post('/api/v1/posts').send({ title: 'C', bodyHtml: '' })).body.post;

    const created = await alice.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'First!' });
    expect(created.status).toBe(201);
    expect(created.body.comment.author.displayName).toBe('cb@x.com');

    const list = await bob.get(`/api/v1/posts/${post.id}/comments`);
    expect(list.body.comments).toHaveLength(1);

    expect((await bob.delete(`/api/v1/posts/${post.id}/comments/${created.body.comment.id}`)).status).toBe(403);
    expect((await alice.delete(`/api/v1/posts/${post.id}/comments/${created.body.comment.id}`)).status).toBe(200);

    const again = await bob.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'Second' });
    expect((await admin.delete(`/api/v1/posts/${post.id}/comments/${again.body.comment.id}`)).status).toBe(200);
    expect(await Comment.countDocuments()).toBe(0);
  });

  it('rejects comments when the author disabled them', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'cd@x.com', 'broker');
    const agent = await loginAs(app, 'ce@x.com', 'agent');
    const post = (await admin.post('/api/v1/posts').send({ title: 'Quiet', bodyHtml: '', commentsEnabled: false }))
      .body.post;
    expect((await agent.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'hi' })).status).toBe(403);
  });

  it('cannot comment on a post outside visibility', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'cf@x.com', 'broker');
    const agent = await loginAs(app, 'cg@x.com', 'agent', '64b000000000000000000001');
    const post = (
      await admin.post('/api/v1/posts').send({ title: 'B only', bodyHtml: '', officeId: '64b000000000000000000002' })
    ).body.post;
    expect((await agent.post(`/api/v1/posts/${post.id}/comments`).send({ body: 'hi' })).status).toBe(404);
  });
});
