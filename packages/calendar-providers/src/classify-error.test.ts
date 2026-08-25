import { describe, expect, it } from "vitest";
import { CalDavError } from "./caldav/caldav-client.js";
import {
  classifyCalendarProviderError,
  classifyStoredCalendarSyncError,
} from "./classify-error.js";
import { GoogleCalendarApiError } from "./google-calendar-client.js";
import { GoogleOAuthError } from "./google-oauth.js";

// A stand-in for a credential. If any classifier path ever returned something
// derived from the message, this string would show up in an assertion below.
const SECRET = "ya29.SENTINEL-not-a-real-token";

describe("classifyCalendarProviderError — Google OAuth", () => {
  it("maps a dead grant to auth_expired", () => {
    const err = new GoogleOAuthError("Token has been expired or revoked.", 400, "invalid_grant");
    expect(classifyCalendarProviderError(err)).toBe("auth_expired");
  });

  it("maps invalid_client to auth_expired too — the user's action is identical", () => {
    expect(
      classifyCalendarProviderError(new GoogleOAuthError("bad client", 401, "invalid_client")),
    ).toBe("auth_expired");
  });

  it("maps invalid_scope to missing_scope", () => {
    expect(classifyCalendarProviderError(new GoogleOAuthError("nope", 400, "invalid_scope"))).toBe(
      "missing_scope",
    );
  });

  it("maps a 5xx to provider_unavailable, not to an auth problem", () => {
    expect(classifyCalendarProviderError(new GoogleOAuthError("boom", 503, undefined))).toBe(
      "provider_unavailable",
    );
  });

  it("maps 429 to rate_limited", () => {
    expect(classifyCalendarProviderError(new GoogleOAuthError("slow down", 429, undefined))).toBe(
      "rate_limited",
    );
  });
});

describe("classifyCalendarProviderError — Google Calendar API", () => {
  it("prefers the structured reason over the HTTP status", () => {
    // 403 alone would classify as missing_scope; the reason says otherwise.
    const err = new GoogleCalendarApiError("quota", 403, "rateLimitExceeded");
    expect(classifyCalendarProviderError(err)).toBe("rate_limited");
  });

  it("maps a bare 403 to missing_scope and a 401 to auth_expired", () => {
    expect(classifyCalendarProviderError(new GoogleCalendarApiError("x", 403, undefined))).toBe(
      "missing_scope",
    );
    expect(classifyCalendarProviderError(new GoogleCalendarApiError("x", 401, undefined))).toBe(
      "auth_expired",
    );
  });

  it("maps 404 and 410 to not_found", () => {
    expect(classifyCalendarProviderError(new GoogleCalendarApiError("x", 404, undefined))).toBe(
      "not_found",
    );
    expect(classifyCalendarProviderError(new GoogleCalendarApiError("x", 410, undefined))).toBe(
      "not_found",
    );
  });
});

describe("classifyCalendarProviderError — CalDAV", () => {
  it("maps a precondition conflict to conflict", () => {
    const err = new CalDavError("PUT failed", 412, "<raw body>", true);
    expect(classifyCalendarProviderError(err)).toBe("conflict");
  });

  it("maps 401 and 403 to auth_failed — CalDAV has no scope concept", () => {
    expect(classifyCalendarProviderError(new CalDavError("x", 401))).toBe("auth_failed");
    expect(classifyCalendarProviderError(new CalDavError("x", 403))).toBe("auth_failed");
  });

  it("maps a statusless discovery failure to provider_error, not to a guess", () => {
    expect(classifyCalendarProviderError(new CalDavError("Could not find calendar-home-set"))).toBe(
      "provider_error",
    );
  });
});

describe("classifyCalendarProviderError — transport and fallbacks", () => {
  it("detects a libuv transport failure through the error cause", () => {
    const err = new TypeError("fetch failed");
    (err as { cause?: unknown }).cause = { code: "ECONNREFUSED" };
    expect(classifyCalendarProviderError(err)).toBe("network_error");
  });

  it("detects an aborted request", () => {
    const err = new Error("aborted");
    err.name = "AbortError";
    expect(classifyCalendarProviderError(err)).toBe("network_error");
  });

  it("falls back to provider_error for anything unrecognised, including non-Errors", () => {
    expect(classifyCalendarProviderError(new Error("something odd"))).toBe("provider_error");
    expect(classifyCalendarProviderError("a string")).toBe("provider_error");
    expect(classifyCalendarProviderError(undefined)).toBe("provider_error");
  });
});

describe("no classifier output is derived from the message", () => {
  it("returns a bare vocabulary member even when the message carries a secret", () => {
    // Every provider class, each carrying the sentinel in its message (and, for
    // CalDAV, in the response body too). None of it may survive.
    const errors: unknown[] = [
      new GoogleOAuthError(SECRET, 400, "invalid_grant"),
      new GoogleCalendarApiError(SECRET, 403, "insufficientPermissions"),
      new CalDavError(SECRET, 500, SECRET),
      new Error(SECRET),
    ];
    for (const err of errors) {
      const code = classifyCalendarProviderError(err);
      expect(code).not.toContain("ya29");
      expect(code).not.toContain("SENTINEL");
      expect(code).toMatch(/^[a-z_]+$/);
    }
  });
});

describe("classifyStoredCalendarSyncError", () => {
  it("neutralises a legacy row that still holds provider prose", () => {
    expect(classifyStoredCalendarSyncError("Token has been expired or revoked.")).toBe(
      "provider_error",
    );
  });

  it("leaves a current code and an absent value alone", () => {
    expect(classifyStoredCalendarSyncError("auth_expired")).toBe("auth_expired");
    expect(classifyStoredCalendarSyncError(null)).toBeNull();
  });
});
