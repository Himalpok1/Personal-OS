import { describe, expect, it } from "vitest";
import { CanvasApiError, type CanvasFailureClass } from "./canvas-client.js";
import { classifyCanvasFault } from "./classify.js";

function apiError(status: number, code: CanvasFailureClass): CanvasApiError {
  return new CanvasApiError(status, code);
}

describe("classifyCanvasFault: CanvasApiError", () => {
  it("passes a 401 through as auth_failed, not retryable", () => {
    const fault = classifyCanvasFault(apiError(401, "auth_failed"));
    expect(fault).toEqual({ failureClass: "auth_failed", httpStatus: 401, retryable: false });
  });

  it("passes a 403-classified-as-auth_failed through unchanged (bad/insufficient token)", () => {
    const fault = classifyCanvasFault(apiError(403, "auth_failed"));
    expect(fault).toEqual({ failureClass: "auth_failed", httpStatus: 403, retryable: false });
  });

  it("passes a 403-classified-as-rate_limited through as retryable", () => {
    const fault = classifyCanvasFault(apiError(403, "rate_limited"));
    expect(fault).toEqual({ failureClass: "rate_limited", httpStatus: 403, retryable: true });
  });

  it("passes a 429 through as rate_limited, retryable", () => {
    const fault = classifyCanvasFault(apiError(429, "rate_limited"));
    expect(fault).toEqual({ failureClass: "rate_limited", httpStatus: 429, retryable: true });
  });

  it("passes a 404 through as not_found, not retryable", () => {
    const fault = classifyCanvasFault(apiError(404, "not_found"));
    expect(fault).toEqual({ failureClass: "not_found", httpStatus: 404, retryable: false });
  });

  it("marks any 5xx provider_error as retryable even though the code itself is not rate_limited", () => {
    const fault = classifyCanvasFault(apiError(503, "provider_error"));
    expect(fault).toEqual({ failureClass: "provider_error", httpStatus: 503, retryable: true });
  });

  it("marks a 4xx provider_error as not retryable", () => {
    const fault = classifyCanvasFault(apiError(418, "provider_error"));
    expect(fault).toEqual({ failureClass: "provider_error", httpStatus: 418, retryable: false });
  });

  it("never reads or exposes any property beyond httpStatus/code -- no message surfaces provider text", () => {
    const err = apiError(401, "auth_failed");
    expect(err.message).not.toMatch(/token|invalid|expired/i);
    expect(err.message).toBe("Canvas API 401 (auth_failed)");
  });
});

describe("classifyCanvasFault: non-CanvasApiError inputs", () => {
  it("classifies an AbortError as network_error, retryable", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyCanvasFault(err)).toEqual({
      failureClass: "network_error",
      httpStatus: null,
      retryable: true,
    });
  });

  it("classifies a TimeoutError (AbortSignal.timeout) as network_error, retryable", () => {
    const err = new Error("timed out");
    err.name = "TimeoutError";
    expect(classifyCanvasFault(err)).toEqual({
      failureClass: "network_error",
      httpStatus: null,
      retryable: true,
    });
  });

  it("classifies a bare network failure (DNS, TLS, socket reset) as network_error, retryable", () => {
    expect(classifyCanvasFault(new TypeError("fetch failed"))).toEqual({
      failureClass: "network_error",
      httpStatus: null,
      retryable: true,
    });
  });

  it("classifies a non-Error thrown value as network_error rather than throwing itself", () => {
    expect(classifyCanvasFault("a string was thrown")).toEqual({
      failureClass: "network_error",
      httpStatus: null,
      retryable: true,
    });
  });
});
