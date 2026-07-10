import { describe, expect, it } from 'vitest';
import { ActivityEvent } from '../src/models/ActivityEvent.js';
import { emitActivity } from '../src/services/activityService.js';

describe('activityService.emitActivity', () => {
  it('creates an event with defaults', async () => {
    await emitActivity({ type: 'agentJoined', message: 'Ana joined Acme Realty', link: '/profile/abc' });
    const e = (await ActivityEvent.findOne())!;
    expect(e.type).toBe('agentJoined');
    expect(e.message).toBe('Ana joined Acme Realty');
    expect(e.link).toBe('/profile/abc');
    expect(e.officeId).toBeNull();
    expect(e.pinnedUntil).toBeNull();
  });

  it('rejects unknown types', async () => {
    await expect(
      emitActivity({ type: 'bogus' as never, message: 'x' }),
    ).rejects.toThrow();
  });
});
