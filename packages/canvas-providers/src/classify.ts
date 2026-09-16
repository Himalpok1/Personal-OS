import {
  CanvasApiError,
  CanvasTokenFormatError,
  type CanvasFailureClass,
} from "./canvas-client.js";
import { CanvasUrlBlockedError } from "./ssrf.js";

// Canvas failure classification (ADR-068).
//
// Deliberately simpler than packages/mail-providers/src/classify.ts, and the
// difference is evidence, not an oversight. Gmail overloads 403 across THREE
// distinct causes (rate limiting, `q` under gmail.metadata, an insufficient
// OAuth grant) and needs `error.status`/`details[].reason` plus an
// `operation` parameter to tell a cursor-expiry 404 apart from an ordinary
// missing-message 404. A Canvas Personal Access Token carries no OAuth grant
// to expire and no cursor to go stale: a 403 here is either "the token is
// bad or lacks course access" or "you are being rate limited", and that
// distinction was already resolved once, at throw time, by
// `canvas-client.ts`'s `request()` -- the only code that ever sees the
// response body. There is likewise no 404 whose meaning depends on which
// endpoint issued it: every list method in this package means "not found"
// and nothing else on a 404, so no `operation` parameter is needed here.
//
// NEITHER OUTPUT EVER CARRIES PROVIDER PROSE. `CanvasApiError` destroys the
// response body at construction -- it reads at most one fixed-vocabulary
// token (`status: "rate limit exceeded"`) and never `errors[].message` --
// and nothing here can reintroduce it, because nothing here reads a message
// either.

export interface CanvasFault {
  /** Closed vocabulary. Never provider prose. */
  failureClass: CanvasFailureClass;
  httpStatus: number | null;
  /** Whether trying the SAME request again could plausibly succeed. */
  retryable: boolean;
}

/** `AbortSignal.timeout` rejects with "TimeoutError"; an external abort, "AbortError". */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Classifies anything thrown by a `CanvasClient` call.
 *
 * Reads `CanvasApiError.code` rather than re-deriving it from `httpStatus`,
 * so the rate-limit-vs-bad-token distinction is decided in exactly one place
 * -- `canvas-client.ts`'s `request()`, which alone saw the response body and
 * the rate-limit header -- and this function cannot drift from it.
 */
export function classifyCanvasFault(err: unknown): CanvasFault {
  if (err instanceof CanvasApiError) {
    return {
      failureClass: err.code,
      httpStatus: err.httpStatus,
      retryable: err.code === "rate_limited" || err.httpStatus >= 500,
    };
  }

  if (err instanceof CanvasTokenFormatError) {
    // Refused before any header was built (Checkpoint 10.2 hotfix): the
    // stored or supplied token cannot be a header value. Never retryable --
    // the same token fails the same way -- and classified as `auth_failed`
    // so a connection-level occurrence flips the row to `invalid_token`
    // exactly like a dead PAT would.
    return { failureClass: "auth_failed", httpStatus: null, retryable: false };
  }

  if (err instanceof CanvasUrlBlockedError) {
    // Refused before any network call was made (a bad base URL, or a
    // redirect into a blocked range) -- never retryable, since a retry
    // sends the identical blocked request again.
    return { failureClass: "blocked_url", httpStatus: null, retryable: false };
  }

  if (isAbortLike(err)) {
    // Our own timeout, or a cancelled pass. Canvas may well have been fine.
    return { failureClass: "network_error", httpStatus: null, retryable: true };
  }

  // Never reached a response at all: DNS, TLS, a socket reset. Exactly what
  // retrying exists for.
  return { failureClass: "network_error", httpStatus: null, retryable: true };
}
