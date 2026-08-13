import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function toKey(hexKey: string): Buffer {
  const key = Buffer.from(hexKey, 'hex');
  if (key.length !== KEY_BYTES) {
    throw new Error(`DATASET_SECRET_KEY must be ${KEY_BYTES * 2} hex characters`);
  }
  return key;
}

/** Returns `iv:authTag:ciphertext`, all base64. */
export function encryptSecret(plaintext: string, hexKey: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, toKey(hexKey), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);

  return [iv, cipher.getAuthTag(), ciphertext].map((b) => b.toString('base64')).join(':');
}

export function decryptSecret(encrypted: string, hexKey: string): string {
  const [iv, authTag, ciphertext] = encrypted.split(':').map((p) => Buffer.from(p, 'base64'));
  if (!iv || !authTag || !ciphertext) throw new Error('Malformed encrypted secret');

  const decipher = createDecipheriv(ALGORITHM, toKey(hexKey), iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}
