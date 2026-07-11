import { describe, expect, it } from 'vitest';
import { CalendarEvent } from '../src/models/CalendarEvent.js';
import { User } from '../src/models/User.js';

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
