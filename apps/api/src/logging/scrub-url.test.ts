import { describe, expect, it } from "vitest";
import { scrubSensitiveQueryParams, SENSITIVE_QUERY_PARAMS } from "./scrub-url.js";

describe("scrubSensitiveQueryParams", () => {
  // Checkpoint 8.6A. `q` is the /search query string. Not a credential -- it is
  // the owner's own text -- but the request serializer emits `url` on every
  // request, so every search anyone typed was landing in the container log.
  it("destroys a /search query string but keeps the route visible", () => {
    const out = scrubSensitiveQueryParams("/search?q=insurance%20renewal&limit=20");
    expect(out).not.toContain("insurance");
    expect(out).toContain("/search");
    expect(out).toContain("q=");
    expect(out).toContain("limit=20");
  });

  it("redacts q even when it carries a LIKE wildcard", () => {
    expect(scrubSensitiveQueryParams("/search?q=%25%25")).not.toContain("%25%25");
  });

  it("names q as sensitive", () => {
    expect(SENSITIVE_QUERY_PARAMS).toContain("q");
  });

  it("destroys an OAuth authorization code", () => {
    const out = scrubSensitiveQueryParams(
      "/health-connections/google/callback?code=4/0AbCdEfGhIjKlMnOp&state=abc123",
    );
    expect(out).not.toContain("4/0AbCdEfGhIjKlMnOp");
    expect(out).not.toContain("abc123");
    expect(out).toBe("/health-connections/google/callback?code=[redacted]&state=[redacted]");
  });

  // The log must still show that a callback was hit -- only the value dies.
  it("keeps the parameter name and the path", () => {
    const out = scrubSensitiveQueryParams("/health-connections/google/callback?code=secret");
    expect(out).toContain("/health-connections/google/callback");
    expect(out).toContain("code=");
  });

  it("leaves non-sensitive parameters untouched", () => {
    expect(scrubSensitiveQueryParams("/today?tz=America/Chicago")).toBe(
      "/today?tz=America/Chicago",
    );
  });

  it("scrubs only the sensitive parameter in a mixed query", () => {
    const out = scrubSensitiveQueryParams("/x?tz=UTC&code=abc&limit=50");
    expect(out).toBe("/x?tz=UTC&code=[redacted]&limit=50");
  });

  it("passes through a URL with no query string", () => {
    expect(scrubSensitiveQueryParams("/health")).toBe("/health");
    expect(scrubSensitiveQueryParams("/health?")).toBe("/health?");
  });

  // A code containing & or = must not let part of itself survive into the log.
  it("does not leak a value containing separator characters", () => {
    const out = scrubSensitiveQueryParams("/cb?code=a%3Db%26c=d&tz=UTC");
    expect(out).not.toContain("a%3Db");
    expect(out).toContain("tz=UTC");
  });

  it("scrubs a repeated parameter every time it appears", () => {
    const out = scrubSensitiveQueryParams("/cb?code=one&code=two");
    expect(out).not.toContain("one");
    expect(out).not.toContain("two");
  });

  it("scrubs a parameter with an empty value without throwing", () => {
    expect(scrubSensitiveQueryParams("/cb?code=")).toBe("/cb?code=[redacted]");
  });

  it("scrubs a valueless parameter", () => {
    expect(scrubSensitiveQueryParams("/cb?code")).toBe("/cb?code=[redacted]");
  });

  // A malformed percent-escape must never throw inside the logger -- that would
  // turn a log line into a 500.
  it("survives a malformed percent-escape in a parameter name", () => {
    expect(() => scrubSensitiveQueryParams("/cb?%E0%A4%A=1&code=secret")).not.toThrow();
    expect(scrubSensitiveQueryParams("/cb?%E0%A4%A=1&code=secret")).not.toContain("secret");
  });

  it("matches a percent-encoded parameter name", () => {
    expect(scrubSensitiveQueryParams("/cb?%63ode=secret")).not.toContain("secret");
  });

  // REVERSED AT CHECKPOINT 8.6A. This previously pinned exactly
  // ["access_token", "code", "state"]. `q` (the /search query string) was added
  // because Fastify's request serializer emits `url` on every request, so the
  // owner's own search text was being written to the container log verbatim.
  // The set-equality assertion is kept rather than loosened: it is what makes
  // an accidental ADDITION or REMOVAL fail here instead of silently changing
  // what gets redacted in production.
  it("covers exactly code, state, access_token and q", () => {
    expect([...SENSITIVE_QUERY_PARAMS].sort()).toEqual(["access_token", "code", "q", "state"]);
  });
});
