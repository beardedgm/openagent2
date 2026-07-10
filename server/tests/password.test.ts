import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('password', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(hash.startsWith('scrypt:')).toBe(true);
    expect(await verifyPassword('hunter2!secret', hash)).toBe(true);
  });

  it('rejects wrong passwords and malformed hashes', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:zz:zz')).toBe(false);
  });

  it('produces unique salts', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });
});
