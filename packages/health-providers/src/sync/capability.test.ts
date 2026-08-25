import { describe, expect, it } from "vitest";
import { GoogleHealthApiError } from "../google-health-client.js";
import { classifyCapability, sanitizeApiError, type ProviderFault } from "./capability.js";

/** Builds the error the client would have thrown for a given Google body. */
function apiError(
  httpStatus: number,
  googleStatus?: string,
  reasons: readonly string[] = [],
): GoogleHealthApiError {
  return new GoogleHealthApiError(
    `Google Health API ${httpStatus}${googleStatus ? ` ${googleStatus}` : ""}`,
    httpStatus,
    googleStatus,
    reasons.map((reason) => ({ reason, domain: "googleapis.com" })),
  );
}

function faultOf(
  httpStatus: number,
  googleStatus?: string,
  reasons: readonly string[] = [],
): ProviderFault {
  return sanitizeApiError(apiError(httpStatus, googleStatus, reasons));
}

const CLEAN = { recordCount: 0, firstDataDate: null };

describe("sanitizeApiError", () => {
  it("keeps only enumerable tokens", () => {
    const fault = faultOf(400, "INVALID_ARGUMENT", ["INVALID_ROLLUP_QUERY_DURATION"]);
    expect(fault).toEqual({
      httpStatus: 400,
      googleStatus: "INVALID_ARGUMENT",
      reasons: ["INVALID_ROLLUP_QUERY_DURATION"],
      retryable: false,
    });
  });

  it("drops a non-token status or reason rather than truncating it", () => {
    // Anything that is not SCREAMING_SNAKE is prose, and prose is where an
    // echoed request field would hide.
    const fault = faultOf(400, "Invalid argument: heart_rate", ["cannot find field 'startTime'"]);
    expect(fault.googleStatus).toBeNull();
    expect(fault.reasons).toEqual([]);
  });

  it("represents a non-GoogleHealthApiError as a retryable transport fault", () => {
    // A limiter-fired AbortSignal or a socket reset must be representable, not
    // an unhandled crash at the classification boundary.
    const fault = sanitizeApiError(new Error("aborted"));
    expect(fault).toEqual({ httpStatus: 0, googleStatus: null, reasons: [], retryable: true });
  });

  it("survives a thrown non-Error", () => {
    expect(sanitizeApiError("boom").retryable).toBe(true);
    expect(sanitizeApiError(undefined).httpStatus).toBe(0);
  });

  it("marks 429, 5xx and transport as retryable and 4xx as not", () => {
    expect(faultOf(429).retryable).toBe(true);
    expect(faultOf(503).retryable).toBe(true);
    expect(faultOf(500).retryable).toBe(true);
    expect(faultOf(400).retryable).toBe(false);
    expect(faultOf(401).retryable).toBe(false);
    expect(faultOf(403).retryable).toBe(false);
    expect(faultOf(404).retryable).toBe(false);
  });

  // The load-bearing leakage test. Google's INVALID_ARGUMENT prose echoes the
  // request, and pg-boss writes a thrown error's message into pgboss.job.output
  // -- a durable table in a worker process with no log redaction at all.
  it("lets no part of a Google message survive into the fault OR the error message", () => {
    const leaky =
      'Request had invalid authentication credentials "ya29.FAKE-not-a-real-token" and ' +
      "Authorization header; heart_rate.beats_per_minute was 168 at 'range'";
    const err = new GoogleHealthApiError(
      // The client constructs this token; the raw message is never passed in.
      "Google Health API 400 INVALID_ARGUMENT",
      400,
      "INVALID_ARGUMENT",
      [{ reason: "INVALID_ARGUMENT", domain: "googleapis.com", metadata: { detail: leaky } }],
    );
    const fault = sanitizeApiError(err);
    const serialized = JSON.stringify(fault) + err.message + String(err.stack ?? "");

    expect(serialized).not.toContain("ya29.");
    expect(serialized).not.toContain("168");
    expect(serialized).not.toContain("Authorization");
    expect(serialized).not.toContain("beats_per_minute");
    // metadata is never surfaced, so the leaky value cannot ride out on it.
    expect(JSON.stringify(fault)).not.toContain("detail");
    expect(err.message).toBe("Google Health API 400 INVALID_ARGUMENT");
  });
});

describe("classifyCapability -- success verdicts", () => {
  it("reports available_in_window when the window had records", () => {
    expect(
      classifyCapability({ fault: null, recordCount: 7, firstDataDate: "2026-08-18" }),
    ).toEqual({ capability: "available_in_window", failureClass: null });
  });

  it("reports supported_empty_in_window when the stream has never produced data", () => {
    expect(classifyCapability({ fault: null, ...CLEAN })).toEqual({
      capability: "supported_empty_in_window",
      failureClass: null,
    });
  });

  // The distinction 6.2P could not express: heart rate and sleep DO exist on
  // this account, just older than 30 days. Reporting them as "empty" implied
  // the streams were wrong; they are not.
  it("reports historical_data_outside_window when data exists outside it", () => {
    expect(
      classifyCapability({ fault: null, recordCount: 0, firstDataDate: "2026-04-29" }),
    ).toEqual({ capability: "historical_data_outside_window", failureClass: null });
  });
});

