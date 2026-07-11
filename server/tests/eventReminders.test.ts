import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { sweepEventReminders } from '../src/jobs/eventReminders.js';

async function optedInUser(email: string, extra: Record<string, unknown> = {}) {
  return User.create({
    email, hashedPassword: 'x', role: 'agent', displayName: email,
    emailPrefs: { eventReminders: true }, ...extra,
  });
}

describe('sweepEventReminders', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('emails opted-in RSVP-yes attendees inside the 24h window, exactly once', async () => {
    const broker = await User.create({ email: 'b@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b' });
    const yes = await optedInUser('yes@x.com');
    const yesButOptedOut = await User.create({ email: 'out@x.com', hashedPassword: 'x', role: 'agent', displayName: 'out' });
    const maybe = await optedInUser('maybe@x.com');
    const startAt = new Date(Date.now() + 24 * 3_600_000 + 5 * 60_000); // 24h + 5min from now
    await CalendarEvent.create({
      title: 'Training', kind: 'office', createdBy: broker.id, rsvpEnabled: true,
      startAt, endAt: new Date(startAt.getTime() + 3_600_000),
      rsvps: [
        { userId: yes.id, response: 'yes' },
        { userId: yesButOptedOut.id, response: 'yes' },
        { userId: maybe.id, response: 'maybe' },
      ],
    });
    await sweepEventReminders();
    await sweepEventReminders(); // second sweep: latch makes it a no-op
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('yes@x.com');
  });

  it('mandatory events remind all targeted opted-in users; outside-window events are untouched', async () => {
    const broker = await User.create({ email: 'b2@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b2' });
    await optedInUser('all@x.com');
    const startSoon = new Date(Date.now() + 3_600_000 + 5 * 60_000); // 1h + 5min → 1h window
    await CalendarEvent.create({
      title: 'All hands', kind: 'office', createdBy: broker.id, mandatory: true,
      startAt: startSoon, endAt: new Date(startSoon.getTime() + 3_600_000),
    });
    const startFar = new Date(Date.now() + 48 * 3_600_000);
    await CalendarEvent.create({
      title: 'Far away', kind: 'office', createdBy: broker.id, mandatory: true,
      startAt: startFar, endAt: new Date(startFar.getTime() + 3_600_000),
    });
    await sweepEventReminders();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
    expect(sendEmailMock.mock.calls[0][0]).toBe('all@x.com');
    expect(sendEmailMock.mock.calls[0][1]).toMatch(/All hands/);
  });

  it('recurring events remind for the occurrence in the window', async () => {
    const broker = await User.create({ email: 'b3@x.com', hashedPassword: 'x', role: 'broker', displayName: 'b3' });
    const attendee = await optedInUser('rec@x.com');
    // Started weeks ago, weekly; next occurrence lands in the 24h window.
    const nextOcc = new Date(Date.now() + 24 * 3_600_000 + 5 * 60_000);
    const origin = new Date(nextOcc.getTime() - 21 * 86_400_000);
    await CalendarEvent.create({
      title: 'Weekly sync', kind: 'office', createdBy: broker.id, rsvpEnabled: true, recurrence: 'weekly',
      startAt: origin, endAt: new Date(origin.getTime() + 1_800_000),
      rsvps: [{ userId: attendee.id, response: 'yes' }],
    });
    await sweepEventReminders();
    expect(sendEmailMock).toHaveBeenCalledTimes(1);
  });
});
