import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { CalendarEvent, type CalendarEventDoc, type RsvpResponse } from '../models/CalendarEvent.js';
import { getSettings } from '../models/Settings.js';
import { User, type UserDoc } from '../models/User.js';
import { expandOccurrences } from '../utils/recurrence.js';
import { htmlToText, sanitizePostHtml } from '../utils/sanitizeHtml.js';
import { emitActivity } from './activityService.js';
import { mandatoryEventEmail } from './emailService.js';
import { notify } from './notificationService.js';

const CONFLICT_HORIZON_MS = 180 * 86_400_000; // conflict check bound — documented trade-off
const DAY_MS = 86_400_000;

export interface EventInput {
  title?: string;
  descriptionHtml?: string;
  kind?: 'office' | 'personal';
  officeId?: string | null;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  location?: string;
  recurrence?: 'none' | 'daily' | 'weekly' | 'monthly';
  recurrenceUntil?: string | null;
  rsvpEnabled?: boolean;
  mandatory?: boolean;
  resourceId?: string | null;
}

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

function canManage(event: CalendarEventDoc, user: UserDoc): boolean {
  if (event.kind === 'personal') return String(event.createdBy) === user.id; // private, even from admins
  return String(event.createdBy) === user.id || isAdmin(user.role);
}

async function assertResourceExists(resourceId: string): Promise<void> {
  const settings = await getSettings();
  const found = settings.reservableResources.some((r) => String(r._id) === resourceId);
  if (!found) throw new AppError(400, 'Unknown reservable resource');
}

/** Normalizes a Mongoose event doc into the plain shape expandOccurrences expects
 * (Mongoose's inferred type allows `recurrenceUntil: undefined` despite the `default: null`
 * in the schema; expandOccurrences' RecurringSpan requires `Date | null`). */
function toSpan(event: CalendarEventDoc) {
  return {
    startAt: event.startAt,
    endAt: event.endAt,
    recurrence: event.recurrence,
    recurrenceUntil: event.recurrenceUntil ?? null,
  };
}

/** Only one event may hold a resource at any time (PRD 5.4.2). Expands recurrence on
 * both sides over a 180-day horizon from the candidate's start — reservations beyond
 * the horizon are not checked (accepted, documented bound). */
async function assertResourceFree(candidate: CalendarEventDoc, excludeId?: string): Promise<void> {
  if (!candidate.resourceId) return;
  const horizonEnd = new Date(candidate.startAt.getTime() + CONFLICT_HORIZON_MS);
  const mine = expandOccurrences(toSpan(candidate), new Date(candidate.startAt.getTime() - DAY_MS), horizonEnd);
  const others = await CalendarEvent.find({
    resourceId: candidate.resourceId,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    startAt: { $lt: horizonEnd },
  });
  for (const other of others) {
    const theirs = expandOccurrences(toSpan(other), new Date(candidate.startAt.getTime() - DAY_MS), horizonEnd);
    for (const a of mine) {
      for (const b of theirs) {
        if (a.startAt < b.endAt && a.endAt > b.startAt)
          throw new AppError(409, 'Resource is already reserved during that time');
      }
    }
  }
}

function applyInput(event: CalendarEventDoc, input: EventInput): void {
  if (input.title !== undefined) event.title = input.title;
  if (input.descriptionHtml !== undefined) {
    event.descriptionHtml = sanitizePostHtml(input.descriptionHtml);
    event.descriptionText = htmlToText(input.descriptionHtml);
  }
  if (input.startAt !== undefined) event.startAt = new Date(input.startAt);
  if (input.endAt !== undefined) event.endAt = new Date(input.endAt);
  if (input.allDay !== undefined) event.allDay = input.allDay;
  if (input.location !== undefined) event.location = input.location;
  if (input.recurrence !== undefined) event.recurrence = input.recurrence;
  if (input.recurrenceUntil !== undefined)
    event.recurrenceUntil = input.recurrenceUntil ? new Date(input.recurrenceUntil) : null;
  if (input.rsvpEnabled !== undefined) event.rsvpEnabled = input.rsvpEnabled;
  if (input.mandatory !== undefined) event.mandatory = input.mandatory;
  if (input.officeId !== undefined) event.officeId = (input.officeId ?? null) as never;
  if (input.resourceId !== undefined) event.resourceId = (input.resourceId ?? null) as never;
}

