import { describe, expect, it } from 'vitest';
import { expandOccurrences } from '../src/utils/recurrence.js';

const D = (s: string) => new Date(s);
const HOUR = 3_600_000;

function ev(overrides: Partial<Parameters<typeof expandOccurrences>[0]> = {}) {
  return {
    startAt: D('2026-01-05T15:00:00.000Z'),
    endAt: D('2026-01-05T16:00:00.000Z'),
    recurrence: 'none' as const,
    recurrenceUntil: null,
    ...overrides,
  };
}

describe('expandOccurrences', () => {
  it('returns a single occurrence for non-recurring events overlapping the range', () => {
    const occs = expandOccurrences(ev(), D('2026-01-01T00:00:00Z'), D('2026-01-31T00:00:00Z'));
    expect(occs).toHaveLength(1);
    expect(occs[0].startAt.toISOString()).toBe('2026-01-05T15:00:00.000Z');
    expect(expandOccurrences(ev(), D('2026-02-01T00:00:00Z'), D('2026-02-28T00:00:00Z'))).toHaveLength(0);
  });

  it('expands daily occurrences inside the range only', () => {
    const occs = expandOccurrences(
      ev({ recurrence: 'daily' }),
      D('2026-01-10T00:00:00Z'),
      D('2026-01-13T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-10T15:00:00.000Z',
      '2026-01-11T15:00:00.000Z',
      '2026-01-12T15:00:00.000Z',
    ]);
    expect(occs[0].endAt.getTime() - occs[0].startAt.getTime()).toBe(HOUR);
  });

  it('expands weekly and respects recurrenceUntil (inclusive of occurrences starting before it)', () => {
    const occs = expandOccurrences(
      ev({ recurrence: 'weekly', recurrenceUntil: D('2026-01-20T00:00:00Z') }),
      D('2026-01-01T00:00:00Z'),
      D('2026-03-01T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-05T15:00:00.000Z',
      '2026-01-12T15:00:00.000Z',
      '2026-01-19T15:00:00.000Z',
    ]);
  });

  it('expands monthly with end-of-month clamping', () => {
    const occs = expandOccurrences(
      ev({ startAt: D('2026-01-31T10:00:00Z'), endAt: D('2026-01-31T11:00:00Z'), recurrence: 'monthly' }),
      D('2026-01-01T00:00:00Z'),
      D('2026-04-30T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-31T10:00:00.000Z',
      '2026-02-28T10:00:00.000Z',
      '2026-03-31T10:00:00.000Z',
    ]);
  });

  it('finds occurrences whose duration is longer than the recurrence step', () => {
    // 3-day-long daily event: occurrences starting BEFORE the window can still overlap it.
    // Exercises the `- duration` term in the skip-ahead formula.
    const occs = expandOccurrences(
      ev({ startAt: D('2026-01-05T00:00:00Z'), endAt: D('2026-01-08T00:00:00Z'), recurrence: 'daily' }),
      D('2026-01-10T00:00:00Z'),
      D('2026-01-11T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-08T00:00:00.000Z',
      '2026-01-09T00:00:00.000Z',
      '2026-01-10T00:00:00.000Z',
    ]);
  });

  it('includes an occurrence whose start is EXACTLY recurrenceUntil', () => {
    const occs = expandOccurrences(
      ev({ recurrence: 'weekly', recurrenceUntil: D('2026-01-19T15:00:00.000Z') }),
      D('2026-01-01T00:00:00Z'),
      D('2026-03-01T00:00:00Z'),
    );
    expect(occs.map((o) => o.startAt.toISOString())).toEqual([
      '2026-01-05T15:00:00.000Z',
      '2026-01-12T15:00:00.000Z',
      '2026-01-19T15:00:00.000Z',
    ]);
  });

  it('yields nothing when recurrenceUntil is before the event start', () => {
    // A Task 6 validator rejects this input; this pins the pure function's behavior anyway.
    const occs = expandOccurrences(
      ev({ recurrence: 'weekly', recurrenceUntil: D('2026-01-01T00:00:00Z') }),
      D('2026-01-01T00:00:00Z'),
      D('2026-03-01T00:00:00Z'),
    );
    expect(occs).toEqual([]);
  });

  it('never returns occurrences before the event start and caps runaway expansion', () => {
    expect(
      expandOccurrences(ev({ recurrence: 'daily' }), D('2025-01-01T00:00:00Z'), D('2025-06-01T00:00:00Z')),
    ).toHaveLength(0);
    const capped = expandOccurrences(
      ev({ recurrence: 'daily' }),
      D('2026-01-05T00:00:00Z'),
      D('2036-01-05T00:00:00Z'),
    );
    expect(capped.length).toBeLessThanOrEqual(500);
  });
});
