import { z } from "zod";

/**
 * The closed vocabulary of mail-connection failure codes (ADR-053).
 *
 * WHY A CLOSED ENUM HERE AND A SHAPE-CONSTRAINED TOKEN BELOW
 * ---------------------------------------------------------
 * These are two different things and the repository already has both patterns,
 * so 7.1 uses each where it belongs rather than picking one.
 *
 * `mail_connections.last_sync_error` is a CONNECTION-LEVEL ACTIONABLE STATE:
 * it answers "what, if anything, should the user do about this mailbox?" That
 * question has finitely many answers -- reconnect, wait, nothing -- so the
 * vocabulary is genuinely closed and gets a closed enum, exactly as
 * `CalendarSyncErrorCode` does.
 *
 * `mail_sync_runs.failure_class` is a DIAGNOSTIC CLASS. That set legitimately
 * grows as new Gmail failure modes are observed, so it gets the
 * shape-constrained token instead -- the `HealthSyncErrorToken` pattern.
 *
 * WHY A CODE AND NOT A SANITIZED MESSAGE
 * --------------------------------------
 * Gmail's error bodies echo the offending request back (`INVALID_ARGUMENT`
 * prose names the field and often the value), so a message is a
 * caller-controlled channel out of the request. Sanitizing prose means guessing
 * which substrings are safe, which is the check that fails silently the first
 * time a vendor rewords an error. A closed enum cannot carry a substring at all.
 *
 * WHY NO CHECK CONSTRAINT
 * -----------------------
 * ADR-050: `reconcile-drizzle-tracking.ts` understands `ADD CONSTRAINT ...
 * CHECK` but not `DROP CONSTRAINT`, so widening a CHECK later forces a
 * hand-written unreconcilable migration. Zod enforces the vocabulary;
 * `sanitizeMailSyncErrorCode` enforces it again on the way out, which is what
 * makes a row written by an older or buggier build safe with no data migration.
 *
 * Each member names an ACTIONABLE state -- never an HTTP status. Two failures a
 * user would respond to identically share a code.
 */
export const MailSyncErrorCodeSchema = z.enum([
  /** The grant is permanently dead. The user must reconnect. */
  "auth_expired",
  /** Credentials were rejected (revoked at the provider, account disabled). */
  "auth_failed",
  /** Authentication succeeded but the granted scope is insufficient. */
  "missing_scope",
  /** The provider is throttling us. Time fixes this; the user need do nothing. */
  "rate_limited",
  /** The provider is down or erroring (5xx). Transient, not the user's fault. */
  "provider_unavailable",
  /** We could not reach the provider at all (DNS, TLS, connection refused). */
  "network_error",
  /**
   * The stored cursor is older than the provider's history retention, so
   * incremental sync is impossible until a bounded full resync runs (ADR-053).
   *
   * Mail-specific, and the reason this enum is not simply a copy of
   * `CalendarSyncErrorCode`: calendar has `conflict` for an ETag precondition
   * failure, which has no mail analogue, and mail has cursor expiry, which has
   * no calendar analogue. It is listed as actionable because it IS -- the
   * action is automatic and the user need do nothing -- and naming it keeps the
   * transition visible instead of hiding it inside `provider_error`.
   */
  "cursor_expired",
  /** The mailbox or resource no longer exists. */
  "not_found",
  /** The provider rejected the shape of our request. Ours to fix, not the user's. */
  "invalid_request",
  /** The connection is not active, so syncing was skipped. */
  "connection_inactive",
  /** Every retry was spent without success. */
  "retries_exhausted",
  /** Anything we could not classify. The deliberate catch-all. */
  "provider_error",
]);
export type MailSyncErrorCode = z.infer<typeof MailSyncErrorCodeSchema>;

const KNOWN_CODES: ReadonlySet<string> = new Set(MailSyncErrorCodeSchema.options);

/**
 * Narrows an arbitrary stored string to the closed vocabulary.
 *
 * The boundary guard for rows written by any build that got this wrong.
 * Anything unrecognised collapses to `provider_error` -- never passed through,
 * never partially matched, never substring-searched. `null`/`undefined`/`""`
 * stay absent, because "no error" and "an error we cannot name" are different
 * facts and the UI renders them differently.
 */
export function sanitizeMailSyncErrorCode(
  raw: string | null | undefined,
): MailSyncErrorCode | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return KNOWN_CODES.has(raw) ? (raw as MailSyncErrorCode) : "provider_error";
}

/**
 * The shape every `mail_sync_runs.failure_class` / `error_message` value must
 * have: a lowercase machine token with at most one `:`-separated qualifier
 * (`provider_error:503`, `client_request_defect:INVALID_ARGUMENT`).
 *
 * Identical in spirit to `HealthSyncErrorTokenSchema`. Prose cannot satisfy it
 * -- it has spaces, punctuation and capitals -- so a writer that reaches for
 * `err.message` instead of a classification fails HERE rather than in a durable
 * column, a log line, or `pgboss.job.output`.
 */
const MAIL_SYNC_FAILURE_CLASS = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;

export const MailSyncFailureClassSchema = z.string().regex(MAIL_SYNC_FAILURE_CLASS);

/**
 * Narrows a stored failure class to a token, or `"provider_error"` when it is
 * not token-shaped. Applied at the projection site, so a legacy or unexpected
 * value is neutralised without a data migration.
 */
export function sanitizeMailSyncFailureClass(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return MAIL_SYNC_FAILURE_CLASS.test(raw) ? raw : "provider_error";
}
