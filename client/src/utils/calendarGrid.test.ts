import { describe, expect, it } from 'vitest';
import { addDays, monthGrid, startOfWeek } from './calendarGrid';

describe('calendarGrid', () => {
  it('monthGrid returns 42 cells starting on Sunday with inMonth flags', () => {
    // July 2026: the 1st is a Wednesday.
    const cells = monthGrid(2026, 6);
    expect(cells).toHaveLength(42);
    expect(cells[0].date.getDay()).toBe(0); // Sunday
    expect(cells[0].date.getDate()).toBe(28); // June 28
    expect(cells[0].inMonth).toBe(false);
    expect(cells[3].date.getDate()).toBe(1); // July 1
    expect(cells[3].inMonth).toBe(true);
    expect(cells[33].date.getDate()).toBe(31);
    expect(cells[34].inMonth).toBe(false); // Aug 1
  });

  it('startOfWeek returns the preceding Sunday at midnight local; addDays adds calendar days', () => {
    const thu = new Date(2026, 6, 9, 15, 30);
    const sun = startOfWeek(thu);
    expect(sun.getDay()).toBe(0);
    expect(sun.getDate()).toBe(5);
    expect(sun.getHours()).toBe(0);
    expect(addDays(sun, 7).getDate()).toBe(12);
  });
});