function enforceKindRules(event: CalendarEventDoc): void {
  if (event.endAt <= event.startAt) throw new AppError(400, 'Event must end after it starts');
  // Guards updates too (the create validator already rejects this): an until before
  // start yields zero occurrences, silently vanishing the event from the calendar.
  if (event.recurrenceUntil && event.recurrenceUntil < event.startAt)
    throw new AppError(400, 'recurrenceUntil must not be before startAt');
  if (event.kind === 'personal') {
    // Personal events are private scheduling blocks — office-only features forced off.
    event.officeId = null as never;
    event.mandatory = false;
    event.rsvpEnabled = false;
    event.resourceId = null as never;
  }
  // The mandatory flag is broker-gated at the TRANSITION points (createEvent/updateEvent), not
  // here: gating on the current value would 403 any non-broker save of an event that is (still)
  // mandatory — e.g. an officeAdmin fixing a typo on a broker's mandatory all-hands.
}

export async function createEvent(input: EventInput, creator: UserDoc): Promise<CalendarEventDoc> {
  const event = new CalendarEvent({ kind: input.kind, createdBy: creator.id, title: input.title, startAt: new Date(0), endAt: new Date(0) });
  applyInput(event, input);
  enforceKindRules(event);
  if (event.kind === 'office' && event.mandatory && creator.role !== 'broker')
    throw new AppError(403, 'Only a broker can mark events mandatory');
  if (event.resourceId) {
    await assertResourceExists(String(event.resourceId));
    // Check-then-save race: two simultaneous saves can both pass this check (same accepted
    // trade-off as setPinned — single brokerage, low collision odds; an overlapping pair is
    // visible on the calendar and fixable by hand).
    await assertResourceFree(event);
  }
  await event.save();
  if (event.kind === 'office' && event.mandatory) await announceMandatory(event, creator);
  return event;
}

export async function updateEvent(id: string, input: EventInput, user: UserDoc): Promise<CalendarEventDoc> {
  const event = await CalendarEvent.findById(id);
  if (!event) throw new AppError(404, 'Event not found');
  if (!canManage(event, user)) throw new AppError(403, 'Insufficient permissions');
  const wasMandatory = event.mandatory;
  applyInput(event, input);
  enforceKindRules(event);
  // Changing the flag either direction is broker-only; leaving it as-is is fine for any manager.
  if (event.kind === 'office' && event.mandatory !== wasMandatory && user.role !== 'broker')
    throw new AppError(403, 'Only a broker can change the mandatory flag');
  // Existence is re-validated only when the caller changes the resource — an event holding
  // a since-removed resource must stay editable (Settings documents resources as removable).
  // The conflict re-check still runs on ANY edit (time moves can create new overlaps).
  if (input.resourceId !== undefined && event.resourceId) await assertResourceExists(String(event.resourceId));
  if (event.resourceId) await assertResourceFree(event, event.id);
  await event.save();
  // Newly-flagged mandatory on an existing event announces once.
  if (event.kind === 'office' && event.mandatory && !wasMandatory) await announceMandatory(event, user);
  return event;
}

export async function deleteEvent(id: string, user: UserDoc): Promise<void> {
  const event = await CalendarEvent.findById(id);
  if (!event) throw new AppError(404, 'Event not found');
  if (!canManage(event, user)) throw new AppError(403, 'Insufficient permissions');
  await event.deleteOne();
}

export async function rsvp(eventId: string, user: UserDoc, response: RsvpResponse): Promise<void> {
  const event = await CalendarEvent.findById(eventId);
  if (!event || event.kind !== 'office') throw new AppError(404, 'Event not found');
  if (!event.rsvpEnabled) throw new AppError(400, 'RSVP is not enabled on this event');
  const updated = await CalendarEvent.updateOne(
    { _id: eventId, 'rsvps.userId': user.id },
    { $set: { 'rsvps.$.response': response, 'rsvps.$.at': new Date() } },
  );
  if (updated.matchedCount === 0) {
    await CalendarEvent.updateOne(
      { _id: eventId, 'rsvps.userId': { $ne: user.id } },
      { $push: { rsvps: { userId: user.id, response, at: new Date() } } },
    );
  }
}

async function announceMandatory(event: CalendarEventDoc, creator: UserDoc): Promise<void> {
  const when = event.startAt.toISOString();
  await emitActivity({
    type: 'eventCreated',
    message: `Mandatory event: ${event.title}`,
    link: `/calendar/${event.id}`,
    officeId: event.officeId ? String(event.officeId) : null,
    actorId: creator.id,
  });
  const recipients = await User.find({
    status: 'active',
    role: { $in: ['broker', 'officeAdmin', 'agent'] },
    _id: { $ne: creator.id },
    ...(event.officeId
      ? { $or: [{ officeId: event.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
      : {}),
  }).select('_id');
  await notify(
    recipients.map((r) => String(r._id)),
    { type: 'mandatoryEvent', title: `Mandatory event: ${event.title} — ${when}`, link: `/calendar/${event.id}` },
    mandatoryEventEmail(event.title, when, `${env.APP_DOMAIN}/calendar/${event.id}`),
  );
}