describe("classifyCapability -- evidenced verdicts", () => {
  it("reports missing_scope only on an evidenced scope reason", () => {
    expect(
      classifyCapability({
        fault: faultOf(403, "PERMISSION_DENIED", ["ACCESS_TOKEN_SCOPE_INSUFFICIENT"]),
        ...CLEAN,
      }),
    ).toEqual({ capability: "missing_scope", failureClass: null });
  });

  it("honours an evidenced reason regardless of the status carrying it", () => {
    // A reason token outranks every status heuristic. If Google ever returns
    // the scope reason on a 400, the verdict must not change.
    expect(
      classifyCapability({
        fault: faultOf(400, "INVALID_ARGUMENT", ["ACCESS_TOKEN_SCOPE_INSUFFICIENT"]),
        ...CLEAN,
      }).capability,
    ).toBe("missing_scope");
  });

  // not_supported is currently UNREACHABLE by design -- UNSUPPORTED_REASONS is
  // empty until a reason is evidenced. This pins that the verdict exists in the
  // vocabulary and that nothing reaches it by accident.
  it("never reports not_supported without an evidenced reason", () => {
    const candidates = [
      faultOf(400, "INVALID_ARGUMENT", ["INVALID_ROLLUP_QUERY_DURATION"]),
      faultOf(400, "INVALID_ARGUMENT", ["INVALID_DATA_POINT_DATA_SOURCE_FAMILY"]),
      faultOf(404, "NOT_FOUND"),
      faultOf(403, "PERMISSION_DENIED"),
      faultOf(400),
    ];
    for (const fault of candidates) {
      expect(classifyCapability({ fault, ...CLEAN }).capability).not.toBe("not_supported");
    }
  });
});

describe("classifyCapability -- ambiguity must never become a verdict", () => {
  // The exact regression 6.3 exists to prevent. 403 with no reason is equally
  // consistent with a malformed resource name as with a denied scope.
  it("reports provider_error for an ambiguous 403", () => {
    expect(classifyCapability({ fault: faultOf(403, "PERMISSION_DENIED"), ...CLEAN })).toEqual({
      capability: "provider_error",
      failureClass: "provider_error:403",
    });
  });

  it("reports provider_error for an ambiguous 404", () => {
    expect(classifyCapability({ fault: faultOf(404, "NOT_FOUND"), ...CLEAN })).toEqual({
      capability: "provider_error",
      failureClass: "provider_error:404",
    });
  });

  // Both of 6.2P's real defects. Each was originally reported as
  // "not supported"; each was fixed by changing one field in our own request.
  it("names our own request defect rather than blaming the provider", () => {
    expect(
      classifyCapability({
        fault: faultOf(400, "INVALID_ARGUMENT", ["INVALID_ROLLUP_QUERY_DURATION"]),
        ...CLEAN,
      }),
    ).toEqual({
      capability: "provider_error",
      failureClass: "client_request_defect:INVALID_ROLLUP_QUERY_DURATION",
    });

    expect(
      classifyCapability({
        fault: faultOf(400, "INVALID_ARGUMENT", ["INVALID_DATA_POINT_DATA_SOURCE_FAMILY"]),
        ...CLEAN,
      }).failureClass,
    ).toBe("client_request_defect:INVALID_DATA_POINT_DATA_SOURCE_FAMILY");
  });

  it("classifies 429 as rate_limited and 5xx as provider_unavailable", () => {
    expect(classifyCapability({ fault: faultOf(429, "RESOURCE_EXHAUSTED"), ...CLEAN })).toEqual({
      capability: "provider_error",
      failureClass: "rate_limited",
    });
    expect(classifyCapability({ fault: faultOf(503, "UNAVAILABLE"), ...CLEAN })).toEqual({
      capability: "provider_error",
      failureClass: "provider_unavailable",
    });
  });

  it("classifies a transport fault as transport", () => {
    expect(
      classifyCapability({ fault: sanitizeApiError(new Error("ECONNRESET")), ...CLEAN }),
    ).toEqual({ capability: "provider_error", failureClass: "transport" });
  });

  // Auth is a property of the GRANT. One expired token must never be able to
  // mark every stream on the connection as unsupported.
  it("never lets 401 become a capability verdict", () => {
    expect(classifyCapability({ fault: faultOf(401, "UNAUTHENTICATED"), ...CLEAN })).toEqual({
      capability: "provider_error",
      failureClass: "auth_unresolved",
    });
  });

  it("keeps a fault decisive even when the window happened to hold records", () => {
    // A partially-paged failure must not be laundered into a success by the
    // records the earlier pages returned.
    expect(
      classifyCapability({
        fault: faultOf(429, "RESOURCE_EXHAUSTED"),
        recordCount: 42,
        firstDataDate: "2026-08-18",
      }).capability,
    ).toBe("provider_error");
  });
});
