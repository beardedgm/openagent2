import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { Notification } from '../src/models/Notification.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';

const { sendEmailMock } = vi.hoisted(() => ({ sendEmailMock: vi.fn(async () => true) }));
vi.mock('../src/services/emailService.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../src/services/emailService.js')>()),
  sendEmail: sendEmailMock,
}));

import { createEvent, deleteEvent, rsvp, updateEvent } from '../src/services/calendarService.js';

describe('CalendarEvent model', () => {
  it('applies defaults', async () => {
    const u = await User.create({ email: 'e@x.com', hashedPassword: 'x', role: 'agent', displayName: 'e' });
    const e = await CalendarEvent.create({
      title: 'Lunch block',
      kind: 'personal',
      createdBy: u.id,
      startAt: new Date('2026-08-01T17:00:00Z'),
      endAt: new Date('2026-08-01T18:00:00Z'),
    });
    expect(e.officeId).toBeNull();
    expect(e.recurrence).toBe('none');
    expect(e.rsvpEnabled).toBe(false);
    expect(e.mandatory).toBe(false);
    expect(e.rsvps).toHaveLength(0);
    expect(e.remindersSent).toHaveLength(0);
  });
});

async function makeUser(email: string, role = 'agent', officeId: string | null = null) {
  return User.create({ email, hashedPassword: 'x', role, displayName: email, officeId });
}

describe('calendarService', () => {
  beforeEach(() => sendEmailMock.mockClear());

  it('sanitizes description and strips office-only fields from personal events', async () => {
    const agent = await makeUser('c1@x.com');
    const e = await createEvent(
      {
        title: 'Block',
        descriptionHtml: '<p>mine <script>x()</script></p>',
        kind: 'personal',
        startAt: '2026-08-01T17:00:00.000Z',
        endAt: '2026-08-01T18:00:00.000Z',
        mandatory: true,
        rsvpEnabled: true,
        officeId: '64b000000000000000000001',
      },
      agent,
    );
    expect(e.descriptionHtml).toBe('<p>mine </p>');
    expect(e.mandatory).toBe(false);
    expect(e.rsvpEnabled).toBe(false);
    expect(e.officeId).toBeNull();
    expect(await ActivityEvent.countDocuments()).toBe(0); // personal events never feed
  });

  it('only a broker can create mandatory events; fan-out notifies targeted users', async () => {
    const broker = await makeUser('c2@x.com', 'broker');
    const admin = await makeUser('c3@x.com', 'officeAdmin');
    const agent = await makeUser('c4@x.com', 'agent');
    await expect(
      createEvent(
        { title: 'M', kind: 'office', startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T16:00:00.000Z', mandatory: true },
        admin,
      ),
    ).rejects.toThrow(/broker/i);
    await createEvent(
      { title: 'All hands', kind: 'office', startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T16:00:00.000Z', mandatory: true },
      broker,
    );
    expect(await ActivityEvent.countDocuments({ type: 'eventCreated' })).toBe(1);
    expect(await Notification.countDocuments({ userId: agent.id, type: 'mandatoryEvent' })).toBe(1);
    expect(await Notification.countDocuments({ userId: broker.id })).toBe(0); // creator excluded
    // Email honors prefs (default on): admin + agent got it, creator didn't.
    expect(sendEmailMock.mock.calls.map((c) => c[0]).sort()).toEqual(['c3@x.com', 'c4@x.com']);
  });

  it('rejects overlapping resource reservations, including via recurrence', async () => {
    const broker = await makeUser('c5@x.com', 'broker');
    const settings = await getSettings();
    settings.reservableResources.push({ name: 'Conference Room A' } as never);
    await settings.save();
    const roomId = String(settings.reservableResources[0]._id);

    await createEvent(
      {
        title: 'Weekly standup',
        kind: 'office',
        startAt: '2026-08-03T15:00:00.000Z',
        endAt: '2026-08-03T16:00:00.000Z',
        recurrence: 'weekly',
        resourceId: roomId,
      },
      broker,
    );
    // Two weeks later, same slot — collides with the weekly recurrence.
    await expect(
      createEvent(
        { title: 'Clash', kind: 'office', startAt: '2026-08-17T15:30:00.000Z', endAt: '2026-08-17T16:30:00.000Z', resourceId: roomId },
        broker,
      ),
    ).rejects.toThrow(/reserved/i);
    // Same time, no resource → fine. Different time, same resource → fine.
    await createEvent(
      { title: 'No room', kind: 'office', startAt: '2026-08-17T15:30:00.000Z', endAt: '2026-08-17T16:30:00.000Z' },
      broker,
    );
    await createEvent(
      { title: 'Later', kind: 'office', startAt: '2026-08-17T17:00:00.000Z', endAt: '2026-08-17T18:00:00.000Z', resourceId: roomId },
      broker,
    );
  });

  it('rejects an unknown resource id', async () => {
    const broker = await makeUser('c6@x.com', 'broker');
    await expect(
      createEvent(
        { title: 'Ghost room', kind: 'office', startAt: '2026-08-01T10:00:00.000Z', endAt: '2026-08-01T11:00:00.000Z', resourceId: '64b0000000000000000000ff' },
        broker,
      ),
    ).rejects.toThrow(/resource/i);
  });

  it('rsvp upserts one response per user', async () => {
    const broker = await makeUser('c7@x.com', 'broker');
    const agent = await makeUser('c8@x.com', 'agent');
    const e = await createEvent(
      { title: 'Training', kind: 'office', startAt: '2026-08-05T15:00:00.000Z', endAt: '2026-08-05T16:00:00.000Z', rsvpEnabled: true },
      broker,
    );
    await rsvp(e.id, agent, 'yes');
    await rsvp(e.id, agent, 'maybe');
    const fresh = (await CalendarEvent.findById(e.id))!;
    expect(fresh.rsvps).toHaveLength(1);
    expect(fresh.rsvps[0].response).toBe('maybe');
    // rsvp on an rsvp-disabled event rejects
    const plain = await createEvent(
      { title: 'NoRsvp', kind: 'office', startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z' },
      broker,
    );
    await expect(rsvp(plain.id, agent, 'yes')).rejects.toThrow(/rsvp/i);
  });

  it('updateEvent enforces ownership and re-checks conflicts; deleteEvent enforces ownership', async () => {
    const broker = await makeUser('c9@x.com', 'broker');
    const agent = await makeUser('c10@x.com', 'agent');
    const personal = await createEvent(
      { title: 'Mine', kind: 'personal', startAt: '2026-08-07T15:00:00.000Z', endAt: '2026-08-07T16:00:00.000Z' },
      agent,
    );
    await expect(updateEvent(personal.id, { title: 'Stolen' }, broker)).rejects.toThrow(/permission/i);
    await expect(deleteEvent(personal.id, broker)).rejects.toThrow(/permission/i);
    const mine = await updateEvent(personal.id, { title: 'Renamed' }, agent);
    expect(mine.title).toBe('Renamed');
    await deleteEvent(personal.id, agent);
    expect(await CalendarEvent.findById(personal.id)).toBeNull();
  });
});
