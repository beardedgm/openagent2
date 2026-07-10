import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../src/utils/password.js';

describe('password', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(hash.startsWith('scrypt:32768:8:1:')).toBe(true);
    expect(await verifyPassword('hunter2!secret', hash)).toBe(true);
  });

  it('rejects wrong passwords and malformed hashes', async () => {
    const hash = await hashPassword('hunter2!secret');
    expect(await verifyPassword('wrong', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:zz:zz')).toBe(false);
    expect(await verifyPassword('x', 'scrypt:abc:8:1:aa:bb')).toBe(false);
  });

  it('produces unique salts', async () => {
    expect(await hashPassword('same')).not.toBe(await hashPassword('same'));
  });

  it('verifies hashes produced with different cost params', async () => {
    const legacyHash =
      'scrypt:16384:8:1:41f5985f80e55bae63e573e1d67f41ab:92dd1fde93c8478a7d01bb13b1fae08fbf57b0008bfef24dd884066b6d9980496ba0d3ee85e6ef73b23f9c0f0d3835a8bcc137ff1af173d4fb24d987267e21fb';
    expect(await verifyPassword('legacy-pass', legacyHash)).toBe(true);
  });
});
