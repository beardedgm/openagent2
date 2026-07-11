import { Router, type Request } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { requireAuth } from '../middleware/auth.js';
import { AppError } from '../middleware/errorHandler.js';
import { validate } from '../middleware/validate.js';
import { CalendarEvent, toPublicEvent, type CalendarEventDoc } from '../models/CalendarEvent.js';
import { createEvent, deleteEvent, rsvp, updateEvent } from '../services/calendarService.js';
import { expandOccurrences } from '../utils/recurrence.js';
import { createEventSchema, rsvpSchema, updateEventSchema } from '../validators/events.js';

const MAX_RANGE_MS = 92 * 86_400_000; // one quarter — month/week/day views never need more
const MAX_OCCURRENCES = 1000;

export const eventsRouter = Router();
eventsRouter.use(requireAuth);

function isAdmin(role: string): boolean {
  return role === 'broker' || role === 'officeAdmin';
}

/** Personal events: creator only. Office events: all-users or own office; admins all. */
function visibilityFilter(req: Request): Record<string, unknown> {
  const me = req.user!;
  const office = isAdmin(me.role)
    ? { kind: 'office' }
    : { kind: 'office', $or: [{ officeId: null }, { officeId: me.officeId }] };
  return { $or: [{ kind: 'personal', createdBy: me.id }, office] };
}

async function loadVisibleEvent(req: Request): Promise<CalendarEventDoc> {
  const event = await CalendarEvent.findOne({ _id: req.params.id, ...visibilityFilter(req) });
  if (!event) throw new AppError(404, 'Event not found');
  return event;
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

eventsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = typeof req.query.from === 'string' ? new Date(req.query.from) : null;
    const to = typeof req.query.to === 'string' ? new Date(req.query.to) : null;
    if (!from || !to || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from)
      throw new AppError(400, 'from and to are required ISO datetimes with to > from');
    if (to.getTime() - from.getTime() > MAX_RANGE_MS) throw new AppError(400, 'Range too large (max 92 days)');

    const events = await CalendarEvent.find({
      $and: [
        visibilityFilter(req),
        { startAt: { $lt: to } },
        { $or: [{ recurrence: { $ne: 'none' } }, { endAt: { $gt: from } }] },
      ],
    });
    const me = req.user!.id;
    const occurrences = events
      .flatMap((e) => expandOccurrences(toSpan(e), from, to).map((o) => ({ event: toPublicEvent(e, me), startAt: o.startAt, endAt: o.endAt })))
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())
      .slice(0, MAX_OCCURRENCES);
    res.json({ occurrences });
  }),
);

eventsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const event = await loadVisibleEvent(req);
    const me = req.user!;
    const body: Record<string, unknown> = { event: toPublicEvent(event, me.id) };
    if (event.rsvpEnabled && (String(event.createdBy) === me.id || isAdmin(me.role))) {
      await event.populate('rsvps.userId', 'displayName');
      const summary: Record<string, string[]> = { yes: [], no: [], maybe: [] };
      for (const r of event.rsvps) {
        const name = (r.userId as unknown as { displayName?: string })?.displayName ?? 'Unknown';
        summary[r.response].push(name);
      }
      body.rsvpSummary = summary;
    }
    res.json(body);
  }),
);

eventsRouter.post(
  '/',
  validate(createEventSchema),
  asyncHandler(async (req, res) => {
    const me = req.user!;
    if (req.body.kind === 'office' && !isAdmin(me.role))
      throw new AppError(403, 'Only admins can create office events');
    const event = await createEvent(req.body, me);
    res.status(201).json({ event: toPublicEvent(event, me.id) });
  }),
);

eventsRouter.patch(
  '/:id',
  validate(updateEventSchema),
  asyncHandler(async (req, res) => {
    await loadVisibleEvent(req); // invisible events 404 (no existence leak); service still 403s manage-vs-view
    const event = await updateEvent(req.params.id, req.body, req.user!);
    res.json({ event: toPublicEvent(event, req.user!.id) });
  }),
);

eventsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await loadVisibleEvent(req); // invisible events 404 (no existence leak); service still 403s manage-vs-view
    await deleteEvent(req.params.id, req.user!);
    res.json({ ok: true });
  }),
);

eventsRouter.post(
  '/:id/rsvp',
  validate(rsvpSchema),
  asyncHandler(async (req, res) => {
    await loadVisibleEvent(req); // visibility gate
    await rsvp(req.params.id, req.user!, req.body.response);
    res.json({ ok: true });
  }),
);
