import { describe, expect, it } from 'vitest';
import { verifyTurnstile } from '../src/utils/turnstile.js';

describe('turnstile', () => {
  it('passes when no secret is configured (dev mode)', async () => {
    expect(await verifyTurnstile(undefined, '1.2.3.4')).toBe(true);
    expect(await verifyTurnstile('any-token', '1.2.3.4')).toBe(true);
  });
});
