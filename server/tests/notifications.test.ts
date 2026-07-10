import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';

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
