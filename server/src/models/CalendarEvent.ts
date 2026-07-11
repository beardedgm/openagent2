import mongoose from 'mongoose';
import { RECURRENCE } from '../utils/recurrence.js';

export const RSVP_RESPONSES = ['yes', 'no', 'maybe'] as const;
export type RsvpResponse = (typeof RSVP_RESPONSES)[number];

const rsvpSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    response: { type: String, enum: RSVP_RESPONSES, required: true },
    at: { type: Date, default: () => new Date() },
  },
  { _id: false },
);

const calendarEventSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    descriptionHtml: { type: String, default: '' },
    descriptionText: { type: String, default: '' },
    kind: { type: String, enum: ['office', 'personal'], required: true },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // Office events only: null targets all users. Personal events are always null.
    officeId: { type: mongoose.Schema.Types.ObjectId, default: null },
    startAt: { type: Date, required: true },
    endAt: { type: Date, required: true },
    allDay: { type: Boolean, default: false },
    location: { type: String, default: '', maxlength: 200 },
    recurrence: { type: String, enum: RECURRENCE, default: 'none' },
    recurrenceUntil: { type: Date, default: null },
    rsvpEnabled: { type: Boolean, default: false },
    rsvps: { type: [rsvpSchema], default: [] },
    mandatory: { type: Boolean, default: false },
    // References a Settings.reservableResources subdocument id.
    resourceId: { type: mongoose.Schema.Types.ObjectId, default: null },
    // Reminder idempotency latches: "<occurrence ISO>|24h" / "…|1h" (see event-reminders job).
    remindersSent: { type: [String], default: [] },
  },
  { timestamps: true },
);
calendarEventSchema.index({ startAt: 1 });
calendarEventSchema.index({ kind: 1, officeId: 1 });
// Compound: serves the conflict-check query {resourceId, startAt: {$lt: horizon}}.
calendarEventSchema.index({ resourceId: 1, startAt: 1 });

export const CalendarEvent = mongoose.model('CalendarEvent', calendarEventSchema);
export type CalendarEventDoc = InstanceType<typeof CalendarEvent>;

export function toPublicEvent(e: CalendarEventDoc, viewerId: string) {
  return {
    id: e.id as string,
    title: e.title,
    descriptionHtml: e.descriptionHtml,
    kind: e.kind,
    createdBy: String(e.createdBy),
    officeId: e.officeId,
    startAt: e.startAt,
    endAt: e.endAt,
    allDay: e.allDay,
    location: e.location,
    recurrence: e.recurrence,
    recurrenceUntil: e.recurrenceUntil,
    rsvpEnabled: e.rsvpEnabled,
    mandatory: e.mandatory,
    resourceId: e.resourceId,
    myRsvp: e.rsvps.find((r) => String(r.userId) === viewerId)?.response ?? null,
    createdAt: e.get('createdAt') as Date,
  };
}
