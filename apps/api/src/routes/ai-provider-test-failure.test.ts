import { describe, expect, it } from "vitest";
import { classifyAiProviderTestFailure } from "./ai-provider-test-failure.js";

// The value this classifier exists to keep off the wire: a vendor SDK error
// whose message quotes back the request it just made, key and all.
const VENDOR_PROSE =
  "Incorrect API key provided: sk-SENTINEL-not-a-real-key. You can find your API key at https://example.test/keys";

function withStatus(status: number, message = VENDOR_PROSE): Error {
  return Object.assign(new Error(message), { statusCode: status });
}

describe("classifyAiProviderTestFailure", () => {
  it("maps a rejected key to invalid_credentials", () => {
    expect(classifyAiProviderTestFailure(withStatus(401))).toBe("invalid_credentials");
    expect(classifyAiProviderTestFailure(withStatus(403))).toBe("invalid_credentials");
  });

  it("maps a 404 to model_not_found — the likeliest cause on this route", () => {
    expect(classifyAiProviderTestFailure(withStatus(404))).toBe("model_not_found");
  });

  it("maps 429 and 5xx apart, because the user's response differs", () => {
    expect(classifyAiProviderTestFailure(withStatus(429))).toBe("rate_limited");
    expect(classifyAiProviderTestFailure(withStatus(500))).toBe("provider_unavailable");
    expect(classifyAiProviderTestFailure(withStatus(503))).toBe("provider_unavailable");
  });

  it("reads `status` as well as `statusCode` — SDKs disagree on the name", () => {
    expect(classifyAiProviderTestFailure(Object.assign(new Error("x"), { status: 401 }))).toBe(
      "invalid_credentials",
    );
  });

  it("recognises our own pre-flight failure", () => {
    const err = new Error("no provider configured");
    err.name = "NoProviderConfiguredError";
    expect(classifyAiProviderTestFailure(err)).toBe("not_configured");
  });

  it("detects a transport failure through the error cause", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "ENOTFOUND" };
    expect(classifyAiProviderTestFailure(err)).toBe("network_error");
  });

  it("falls back to provider_error for anything unrecognised", () => {
    expect(classifyAiProviderTestFailure(new Error(VENDOR_PROSE))).toBe("provider_error");
    expect(classifyAiProviderTestFailure("a string")).toBe("provider_error");
    expect(classifyAiProviderTestFailure(undefined)).toBe("provider_error");
  });

  it("never returns anything derived from the vendor's message", () => {
    for (const err of [
      withStatus(401),
      withStatus(500),
      new Error(VENDOR_PROSE),
      Object.assign(new Error(VENDOR_PROSE), { status: 429 }),
    ]) {
      const out = classifyAiProviderTestFailure(err);
      expect(out).not.toContain("sk-");
      expect(out).not.toContain("SENTINEL");
      expect(out).not.toContain("example.test");
      expect(out).toMatch(/^[a-z_]+$/);
    }
  });
});
