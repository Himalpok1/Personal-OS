import { GoogleHealthApiError } from "../google-health-client.js";

// Capability adjudication for one metric stream over one window.
//
// THE RULE THIS MODULE EXISTS TO ENFORCE: an HTTP status alone NEVER decides a
// capability verdict.
//
// The 6.2P probe mapped 403 -> missing_scope and 400/404 -> not_supported. Both
// mappings are wrong, and the second one actively lied: every dailyRollUp call
// failed with HTTP 400 because of two request-shape defects OF OURS (a
// startTime/start field-name error and an unsupported pageSize), and the probe
// duly reported all eight rollup metrics as "not supported by the provider".
// The account and the API were fine. Removing one field turned the identical
// request into a 200 with data.
//
// A capability verdict is a durable claim about what a provider can do, and it
// gates whether a stream stays enabled. Deriving it from a status code means a
// bug in our own request can permanently disable a working stream, and the
// evidence that it was our bug is discarded in the same breath. So: a verdict
// is reached only from an EVIDENCED reason token. Everything else -- including
// every ambiguous 403 and 404 -- reports provider_error, which is loud,
// retryable-by-a-human, and does not disable anything.

export type HealthCapability =
  /** The window was fetched and contained records. */
  | "available_in_window"
  /** The window was fetched, was empty, and no data has ever been seen. */
  | "supported_empty_in_window"
  /** The window was empty, but data exists outside it -- the stream is real. */
  | "historical_data_outside_window"
  /** Evidenced by a scope reason token. The user did not grant this scope. */
  | "missing_scope"
  /** Evidenced by an unsupported reason token. Google cannot serve this type. */
  | "not_supported"
  /** Everything else. Not a verdict about the provider's capability at all. */
  | "provider_error";

/**
 * A provider failure reduced to tokens that are safe to store and to log.
 *
 * Constructed by sanitizeApiError, which is the ONLY way one should be made:
 * building it by hand invites someone to pass `err.message` through.
 */
export interface ProviderFault {
  /** 0 for a transport-level fault that never reached an HTTP status. */
  httpStatus: number;
  googleStatus: string | null;
  reasons: readonly string[];
  retryable: boolean;
}

/**
 * Enumerable-token shape: SCREAMING_SNAKE, as Google writes both `error.status`
 * (`INVALID_ARGUMENT`, `PERMISSION_DENIED`) and `error.details[].reason`
 * (`ACCESS_TOKEN_SCOPE_INSUFFICIENT`).
 *
 * Anything failing this test is dropped rather than truncated or escaped. A
 * string that is not a token is prose, and prose is where a field path, an
 * echoed argument, an account label or a health value would hide.
 */
const TOKEN = /^[A-Z][A-Z0-9_]*$/;

function tokensOnly(values: readonly string[]): readonly string[] {
  return values.filter((v) => TOKEN.test(v));
}

/**
 * Reduces any thrown value to a ProviderFault.
 *
 * Accepts `unknown` on purpose. A sync attempt can fail without ever producing
 * a GoogleHealthApiError -- DNS failure, socket reset, an AbortSignal firing
 * from the limiter's timeout -- and those failures must be representable, not
 * an unhandled crash at the classification boundary. They map to httpStatus 0.
 *
 * Note what is NOT carried out of here under any circumstance: the error
 * message, the stack, and `error.details[].metadata`. See google-health-client's
 * comment in request() for why the message in particular is poison.
 */
export function sanitizeApiError(err: unknown): ProviderFault {
  if (!(err instanceof GoogleHealthApiError)) {
    // A transport fault is retryable by definition: nothing about the request
    // was rejected, so nothing about the request is known to be wrong.
    return { httpStatus: 0, googleStatus: null, reasons: [], retryable: true };
  }
  const [googleStatus] = tokensOnly(err.googleStatus === undefined ? [] : [err.googleStatus]);
  return {
    httpStatus: err.httpStatus,
    googleStatus: googleStatus ?? null,
    reasons: tokensOnly(err.errorReasons),
    retryable: err.httpStatus === 429 || err.httpStatus >= 500 || err.httpStatus === 0,
  };
}

