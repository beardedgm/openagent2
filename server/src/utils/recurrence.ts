export const RECURRENCE = ['none', 'daily', 'weekly', 'monthly'] as const;
export type Recurrence = (typeof RECURRENCE)[number];

export interface Occurrence {
  startAt: Date;
  endAt: Date;
}

interface RecurringSpan {
  startAt: Date;
  endAt: Date;
  recurrence: Recurrence;
  recurrenceUntil: Date | null;
}

const DAY_MS = 86_400_000;
const MAX_OCCURRENCES = 500;

/** Adds n calendar months in UTC, clamping the day (Jan 31 + 1mo = Feb 28). */
function addMonthsClamped(date: Date, n: number): Date {
  const y = date.getUTCFullYear();
  const m = date.getUTCMonth() + n;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes(), date.getUTCSeconds(), date.getUTCMilliseconds()),
  );
}

/** Expands an event's occurrences that OVERLAP [rangeStart, rangeEnd).
 * Pure query-time expansion — occurrences are never persisted. Daily/weekly step
 * fixed absolute intervals (UTC), so local wall-clock shifts across DST — an
 * accepted consequence of storing UTC (spec decision #6). */
export function expandOccurrences(event: RecurringSpan, rangeStart: Date, rangeEnd: Date): Occurrence[] {
  const duration = event.endAt.getTime() - event.startAt.getTime();
  const overlaps = (s: Date, e: Date) => s < rangeEnd && e > rangeStart;
  if (event.recurrence === 'none') {
    return overlaps(event.startAt, event.endAt) ? [{ startAt: event.startAt, endAt: event.endAt }] : [];
  }

  const out: Occurrence[] = [];
  const until = event.recurrenceUntil;
  const push = (start: Date) => {
    if (until && start > until) return false;
    if (start >= rangeEnd) return false;
    const end = new Date(start.getTime() + duration);
    if (overlaps(start, end)) out.push({ startAt: start, endAt: end });
    return true;
  };

  if (event.recurrence === 'monthly') {
    for (let i = 0; out.length < MAX_OCCURRENCES; i++) {
      if (!push(addMonthsClamped(event.startAt, i))) break;
    }
    return out;
  }

  const step = event.recurrence === 'daily' ? DAY_MS : 7 * DAY_MS;
  // Skip straight to the first occurrence that could overlap the range.
  const first = Math.max(0, Math.floor((rangeStart.getTime() - duration - event.startAt.getTime()) / step));
  for (let i = first; out.length < MAX_OCCURRENCES; i++) {
    if (!push(new Date(event.startAt.getTime() + i * step))) break;
  }
  return out;
}
