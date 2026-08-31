import { type MailSyncErrorCode } from "@personal-os/schema";
import { GmailApiError } from "./gmail-client.js";
import { GmailOAuthError } from "./gmail-oauth.js";

// Gmail failure classification.
//
// ===========================================================================
// THIS IS NOT A COPY OF THE HEALTH CLASSIFIER, AND THE DIFFERENCE IS EVIDENCE,
// NOT TASTE.
// ===========================================================================
//
// Checkpoint 6.3's central fix for Google Health was to STOP classifying on
// HTTP status and read `error.details[].reason` instead -- because a bare 400
// had been reported as `not_supported` when the real cause was two
// request-shape bugs of our own, and eight perfectly good metrics were declared
// unsupported on that inference.
//
// Checkpoint 7.2P went looking for the same signal on Gmail and found it is not
// there. Every failure observed against the live API -- three restriction 403s
// and the cursor-expiry 404 -- returned `details: []`. No `reason`, no `domain`,
// no structured token of any kind.
//
// So porting 6.3's classifier would produce a function that reads a field that
// is always empty and therefore always falls through to its default. What Gmail
// DOES supply is `error.status` (a canonical-code token such as
// `PERMISSION_DENIED` or `RESOURCE_EXHAUSTED`) and the HTTP status itself. Those
// two, plus THE OPERATION WE ISSUED, are the whole signal, and the operation is
// indispensable: an HTTP 404 means "your cursor has expired, resync" on
// `history.list` and "that message is gone" on `messages.get`. The transport
// cannot tell them apart; only the caller knows which call it made.
//
// ---------------------------------------------------------------------------
// TWO OUTPUTS, DELIBERATELY, because they answer different questions.
//
//   `code`         -> mail_connections.last_sync_error. A CLOSED enum
//                     (MailSyncErrorCode) answering "what, if anything, should
//                     the user do about this mailbox?" Typed onto the wire, so
//                     a prose leak is a parse failure (ADR-053).
//   `failureClass` -> mail_sync_runs.failure_class. A shape-constrained
//                     diagnostic token that may carry one `:` qualifier, for a
//                     set that legitimately grows.
//
// NEITHER EVER CARRIES PROVIDER PROSE. GmailApiError destroys the provider's
// message at construction; nothing here can reintroduce it, because nothing
// here reads a message.

export type MailOperation =
  | "get_profile"
  | "list_messages"
  | "get_message"
  | "list_history"
  | "refresh_token";

export interface MailFault {
  /** Connection-level actionable state. Closed vocabulary. */
  code: MailSyncErrorCode;
  /** Diagnostic token for the run audit. Growing vocabulary, token-shaped. */
  failureClass: string;
  httpStatus: number | null;
  /** Whether trying the SAME request again could plausibly succeed. */
  retryable: boolean;
  /**
   * The stored cursor is past the provider's history retention.
   *
   * A first-class transition rather than an edge case (ADR-053): it drives
   * `needs_full_resync`, a bounded full sync, and a fresh cursor.
   */
  cursorExpired: boolean;
  /** Seconds the provider asked us to wait, when it said so. */
  retryAfterSeconds: number | null;
}

/** `AbortSignal.timeout` rejects with "TimeoutError"; an external abort, "AbortError". */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function fault(
  code: MailSyncErrorCode,
  failureClass: string,
  opts: {
    httpStatus?: number | null;
    retryable?: boolean;
    cursorExpired?: boolean;
    retryAfterSeconds?: number | null;
  } = {},
): MailFault {
  return {
    code,
    failureClass,
    httpStatus: opts.httpStatus ?? null,
    retryable: opts.retryable ?? false,
    cursorExpired: opts.cursorExpired ?? false,
    retryAfterSeconds: opts.retryAfterSeconds ?? null,
  };
}

/**
 * Classifies anything thrown by a mail provider call.
 *
 * `operation` is REQUIRED rather than optional so a caller cannot accidentally
 * classify a `history.list` 404 as a missing resource -- the one mistake in this
 * function that would silently disable incremental sync forever, because the
 * cursor would never be marked expired and every subsequent pass would 404 in
 * exactly the same way.
 */
export function classifyMailFault(err: unknown, operation: MailOperation): MailFault {
  if (err instanceof GmailOAuthError) {
    // The token endpoint, not the API. `invalid_grant`/`invalid_client` mean the
    // grant is dead and no amount of retrying revives it; everything else there
    // is far more likely to be a transient Google-side fault than proof the user
    // revoked consent, and marking needs_reauth on a blip logs them out.
    return err.isPermanent
      ? fault("auth_expired", "auth_permanent", { httpStatus: err.httpStatus ?? null })
      : fault("provider_unavailable", "oauth_transient", {
          httpStatus: err.httpStatus ?? null,
          retryable: true,
        });
  }

  if (err instanceof GmailApiError) {
    const status = err.httpStatus;

    if (status === 401) {
      // NOT retryable at this layer. The pass owns exactly one refresh
      // allowance and spends it on a 401; retrying the same request with the
      // same dead token just burns quota.
      return fault("auth_failed", "auth_rejected", { httpStatus: status });
    }

    if (status === 403) {
      // 403 IS AMBIGUOUS ON GMAIL and the ambiguity is unavoidable here.
      // Gmail returns it for rate limiting, for `q` under gmail.metadata, and
      // for an insufficient grant -- and 7.2P proved `details` is empty, so the
      // reason token that would separate them does not exist. What remains is
      // `error.status`.
      if (err.gmailStatus === "RESOURCE_EXHAUSTED") {
        return fault("rate_limited", "rate_limited:403", {
          httpStatus: status,
          retryable: true,
          retryAfterSeconds: err.retryAfterSeconds,
        });
      }
      // A PERMISSION_DENIED left over. The two metadata-scope traps that also
      // produce it -- `q`, and format=FULL/RAW -- are UNREPRESENTABLE in this
      // package's request types, so we cannot be the cause; the remaining
      // explanation is a grant that no longer carries gmail.metadata.
      return fault("missing_scope", "missing_scope", { httpStatus: status });
    }

    if (status === 404) {
      // The one place the operation is decisive rather than merely helpful.
      if (operation === "list_history") {
        return fault("cursor_expired", "cursor_expired:list_history", {
          httpStatus: status,
          cursorExpired: true,
        });
      }
      return fault("not_found", `not_found:${operation}`, { httpStatus: status });
    }

    if (status === 429) {
      return fault("rate_limited", "rate_limited:429", {
        httpStatus: status,
        retryable: true,
        retryAfterSeconds: err.retryAfterSeconds,
      });
    }

    if (status === 400) {
      // Ours to fix, not the user's. Named separately from `provider_error` so
      // a request-shape defect is visible in the audit as a defect rather than
      // hiding among provider faults -- exactly the confusion 6.2P created.
      return fault("invalid_request", "invalid_request", { httpStatus: status });
    }

    if (status >= 500) {
      return fault("provider_unavailable", `provider_unavailable:${status}`, {
        httpStatus: status,
        retryable: true,
      });
    }

    return fault("provider_error", `provider_error:${status}`, { httpStatus: status });
  }

  if (isAbortLike(err)) {
    // Our own timeout, or a cancelled pass. Google may well have been fine.
    return fault("network_error", "transport:timeout", { retryable: true });
  }

  // Never reached a response at all: DNS, TLS, a socket reset. Exactly what
  // retrying exists for.
  return fault("network_error", "transport", { retryable: true });
}
