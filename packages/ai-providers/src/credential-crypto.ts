import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;

export interface EncryptedSecret {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

function loadKey(base64Key: string): Buffer {
  const key = Buffer.from(base64Key, "base64");
  if (key.length !== 32) {
    throw new Error(`CREDENTIALS_ENCRYPTION_KEY must decode to 32 bytes, got ${key.length}`);
  }
  return key;
}

// AES-256-GCM: the only place provider API keys exist in plaintext outside
// a live request to the provider. Never log the plaintext or the key
// material passed in here.
export function encryptSecret(plaintext: string, base64Key: string): EncryptedSecret {
  const key = loadKey(base64Key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext, iv, authTag: cipher.getAuthTag() };
}

// Throws if the ciphertext/IV/authTag were tampered with -- GCM's
// authentication tag makes silent corruption impossible to miss.
export function decryptSecret(encrypted: EncryptedSecret, base64Key: string): string {
  const key = loadKey(base64Key);
  const decipher = createDecipheriv(ALGORITHM, key, encrypted.iv);
  decipher.setAuthTag(encrypted.authTag);
  const plaintext = Buffer.concat([decipher.update(encrypted.ciphertext), decipher.final()]);
  return plaintext.toString("utf8");
}
