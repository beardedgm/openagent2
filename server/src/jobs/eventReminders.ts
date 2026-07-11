import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { CalendarEvent, type CalendarEventDoc } from '../models/CalendarEvent.js';
import { User } from '../models/User.js';
import { eventReminderEmail, sendEmail } from '../services/emailService.js';
import { expandOccurrences } from '../utils/recurrence.js';

const WINDOW_MS = 20 * 60_000; // 15-min cadence + 5-min overlap margin — see comment below
const LEADS = [
  { key: '24h', ms: 24 * 3_600_000 },
  { key: '1h', ms: 3_600_000 },
] as const;

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

/** Email-only, opt-in reminders (PRD 5.4). Runs every 15 minutes; the window is
 * 20 minutes so consecutive scans OVERLAP — Agenda anchors each run to the previous
 * execution time (spacing ≥ cadence, never less), and without overlap every cycle
 * would leak a drift-sized gap of missed reminders. The per-occurrence latch dedupes
 * the overlap. Only multi-window outages (sleeping host) skip reminders, by design —
 * a late reminder is noise.
 * Reviewed product decisions (accepted as-is): mandatory-event reminders stay behind
 * the eventReminders opt-in, and creators DO receive their own mandatory-event reminders. */
export async function sweepEventReminders(): Promise<void> {
  const now = Date.now();
  for (const lead of LEADS) {
    const windowStart = new Date(now + lead.ms);
    const windowEnd = new Date(now + lead.ms + WINDOW_MS);
    const candidates = await CalendarEvent.find({
      kind: 'office',
      $or: [{ rsvpEnabled: true }, { mandatory: true }],
      $and: [
        {
          $or: [
            { recurrence: 'none', startAt: { $gte: windowStart, $lt: windowEnd } },
            {
              recurrence: { $ne: 'none' },
              startAt: { $lt: windowEnd },
              $or: [{ recurrenceUntil: null }, { recurrenceUntil: { $gte: windowStart } }],
            },
          ],
        },
      ],
    });
    for (const event of candidates) {
      for (const occ of expandOccurrences(toSpan(event), windowStart, windowEnd)) {
        if (occ.startAt < windowStart) continue; // overlap ≠ starting in window
        const latch = `${occ.startAt.toISOString()}|${lead.key}`;
        const claimed = await CalendarEvent.updateOne(
          { _id: event.id, remindersSent: { $ne: latch } },
          // $addToSet is redundant with the $ne guard but keeps the claim
          // duplicate-proof if the filter is ever refactored.
          { $addToSet: { remindersSent: latch } },
        );
        if (claimed.modifiedCount !== 1) continue; // already reminded (or raced)
        try {
          await remindAttendees(event, occ.startAt);
        } catch (err) {
          logger.error({ err, eventId: event.id }, 'event reminder send failed');
        }
      }
    }
  }
}

async function remindAttendees(event: CalendarEventDoc, occStart: Date): Promise<void> {
  const rsvpYesIds = event.rsvps.filter((r) => r.response === 'yes').map((r) => r.userId);
  const filter = event.mandatory
    ? {
        status: 'active',
        role: { $in: ['broker', 'officeAdmin', 'agent'] },
        ...(event.officeId
          ? { $or: [{ officeId: event.officeId }, { role: { $in: ['broker', 'officeAdmin'] } }] }
          : {}),
      }
    : { _id: { $in: rsvpYesIds }, status: 'active' };
  const users = await User.find(filter);
  const { subject, html } = eventReminderEmail(
    event.title,
    occStart.toISOString(),
    `${env.APP_DOMAIN}/calendar/${event.id}`,
  );
  for (const u of users) {
    // Opt-IN: absent pref means NO reminder (unlike other email prefs).
    if ((u.emailPrefs as Map<string, boolean>).get('eventReminders') !== true) continue;
    try {
      await sendEmail(u.email, subject, html);
    } catch (err) {
      logger.error({ err, to: u.email }, 'event reminder email failed');
    }
  }
}
