import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/app.js';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { Notification } from '../src/models/Notification.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { hashPassword } from '../src/utils/password.js';

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

  it('updateEvent re-checks resource conflicts when times move', async () => {
    const broker = await makeUser('c11@x.com', 'broker');
    const settings = await getSettings();
    settings.reservableResources.push({ name: 'Room B' } as never);
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
    // A free slot the next day…
    const movable = await createEvent(
      { title: 'Movable', kind: 'office', startAt: '2026-08-04T15:00:00.000Z', endAt: '2026-08-04T16:00:00.000Z', resourceId: roomId },
      broker,
    );
    // …moved onto a later weekly occurrence → conflict re-check rejects.
    await expect(
      updateEvent(movable.id, { startAt: '2026-08-10T15:30:00.000Z', endAt: '2026-08-10T16:30:00.000Z' }, broker),
    ).rejects.toThrow(/reserved/i);
  });

  it('updateEvent announces once when mandatory is newly flagged', async () => {
    const broker = await makeUser('c12@x.com', 'broker');
    const agent = await makeUser('c13@x.com', 'agent');
    const e = await createEvent(
      { title: 'Retreat', kind: 'office', startAt: '2026-08-20T15:00:00.000Z', endAt: '2026-08-20T16:00:00.000Z' },
      broker,
    );
    expect(await ActivityEvent.countDocuments({ type: 'eventCreated' })).toBe(0); // non-mandatory never feeds
    await updateEvent(e.id, { mandatory: true }, broker);
    expect(await ActivityEvent.countDocuments({ type: 'eventCreated' })).toBe(1);
    expect(await Notification.countDocuments({ userId: agent.id, type: 'mandatoryEvent' })).toBe(1);
    // Further edits of an already-mandatory event do not re-announce.
    await updateEvent(e.id, { title: 'x' }, broker);
    expect(await ActivityEvent.countDocuments({ type: 'eventCreated' })).toBe(1);
    expect(await Notification.countDocuments({ userId: agent.id, type: 'mandatoryEvent' })).toBe(1);
  });

  it('an event holding a since-removed resource stays editable', async () => {
    const broker = await makeUser('c14@x.com', 'broker');
    const settings = await getSettings();
    settings.reservableResources.push({ name: 'Doomed Room' } as never);
    await settings.save();
    const roomId = String(settings.reservableResources[0]._id);
    const e = await createEvent(
      { title: 'Holds room', kind: 'office', startAt: '2026-08-21T15:00:00.000Z', endAt: '2026-08-21T16:00:00.000Z', resourceId: roomId },
      broker,
    );
    settings.reservableResources = [] as never;
    await settings.save();
    const updated = await updateEvent(e.id, { title: 'Renamed' }, broker);
    expect(updated.title).toBe('Renamed');
  });
});

async function loginAs(app: ReturnType<typeof createApp>, email: string, role: string, officeId: string | null = null) {
  await User.create({ email, hashedPassword: await hashPassword('Password1!'), role, displayName: email, officeId });
  const agent = request.agent(app);
  await agent.post('/api/v1/auth/login').send({ email, password: 'Password1!' });
  return agent;
}

