import { describe, expect, it } from 'vitest';
import { getSettings } from '../src/models/Settings.js';
import { User } from '../src/models/User.js';
import { verifyPassword } from '../src/utils/password.js';

const { seed } = await import('../scripts/seed.js');

describe('seed', () => {
  it('creates the broker and brand once, then is idempotent', async () => {
    const first = await seed({
      email: 'Boss@X.com',
      password: 'Password1!',
      displayName: 'Boss',
      brandName: 'Acme Realty',
    });
    expect(first).toContain('Created');
    const user = await User.findOne({ email: 'boss@x.com' });
    expect(user?.role).toBe('broker');
    expect(await verifyPassword('Password1!', user!.hashedPassword)).toBe(true);
    expect((await getSettings()).brandName).toBe('Acme Realty');

    const second = await seed({
      email: 'boss@x.com',
      password: 'Password1!',
      displayName: 'Boss',
      brandName: 'Different Name',
    });
    expect(second).toContain('already exists');
    expect(await User.countDocuments({ role: 'broker' })).toBe(1);
    expect((await getSettings()).brandName).toBe('Acme Realty');
  });
});
