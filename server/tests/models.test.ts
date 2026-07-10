import { describe, expect, it } from 'vitest';
import { EngagementEvent } from '../src/models/EngagementEvent.js';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { logEngagement } from '../src/services/engagementService.js';

describe('models', () => {
  it('getSettings creates then reuses a singleton', async () => {
    const a = await getSettings();
    const b = await getSettings();
    expect(b.id).toBe(a.id);
    expect(a.primaryColor).toBe('#1d4ed8');
  });

  it('rejects duplicate user emails', async () => {
    await User.init();
    const base = { hashedPassword: 'x', role: 'agent', displayName: 'A' };
    await User.create({ ...base, email: 'dup@x.com' });
    await expect(User.create({ ...base, email: 'DUP@x.com' })).rejects.toThrow();
  });

  it('logEngagement writes an event', async () => {
    const u = await User.create({ email: 'e@x.com', hashedPassword: 'x', role: 'agent', displayName: 'E' });
    logEngagement('login', u.id);
    await new Promise((r) => setTimeout(r, 50));
    expect(await EngagementEvent.countDocuments({ type: 'login' })).toBe(1);
  });
});
