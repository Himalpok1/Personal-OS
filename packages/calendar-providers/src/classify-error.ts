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
function isNetworkError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  const cause: unknown = (err as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  if (typeof code === "string") {
    return [
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
      "CERT_HAS_EXPIRED",
    ].includes(code);
  }
  return err instanceof TypeError && err.message.toLowerCase().includes("fetch");
}
