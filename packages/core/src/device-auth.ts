import { createHash, randomBytes } from "node:crypto";

// Device bearer tokens and pairing codes share the same cryptographic
// pattern -- a random secret, stored only as a one-way hash -- so both are
// built on the same two primitives rather than duplicating the hash logic.
// This is deliberately not the AES-256-GCM scheme
// packages/ai-providers/credential-crypto.ts uses for AI provider keys:
// those must be recoverable in plaintext to make outbound API calls, but a
// device token or pairing code never needs to be recovered, only compared
// against what a caller presents. A fast, deterministic hash is the right
// primitive here -- the secret itself (256 bits of random entropy for
// tokens) has no dictionary to defend against, unlike a low-entropy human
// password.
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A random, URL-safe, 256-bit device bearer token. Returned to the caller
 * exactly once (at registration) -- only its hash is ever stored. */
export function generateDeviceToken(): string {
  return randomBytes(32).toString("base64url");
}

/** sha256(token) hex -- the value actually stored in devices.token_hash and
 * compared against on every authenticated request. */
export function hashDeviceToken(token: string): string {
  return hashSecret(token);
}

// Crockford Base32 minus the ambiguous characters Crockford's own alphabet
// already excludes (0/O, 1/I/L, U) -- a code meant to be read off a
// terminal and typed on a small on-device keyboard should never require
// the user to guess whether a character is a letter or a digit.
const PAIRING_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const PAIRING_CODE_LENGTH = 8;

/** An 8-character, manually-typeable one-time pairing code, formatted
 * "XXXX-XXXX". Generated only by the server-side CLI script -- never by a
 * network-reachable endpoint (see apps/api/scripts/generate-pairing-code.ts
 * and devices' pairing-gated registration route). */
export function generatePairingCode(): string {
  const bytes = randomBytes(PAIRING_CODE_LENGTH);
  let code = "";
  for (const byte of bytes) {
    code += PAIRING_CODE_ALPHABET[byte % PAIRING_CODE_ALPHABET.length];
  }
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** sha256(code) hex, after normalizing away the display formatting (the
 * hyphen and case) so a code stored/compared this way is insensitive to how
 * exactly the user typed it back in. */
export function hashPairingCode(code: string): string {
  return hashSecret(code.replace(/-/g, "").toUpperCase());
}
