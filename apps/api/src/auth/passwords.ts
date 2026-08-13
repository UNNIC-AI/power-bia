import { randomBytes, type ScryptOptions, scrypt, timingSafeEqual } from 'node:crypto';

function derive(
  password: string,
  salt: Buffer,
  keyBytes: number,
  cost: ScryptOptions,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, keyBytes, cost, (error, key) => {
      if (error) reject(error);
      else resolve(key);
    });
  });
}

/**
 * scrypt rather than argon2id: it is built into Node, so there is no native
 * module to compile, and OWASP lists it as an acceptable alternative. Cost
 * parameters are stored alongside the hash so they can be raised later without
 * invalidating existing passwords.
 */
const COST = { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 } as const;
const KEY_BYTES = 64;
const SALT_BYTES = 16;

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, KEY_BYTES, COST);

  return ['scrypt', COST.N, COST.r, COST.p, salt.toString('base64'), key.toString('base64')].join(
    '$',
  );
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltPart, keyPart] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltPart || !keyPart) return false;

  const expected = Buffer.from(keyPart, 'base64');
  const actual = await derive(password, Buffer.from(saltPart, 'base64'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: COST.maxmem,
  });

  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
