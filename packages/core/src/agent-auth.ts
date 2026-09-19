import { createHash, randomBytes } from "node:crypto";

// Agent bearer tokens (Checkpoint 10.9, ADR-081) share the device-token
// pattern from device-auth.ts exactly -- a random 256-bit secret, returned
// to the owner ONCE at registration and stored only as a one-way sha256 --
// with one visible difference: the `posa_` prefix. A device token and an
// agent token are never interchangeable (the two auth hooks look in
// different tables), and the prefix makes an agent token recognisable by
// eye in a terminal and by a secret scanner in a log or a commit, which a
// bare base64url string is not.
export const AGENT_TOKEN_PREFIX = "posa_";

function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/** A random, URL-safe, prefixed, 256-bit agent bearer token. Returned exactly once. */
export function generateAgentToken(): string {
  return `${AGENT_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
}

/** sha256(token) hex -- the value stored in agents.token_hash and compared on every /agent/* request. */
export function hashAgentToken(token: string): string {
  return hashSecret(token);
}

/** Cheap pre-check before hashing: an agent token always carries the prefix. */
export function looksLikeAgentToken(token: string): boolean {
  return token.startsWith(AGENT_TOKEN_PREFIX) && token.length > AGENT_TOKEN_PREFIX.length + 32;
}