/**
 * Reason tokens that genuinely prove a scope was not granted.
 *
 * Each entry must be evidenced -- a live observation recorded in
 * docs/STATUS.md, or a citation of Google's published error reference. Nothing
 * is added on inference.
 */
const SCOPE_REASONS = new Set(["ACCESS_TOKEN_SCOPE_INSUFFICIENT"]);

/**
 * Reason tokens that genuinely prove Google cannot serve a data type.
 *
 * DELIBERATELY EMPTY. No such reason has been observed live and none is cited
 * in the published reference, so the set stays empty until one is.
 *
 * The three reasons 6.2P DID observe live are conspicuously absent, and belong
 * in neither set:
 *
 *   - INVALID_ROLLUP_QUERY_DURATION          (we sent pageSize)
 *   - INVALID_DATA_POINT_DATA_SOURCE_FAMILY  (we sent a bare family name)
 *   - the `Cannot find field` shape error    (we sent startTime, not start)
 *
 * All three are OUR client-side request defects. Every one of them was
 * originally read as "the provider does not support this metric", and every one
 * of them was fixed by changing one field in our own request. Classifying any
 * of them as not_supported would re-create exactly the failure 6.3 exists to
 * delete.
 *
 * The cost of the empty set is that a genuinely unsupported metric reports
 * provider_error instead of not_supported. That is the safe direction: a
 * provider_error is noisy and gets looked at, and it never disables a stream
 * that works. The opposite mistake is silent and permanent.
 */
const UNSUPPORTED_REASONS = new Set<string>([]);

export interface CapabilityInput {
  /** null when the call succeeded. */
  fault: ProviderFault | null;
  /** Records returned across the whole window, all pages. */
  recordCount: number;
  /**
   * The earliest local_date this stream has EVER produced data for, or null if
   * it never has. Distinguishes "this window is empty" from "this stream is
   * empty", which is the difference between a wearable that is not worn this
   * week and a wearable that was never paired.
   */
  firstDataDate: string | null;
}

export interface CapabilityVerdict {
  capability: HealthCapability;
  /**
   * A stable token for health_sync_runs.failure_class. Null on every success.
   * Never free text -- the reason half is always an already-validated token.
   */
  failureClass: string | null;
}

export function classifyCapability(input: CapabilityInput): CapabilityVerdict {
  const { fault, recordCount, firstDataDate } = input;

  if (fault) {
    // Evidenced verdicts first: a reason token outranks every status heuristic,
    // including on a status that "looks like" something else.
    for (const reason of fault.reasons) {
      if (SCOPE_REASONS.has(reason)) return { capability: "missing_scope", failureClass: null };
    }
    for (const reason of fault.reasons) {
      if (UNSUPPORTED_REASONS.has(reason)) {
        return { capability: "not_supported", failureClass: null };
      }
    }

    if (fault.retryable) {
      return {
        capability: "provider_error",
        failureClass:
          fault.httpStatus === 429
            ? "rate_limited"
            : fault.httpStatus === 0
              ? "transport"
              : "provider_unavailable",
      };
    }

    // 401 is about the GRANT, never about the metric. Letting it reach a
    // capability verdict would let one expired token mark every stream on the
    // connection as unsupported. Resolving it is the connection's job.
    if (fault.httpStatus === 401) {
      return { capability: "provider_error", failureClass: "auth_unresolved" };
    }

    // Every other 400 / 403 / 404, and anything else non-retryable. An
    // ambiguous 403 with no reason is NOT a missing scope -- it is equally
    // consistent with a malformed resource name -- and an ambiguous 404 is at
    // least as likely to be a path we built wrong as a type Google lacks.
    //
    // The reason is embedded in the failure class rather than dropped, because
    // the whole point is that the next person debugging this can see WHICH
    // request defect it was without re-running the probe.
    const reason = fault.reasons[0];
    return {
      capability: "provider_error",
      failureClass:
        reason !== undefined
          ? `client_request_defect:${reason}`
          : `provider_error:${fault.httpStatus}`,
    };
  }

  if (recordCount > 0) return { capability: "available_in_window", failureClass: null };
  if (firstDataDate !== null) {
    return { capability: "historical_data_outside_window", failureClass: null };
  }
  return { capability: "supported_empty_in_window", failureClass: null };
}
