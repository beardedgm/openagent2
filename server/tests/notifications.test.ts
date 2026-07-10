import request from 'supertest';
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { createApp } from '../src/app.js';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
// Spread the original module — Task 3 appends route tests to this file whose import
// graph (createApp → authService/invitationService) needs the other email exports.
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { notify } from '../src/services/notificationService.js';

async function makeUser(email: string, emailPrefs: Record<string, boolean> = {}) {
  return User.create({ email, hashedPassword: 'x', role: 'agent', displayName: email, emailPrefs });
}

describe('notificationService.notify', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('creates an in-app notification per recipient', async () => {
    const a = await makeUser('a@x.com');
    const b = await makeUser('b@x.com');
    await notify([a.id, b.id], { type: 'invitationAccepted', title: 'Someone joined', link: '/admin/users' });
    const docs = await Notification.find().sort({ userId: 1 });
    expect(docs).toHaveLength(2);
    expect(docs[0].title).toBe('Someone joined');
    expect(docs[0].readAt).toBeNull();
    expect(sendEmailMock).not.toHaveBeenCalled(); // no email payload given
  });

  it('sends email when no pref is set (default true)', async () => {
    const a = await makeUser('a@x.com');
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: '<p>h</p>' });
    expect(sendEmailMock).toHaveBeenCalledWith('a@x.com', 's', '<p>h</p>');
  });

  it('honors an explicit opt-out pref', async () => {
    const a = await makeUser('a@x.com', { invitationAccepted: false });
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await Notification.countDocuments()).toBe(1); // in-app always created
  });

  it('nonDisableable overrides the opt-out pref', async () => {
    const a = await makeUser('a@x.com', { invitationAccepted: false });
    await notify([a.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h', nonDisableable: true });
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });

  it('skips email to deactivated users and survives a send failure', async () => {
    const a = await makeUser('a@x.com');
    const b = await makeUser('b@x.com');
    b.status = 'deactivated';
    await b.save();
    sendEmailMock.mockRejectedValueOnce(new Error('smtp down'));
    await expect(
      notify([a.id, b.id], { type: 'invitationAccepted', title: 't' }, { subject: 's', html: 'h' }),
    ).resolves.toBeUndefined();
    expect(sendEmailMock).toHaveBeenCalledTimes(1); // only the active user, failure swallowed
  });

  it('is a no-op for an empty recipient list', async () => {
    await notify([], { type: 'invitationAccepted', title: 't' });
    expect(await Notification.countDocuments()).toBe(0);
  });
});

async function loginAs(app: ReturnType<typeof createApp>, email: string) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role: 'agent', displayName: email });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('notification routes', () => {
  it('lists own notifications newest-first with unread count and cursor', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n1@x.com');
    const me = (await User.findOne({ email: 'n1@x.com' }))!;
    const other = await User.create({ email: 'o@x.com', hashedPassword: 'x', role: 'agent', displayName: 'o' });
    // Explicit distinct createdAt values keep the newest-first ordering deterministic.
    // Mongoose keeps a caller-provided createdAt. (Same-millisecond ties are covered
    // by the dedicated tie-break test below.)
    for (let i = 0; i < 25; i++) {
      await Notification.create({
        userId: me.id,
        type: 'invitationAccepted',
        title: `n${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      } as never);
    }
    await Notification.create({ userId: other.id, type: 'invitationAccepted', title: 'not mine' });

    const res = await agent.get('/api/v1/notifications');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(20);
    expect(res.body.notifications[0].title).toBe('n0'); // newest first
    expect(res.body.unreadCount).toBe(25); // scoped to me — the other user's row is excluded
    expect(res.body.nextCursor).toBeTruthy();

    const page2 = await agent.get(`/api/v1/notifications?before=${encodeURIComponent(res.body.nextCursor)}`);
    expect(page2.body.notifications).toHaveLength(5);
    expect(page2.body.notifications.map((n: { title: string }) => n.title)).not.toContain('not mine');
    expect(page2.body.nextCursor).toBeNull(); // final partial page
  });

  it('paginates without dropping rows when createdAt ties span the page boundary', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n3@x.com');
    const me = (await User.findOne({ email: 'n3@x.com' }))!;
    const base = Date.now();
    for (let i = 0; i < 25; i++) {
      // Rows 17–22 share one exact millisecond, straddling the 20-row page boundary.
      const tied = i >= 17 && i <= 22;
      await Notification.create({
        userId: me.id,
        type: 'invitationAccepted',
        title: `t${i}`,
        createdAt: new Date(tied ? base - 17 * 60_000 : base - i * 60_000),
      } as never);
    }
    const page1 = await agent.get('/api/v1/notifications');
    expect(page1.status).toBe(200);
    expect(page1.body.notifications).toHaveLength(20);
    const page2 = await agent.get(`/api/v1/notifications?before=${encodeURIComponent(page1.body.nextCursor)}`);
    expect(page2.status).toBe(200);
    expect(page2.body.notifications).toHaveLength(5);
    const titles = [...page1.body.notifications, ...page2.body.notifications].map((n: { title: string }) => n.title);
    expect(new Set(titles).size).toBe(25); // every row seen exactly once across pages
    expect([...titles].sort()).toEqual(Array.from({ length: 25 }, (_, i) => `t${i}`).sort());
  });

  it('ignores a malformed cursor and serves the first page', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n4@x.com');
    const me = (await User.findOne({ email: 'n4@x.com' }))!;
    for (let i = 0; i < 25; i++) {
      await Notification.create({
        userId: me.id,
        type: 'invitationAccepted',
        title: `m${i}`,
        createdAt: new Date(Date.now() - i * 60_000),
      } as never);
    }
    const res = await agent.get('/api/v1/notifications?before=notadate');
    expect(res.status).toBe(200);
    expect(res.body.notifications).toHaveLength(20);
  });

  it('returns 400 for a malformed notification id', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n5@x.com');
    expect((await agent.post('/api/v1/notifications/abc/read')).status).toBe(400);
  });

  it('marks one read, then all read; cannot mark another user’s notification', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'n2@x.com');
    const me = (await User.findOne({ email: 'n2@x.com' }))!;
    const other = await User.create({ email: 'o2@x.com', hashedPassword: 'x', role: 'agent', displayName: 'o' });
    const mine = await Notification.create({ userId: me.id, type: 'invitationAccepted', title: 'a' });
    await Notification.create({ userId: me.id, type: 'invitationAccepted', title: 'b' });
    const theirs = await Notification.create({ userId: other.id, type: 'invitationAccepted', title: 'c' });

    expect((await agent.post(`/api/v1/notifications/${mine.id}/read`)).status).toBe(200);
    expect((await Notification.findById(mine.id))!.readAt).not.toBeNull();

    expect((await agent.post(`/api/v1/notifications/${theirs.id}/read`)).status).toBe(404);
    expect((await Notification.findById(theirs.id))!.readAt).toBeNull();

    expect((await agent.post('/api/v1/notifications/read-all')).status).toBe(200);
    expect(await Notification.countDocuments({ userId: me.id, readAt: null })).toBe(0);
    expect((await Notification.findById(theirs.id))!.readAt).toBeNull();
  });

  it('requires auth', async () => {
    const app = createApp();
    expect((await request(app).get('/api/v1/notifications')).status).toBe(401);
  });
});
