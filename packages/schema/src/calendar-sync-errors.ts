import { z } from "zod";

/**
 * The closed vocabulary of calendar-sync failure codes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before Checkpoint 6.5, `calendar_connections.last_sync_error` was written
 * with `err.message` straight off a provider error. For Google that message is
 * `parsedError.error_description` -- Google's own prose, lifted verbatim out of
 * the token endpoint's JSON error body (see
 * `packages/calendar-providers/src/google-oauth.ts`'s `postToken`). That column
 * was then projected into `GET /calendar-connections` and interpolated into the
 * Settings screen, so an upstream vendor string reached the user's screen
 * unfiltered. `packages/health-providers` never had this problem because
 * `markHealthConnectionNeedsReauth` has always accepted only its own literals;
 * calendar predates that discipline.
 *
 * The fix is structural rather than a review rule: the column, the API contract
 * and the UI all speak THIS vocabulary and nothing else. A message we did not
 * author is inexpressible rather than merely discouraged.
 *
 * WHY A CODE AND NOT A SANITIZED MESSAGE
 * --------------------------------------
 * Sanitizing prose means guessing which substrings are safe, which is exactly
 * the check that fails silently the first time a provider changes its wording.
 * A closed enum cannot carry a substring at all.
 *
 * WHY NO CHECK CONSTRAINT
 * -----------------------
 * ADR-050: the column is provider-adjacent and expected to grow, and
 * `reconcile-drizzle-tracking.ts` cannot process `DROP CONSTRAINT`, so widening
 * a CHECK later would force a hand-written unreconcilable migration. Zod
 * enforces the vocabulary; `sanitizeCalendarSyncErrorCode` enforces it again on
 * the way out, which is what makes rows written before this checkpoint safe
 * without a data migration.
 *
 * Each member names an ACTIONABLE state -- what the user can do about it --
 * never an HTTP status. Two failures a user would respond to identically share
 * a code.
 */
export const CalendarSyncErrorCodeSchema = z.enum([
  /** The grant is permanently dead. The user must reconnect. */
  "auth_expired",
  /** Credentials were rejected (a CalDAV password change, a disabled account). */
  "auth_failed",
  /** Authentication succeeded but the granted permissions are insufficient. */
  "missing_scope",
  /** The provider is throttling us. Time fixes this; the user need do nothing. */
  "rate_limited",
  /** The provider is down or erroring (5xx). Transient, not the user's fault. */
  "provider_unavailable",
  /** We could not reach the provider at all (DNS, TLS, connection refused). */
  "network_error",
  /** The remote calendar or event no longer exists. */
  "not_found",
  /** A concurrent edit was detected (ETag / precondition failure). */
  "conflict",
  /** The provider rejected the shape of our request. Ours to fix, not the user's. */
  "invalid_request",
  /** The connection is not active, so syncing was skipped. */
  "connection_inactive",
  /** Every retry was spent without success. */
  "retries_exhausted",
  /** Anything we could not classify. The deliberate catch-all. */
  "provider_error",
]);
export type CalendarSyncErrorCode = z.infer<typeof CalendarSyncErrorCodeSchema>;

const KNOWN_CODES: ReadonlySet<string> = new Set(CalendarSyncErrorCodeSchema.options);

/**
 * Narrows an arbitrary stored string to the closed vocabulary.
 *
 * This is the boundary guard for rows written BEFORE this checkpoint, which may
 * still hold provider prose. Anything unrecognised collapses to
 * `provider_error` -- never passed through, never partially matched, never
 * substring-searched. `null`/`undefined`/`""` stay absent, because "no error"
 * and "an error we cannot name" are different facts and the UI renders them
 * differently.
 */
export function sanitizeCalendarSyncErrorCode(
  raw: string | null | undefined,
): CalendarSyncErrorCode | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return KNOWN_CODES.has(raw) ? (raw as CalendarSyncErrorCode) : "provider_error";
}