describe('event routes', () => {
  it('lists expanded occurrences with visibility scoping', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r1@x.com', 'broker');
    const officeA = '64b000000000000000000001';
    const agentA = await loginAs(app, 'r2@x.com', 'agent', officeA);
    const agentB = await loginAs(app, 'r3@x.com', 'agent', '64b000000000000000000002');

    // Broker: weekly office event for everyone.
    await broker.post('/api/v1/events').send({
      title: 'Standup', kind: 'office',
      startAt: '2026-08-03T15:00:00.000Z', endAt: '2026-08-03T15:30:00.000Z', recurrence: 'weekly',
    });
    // Broker: office-A-only event.
    await broker.post('/api/v1/events').send({
      title: 'Office A social', kind: 'office', officeId: officeA,
      startAt: '2026-08-04T22:00:00.000Z', endAt: '2026-08-04T23:00:00.000Z',
    });
    // Agent A: personal block.
    await agentA.post('/api/v1/events').send({
      title: 'Dentist', kind: 'personal',
      startAt: '2026-08-05T16:00:00.000Z', endAt: '2026-08-05T17:00:00.000Z',
    });

    const q = '/api/v1/events?from=2026-08-01T00:00:00.000Z&to=2026-08-15T00:00:00.000Z';
    const a = await agentA.get(q);
    const titles = a.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(titles.filter((t: string) => t === 'Standup')).toHaveLength(2); // weekly ×2 in range
    expect(titles).toContain('Office A social');
    expect(titles).toContain('Dentist');

    const b = await agentB.get(q);
    const bTitles = b.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(bTitles).not.toContain('Office A social');
    expect(bTitles).not.toContain('Dentist'); // personal events are private

    const br = await broker.get(q);
    const brTitles = br.body.occurrences.map((o: { event: { title: string } }) => o.event.title);
    expect(brTitles).toContain('Office A social'); // admins see all office events
    expect(brTitles).not.toContain('Dentist'); // …but not personal ones
  });

  it('rejects an office event created by an agent, and a missing/oversized range', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'r4@x.com', 'agent');
    expect(
      (
        await agent.post('/api/v1/events').send({
          title: 'Nope', kind: 'office', startAt: '2026-08-01T10:00:00.000Z', endAt: '2026-08-01T11:00:00.000Z',
        })
      ).status,
    ).toBe(403);
    expect((await agent.get('/api/v1/events')).status).toBe(400);
    expect(
      (await agent.get('/api/v1/events?from=2026-01-01T00:00:00.000Z&to=2026-12-31T00:00:00.000Z')).status,
    ).toBe(400); // > 92 days
  });

  it('rsvp via route and creator-only summary', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r5@x.com', 'broker');
    const agent = await loginAs(app, 'r6@x.com', 'agent');
    const created = await broker.post('/api/v1/events').send({
      title: 'Training', kind: 'office', rsvpEnabled: true,
      startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
    });
    const id = created.body.event.id;
    expect((await agent.post(`/api/v1/events/${id}/rsvp`).send({ response: 'yes' })).status).toBe(200);

    const asAgent = await agent.get(`/api/v1/events/${id}`);
    expect(asAgent.body.event.myRsvp).toBe('yes');
    expect(asAgent.body.rsvpSummary).toBeUndefined(); // summary is creator/admin-only

    const asBroker = await broker.get(`/api/v1/events/${id}`);
    expect(asBroker.body.rsvpSummary.yes).toEqual(['r6@x.com']);
    expect(asBroker.body.rsvpSummary.no).toEqual([]);
  });

  it('mandatory flag is broker-only through the route', async () => {
    const app = createApp();
    const admin = await loginAs(app, 'r7@x.com', 'officeAdmin');
    expect(
      (
        await admin.post('/api/v1/events').send({
          title: 'M', kind: 'office', mandatory: true,
          startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
        })
      ).status,
    ).toBe(403);
  });

  it('rejects a recurrenceUntil before startAt', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r8@x.com', 'broker');
    expect(
      (
        await broker.post('/api/v1/events').send({
          title: 'Bad recurrence', kind: 'office', recurrence: 'weekly',
          startAt: '2026-08-10T15:00:00.000Z', endAt: '2026-08-10T16:00:00.000Z',
          recurrenceUntil: '2026-08-01T00:00:00.000Z',
        })
      ).status,
    ).toBe(400);
  });

  it('mutations of an invisible personal event 404 (no existence leak)', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'r9@x.com', 'agent');
    const broker = await loginAs(app, 'r10@x.com', 'broker');
    const created = await agent.post('/api/v1/events').send({
      title: 'Private block', kind: 'personal',
      startAt: '2026-08-11T15:00:00.000Z', endAt: '2026-08-11T16:00:00.000Z',
    });
    const id = created.body.event.id;
    expect((await broker.patch(`/api/v1/events/${id}`).send({ title: 'Stolen' })).status).toBe(404);
    expect((await broker.delete(`/api/v1/events/${id}`)).status).toBe(404);
    // Still intact and editable by its owner.
    expect((await agent.patch(`/api/v1/events/${id}`).send({ title: 'Still mine' })).status).toBe(200);
  });

  it('rejects a PATCH setting recurrenceUntil before startAt', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r11@x.com', 'broker');
    const created = await broker.post('/api/v1/events').send({
      title: 'Weekly', kind: 'office', recurrence: 'weekly',
      startAt: '2026-08-12T15:00:00.000Z', endAt: '2026-08-12T16:00:00.000Z',
    });
    const id = created.body.event.id;
    expect(
      (await broker.patch(`/api/v1/events/${id}`).send({ recurrenceUntil: '2026-08-01T00:00:00.000Z' })).status,
    ).toBe(400);
  });

  it('rejects array-valued range params', async () => {
    const app = createApp();
    const agent = await loginAs(app, 'r12@x.com', 'agent');
    expect((await agent.get('/api/v1/events?from[0]=2026-01-01&to=2026-01-02')).status).toBe(400);
  });

  it('an officeAdmin can edit a mandatory event but not change the flag', async () => {
    const app = createApp();
    const broker = await loginAs(app, 'r13@x.com', 'broker');
    const admin = await loginAs(app, 'r14@x.com', 'officeAdmin');
    const created = await broker.post('/api/v1/events').send({
      title: 'All hands', kind: 'office', mandatory: true,
      startAt: '2026-08-06T15:00:00.000Z', endAt: '2026-08-06T16:00:00.000Z',
    });
    const id = created.body.event.id;
    const renamed = await admin.patch(`/api/v1/events/${id}`).send({ title: 'All hands (moved rooms)' });
    expect(renamed.status).toBe(200);
    expect(renamed.body.event.title).toBe('All hands (moved rooms)');
    expect((await admin.patch(`/api/v1/events/${id}`).send({ mandatory: false })).status).toBe(403);
  });
});
