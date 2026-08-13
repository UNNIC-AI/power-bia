import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './passwords.js';

describe('passwords', () => {
  it('verifies a correct password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('correct horse battery staple', stored)).resolves.toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const stored = await hashPassword('correct horse battery staple');

    await expect(verifyPassword('Correct horse battery staple', stored)).resolves.toBe(false);
  });

  it('salts each hash', async () => {
    const [first, second] = await Promise.all([hashPassword('same'), hashPassword('same')]);

    expect(first).not.toBe(second);
  });

  it('rejects a malformed stored hash', async () => {
    await expect(verifyPassword('whatever', 'not-a-hash')).resolves.toBe(false);
  });
});
