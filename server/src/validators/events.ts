import { z } from 'zod';
import { RSVP_RESPONSES } from '../models/CalendarEvent.js';
import { RECURRENCE } from '../utils/recurrence.js';

const eventObjectSchema = z.object({
  title: z.string().trim().min(1).max(200),
  descriptionHtml: z.string().max(100_000).optional(),
  kind: z.enum(['office', 'personal']),
  officeId: z.string().nullable().optional(),
  startAt: z.string().datetime({ offset: true }),
  endAt: z.string().datetime({ offset: true }),
  allDay: z.boolean().optional(),
  location: z.string().max(200).optional(),
  recurrence: z.enum(RECURRENCE).optional(),
  recurrenceUntil: z.string().datetime({ offset: true }).nullable().optional(),
  rsvpEnabled: z.boolean().optional(),
  mandatory: z.boolean().optional(),
  resourceId: z.string().nullable().optional(),
});

export const createEventSchema = eventObjectSchema
  .refine((v) => new Date(v.endAt) > new Date(v.startAt), { message: 'endAt must be after startAt' })
  .refine((v) => !v.recurrenceUntil || new Date(v.recurrenceUntil) >= new Date(v.startAt), {
    message: 'recurrenceUntil must not be before startAt',
  });

// kind is immutable after creation. No refines here — the service enforces endAt > startAt
// on update (a PATCH may only touch one of startAt/endAt, so both would need to be present
// to re-check here; the service always has the merged, complete document to validate).
export const updateEventSchema = eventObjectSchema.omit({ kind: true }).partial();

export const rsvpSchema = z.object({ response: z.enum(RSVP_RESPONSES) });
