import crypto from 'node:crypto';

const IV_LENGTH = 12;
const TAG_LENGTH = 16;
const ALGORITHM = 'aes-256-gcm';

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Output format: [12-byte IV][16-byte Auth Tag][Ciphertext]
 */
export function encryptMessage(plaintext: string, key: Buffer): Buffer {
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes');
  }

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();

  return Buffer.concat([iv, tag, encrypted]);
}

/**
 * Decrypts a buffer produced by encryptMessage.
 */
export function decryptMessage(encryptedBuf: Buffer, key: Buffer): string {
  if (key.length !== 32) {
    throw new Error('Encryption key must be exactly 32 bytes');
  }

  if (encryptedBuf.length < IV_LENGTH + TAG_LENGTH) {
    // If not encrypted with GCM format, fallback to utf8 string
    return encryptedBuf.toString('utf8');
  }

  const iv = encryptedBuf.subarray(0, IV_LENGTH);
  const tag = encryptedBuf.subarray(IV_LENGTH, IV_LENGTH + TAG_LENGTH);
  const ciphertext = encryptedBuf.subarray(IV_LENGTH + TAG_LENGTH);

  try {
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    // Fallback if legacy plaintext stored
    return encryptedBuf.toString('utf8');
  }
}
