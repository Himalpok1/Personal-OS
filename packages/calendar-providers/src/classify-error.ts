import { type CalendarSyncErrorCode, sanitizeCalendarSyncErrorCode } from "@personal-os/schema";
import { CalDavError } from "./caldav/caldav-client.js";
import { GoogleCalendarApiError } from "./google-calendar-client.js";
import { GoogleOAuthError } from "./google-oauth.js";

/**
 * Maps a thrown calendar-provider error onto the closed
 * `CalendarSyncErrorCode` vocabulary.
 *
 * This is the ONLY place a provider error object may be inspected on its way to
 * a durable column, an API response, or a log line. Callers must never reach for
 * `err.message` themselves: for Google that string is
 * `parsedError.error_description` / `parsed.error.message`, i.e. vendor prose
 * lifted verbatim out of an upstream JSON body, and for CalDAV it can embed the
 * server URL.
 *
 * Classification is driven by STRUCTURED fields the provider supplies --
 * `googleErrorCode`, `googleReason`, `isConflict`, and the HTTP status -- never
 * by string-matching a human-readable message, which is the check that breaks
 * silently the first time a vendor rewords an error.
 *
 * HTTP status is the LAST resort, not the primary signal, because the same
 * status means different actionable things per provider (a Google 403 is
 * usually a scope problem; a CalDAV 403 is usually a plain authorization
 * refusal). Where a structured reason exists it wins.
 */
export function classifyCalendarProviderError(err: unknown): CalendarSyncErrorCode {
  if (err instanceof GoogleOAuthError) {
    // `isPermanent` is the provider's own invalid_grant/invalid_client signal:
    // the grant is dead and only a fresh user consent revives it.
    if (err.isPermanent) return "auth_expired";
    if (err.googleErrorCode === "invalid_scope") return "missing_scope";
    return fromHttpStatus(err.httpStatus, "auth_failed");
  }

  if (err instanceof GoogleCalendarApiError) {
    switch (err.googleReason) {
      case "rateLimitExceeded":
      case "userRateLimitExceeded":
      case "quotaExceeded":
        return "rate_limited";
      case "insufficientPermissions":
      case "forbidden":
        return "missing_scope";
      case "authError":
      case "invalidCredentials":
        return "auth_expired";
      case "notFound":
        return "not_found";
      default:
        break;
    }
    if (err.httpStatus === 401) return "auth_expired";
    // A Google Calendar 403 that carried no reason is overwhelmingly a
    // permission problem rather than a bad credential -- the credential would
    // have produced a 401.
    if (err.httpStatus === 403) return "missing_scope";
    return fromHttpStatus(err.httpStatus, "provider_error");
  }

  if (err instanceof CalDavError) {
    if (err.isConflict) return "conflict";
    if (err.status === undefined) {
      // Discovery and XML-parsing failures carry no status. They are genuinely
      // unclassifiable from here, and the message must not substitute.
      return "provider_error";
    }
    // A CalDAV 403 is a plain authorization refusal, not a scope grant -- CalDAV
    // has no scope concept at all.
    if (err.status === 401 || err.status === 403) return "auth_failed";
    // 405 on a calendar collection is the server refusing the METHOD -- a
    // read-only collection that will not take a PUT/DELETE. Authentication
    // was fine; the permission is what is missing (fixer review, MINOR-3).
    if (err.status === 405) return "missing_scope";
    return fromHttpStatus(err.status, "provider_error");
  }

  if (isNetworkError(err)) return "network_error";

  return "provider_error";
}

/**
 * Re-classifies a value that may already be a code (a row written by a current
 * build) or may be legacy provider prose (a row written before Checkpoint 6.5).
 *
 * Kept next to the classifier so the two cannot drift; delegates the actual
 * allowlist to `packages/schema`, which is the single owner of the vocabulary.
 */
export function classifyStoredCalendarSyncError(
  raw: string | null | undefined,
): CalendarSyncErrorCode | null {
  return sanitizeCalendarSyncErrorCode(raw);
}

function fromHttpStatus(status: number, fallback: CalendarSyncErrorCode): CalendarSyncErrorCode {
  if (status === 429) return "rate_limited";
  if (status === 404 || status === 410) return "not_found";
  if (status === 409 || status === 412) return "conflict";
  if (status >= 500) return "provider_unavailable";
  if (status === 401) return "auth_expired";
  if (status === 400) return "invalid_request";
  if (status > 400 && status < 500) return fallback;
  return fallback;
}

/**
 * Detects a transport failure -- the request never reached the provider.
 *
 * `fetch` reports these as a bare `TypeError` whose `cause` carries the libuv
 * code, so both halves are checked: neither alone is reliable across Node
 * versions and undici releases.
 */
const NETWORK_ERROR_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EPIPE",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
  "UND_ERR_BODY_TIMEOUT",
  "CERT_HAS_EXPIRED",
]);

function hasNetworkErrorCode(value: unknown, depth = 0): boolean {
  if (!value || typeof value !== "object" || depth > 3) return false;
  const code = (value as { code?: unknown }).code;
  if (typeof code === "string" && NETWORK_ERROR_CODES.has(code)) return true;
  // undici wraps a dual-stack connect failure in an AggregateError whose
  // `errors` carry the per-address codes; `cause.code` alone is undefined.
  const nested = (value as { errors?: unknown }).errors;
  if (Array.isArray(nested)) return nested.some((inner) => hasNetworkErrorCode(inner, depth + 1));
  return false;
}

function isNetworkError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  // An aborted or timed-out fetch rejects with a DOMException named
  // `AbortError` / `TimeoutError` (Checkpoint 9.5: googleFetch carries
  // `AbortSignal.timeout`). DOMException extends Error in current Node, but
  // the name is the documented contract, so it is checked without an
  // instanceof guard -- a runtime where it did not extend Error would
  // otherwise classify a timeout as `provider_error` and stop retrying.
  const name = (err as { name?: unknown }).name;
  if (name === "AbortError" || name === "TimeoutError") return true;
  if (!(err instanceof Error)) return false;
  const cause: unknown = (err as { cause?: unknown }).cause;
  if (hasNetworkErrorCode(cause)) return true;
  if (hasNetworkErrorCode(err)) return true;
  return err instanceof TypeError && err.message.toLowerCase().includes("fetch");
}
