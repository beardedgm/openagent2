import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt) as (
  pw: string,
  salt: Buffer,
  keylen: number,
  opts: ScryptOptions,
) => Promise<Buffer>;
const KEYLEN = 64;
const SCRYPT_PARAMS = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, KEYLEN, SCRYPT_PARAMS);
  const { N, r, p } = SCRYPT_PARAMS;
  return `scrypt:${N}:${r}:${p}:${salt.toString('hex')}:${key.toString('hex')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, nStr, rStr, pStr, saltHex, keyHex] = stored.split(':');
  if (alg !== 'scrypt' || !nStr || !rStr || !pStr || !saltHex || !keyHex) return false;
  const N = Number(nStr);
  const r = Number(rStr);
  const p = Number(pStr);
  if (![N, r, p].every((n) => Number.isInteger(n) && n > 0)) return false;
  const expected = Buffer.from(keyHex, 'hex');
  if (expected.length !== KEYLEN) return false;
  const key = await scryptAsync(password, Buffer.from(saltHex, 'hex'), KEYLEN, {
    N,
    r,
    p,
    maxmem: SCRYPT_PARAMS.maxmem,
  });
  return timingSafeEqual(key, expected);
}
