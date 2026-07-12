import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSettings } from '../src/models/Settings.js';
import { Notification } from '../src/models/Notification.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { notify } from '../src/services/notificationService.js';

async function makeUser(email: string, emailPrefs: Record<string, boolean> = {}) {
  return User.create({ email, hashedPassword: 'x', role: 'agent', displayName: email, emailPrefs });
}

async function setDefault(type: string, value: boolean) {
  const settings = await getSettings();
  (settings.notificationDefaults as Map<string, boolean>).set(type, value);
  await settings.save();
}

describe('notificationService brokerage-wide email defaults', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('sends email when neither user pref nor brokerage default is set (fallback true)', async () => {
    const a = await makeUser('a@x.com');
    await notify([a.id], { type: 'postPublished', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).toHaveBeenCalledWith('a@x.com', 's', 'h');
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('suppresses email when user pref is unset but brokerage default is false', async () => {
    const a = await makeUser('a@x.com');
    await setDefault('postPublished', false);
    await notify([a.id], { type: 'postPublished', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('sends email when user pref is true even though brokerage default is false (user wins)', async () => {
    const a = await makeUser('a@x.com', { postPublished: true });
    await setDefault('postPublished', false);
    await notify([a.id], { type: 'postPublished', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).toHaveBeenCalledWith('a@x.com', 's', 'h');
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('suppresses email when user pref is false even though brokerage default is true (user wins)', async () => {
    const a = await makeUser('a@x.com', { postPublished: false });
    await setDefault('postPublished', true);
    await notify([a.id], { type: 'postPublished', title: 't' }, { subject: 's', html: 'h' });
    expect(sendEmailMock).not.toHaveBeenCalled();
    expect(await Notification.countDocuments()).toBe(1);
  });

  it('nonDisableable still sends even when both user pref and brokerage default are false', async () => {
    const a = await makeUser('a@x.com', { postPublished: false });
    await setDefault('postPublished', false);
    await notify([a.id], { type: 'postPublished', title: 't' }, { subject: 's', html: 'h', nonDisableable: true });
    expect(sendEmailMock).toHaveBeenCalledWith('a@x.com', 's', 'h');
    expect(await Notification.countDocuments()).toBe(1);
  });
});
