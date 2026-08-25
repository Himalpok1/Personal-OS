import { describe, expect, it } from "vitest";
import { CalendarConnectionSchema } from "./calendar-connections.js";
import {
  CalendarSyncErrorCodeSchema,
  sanitizeCalendarSyncErrorCode,
} from "./calendar-sync-errors.js";

// The literal Google `error_description` this project actually observed leaking
// end to end: worker column -> GET /calendar-connections -> Settings screen.
const GOOGLE_PROSE = "Token has been expired or revoked.";

describe("sanitizeCalendarSyncErrorCode", () => {
  it("passes through every member of the closed vocabulary unchanged", () => {
    for (const code of CalendarSyncErrorCodeSchema.options) {
      expect(sanitizeCalendarSyncErrorCode(code)).toBe(code);
    }
  });

  it("collapses real Google prose to provider_error rather than passing it on", () => {
    expect(sanitizeCalendarSyncErrorCode(GOOGLE_PROSE)).toBe("provider_error");
  });

  it("collapses a raw CalDAV response body, however long", () => {
    const body = `<?xml version="1.0"?><D:error xmlns:D="DAV:"><D:message>${"x".repeat(500)}</D:message></D:error>`;
    expect(sanitizeCalendarSyncErrorCode(body)).toBe("provider_error");
  });

  it("collapses the pre-6.5 canned prose too, so legacy rows still render words", () => {
    expect(sanitizeCalendarSyncErrorCode("calendar.sync-calendar: retries exhausted")).toBe(
      "provider_error",
    );
    expect(sanitizeCalendarSyncErrorCode("no refresh token stored")).toBe("provider_error");
  });

  it("keeps absent distinct from unclassifiable", () => {
    // "no error" and "an error we cannot name" are different facts and the UI
    // renders them differently, so neither may collapse into the other.
    expect(sanitizeCalendarSyncErrorCode(null)).toBeNull();
    expect(sanitizeCalendarSyncErrorCode(undefined)).toBeNull();
    expect(sanitizeCalendarSyncErrorCode("")).toBeNull();
    expect(sanitizeCalendarSyncErrorCode("   ")).toBe("provider_error");
  });

  it("does not partially match a code embedded in prose", () => {
    // Substring matching is exactly the check that would let prose through.
    expect(sanitizeCalendarSyncErrorCode("auth_expired: Token has been revoked")).toBe(
      "provider_error",
    );
  });
});

describe("CalendarConnectionSchema.last_sync_error", () => {
  const base = {
    id: "11111111-1111-4111-8111-111111111111",
    provider: "google" as const,
    google_account_email: "someone@example.com",
    granted_scope: null,
    server_url: null,
    username: null,
    auth_type: null,
    status: "needs_reauth" as const,
    created_at: "2026-08-25T00:00:00.000Z",
    updated_at: "2026-08-25T00:00:00.000Z",
  };

  it("accepts a code and null", () => {
    expect(
      CalendarConnectionSchema.parse({ ...base, last_sync_error: "auth_expired" }),
    ).toMatchObject({ last_sync_error: "auth_expired" });
    expect(CalendarConnectionSchema.parse({ ...base, last_sync_error: null })).toMatchObject({
      last_sync_error: null,
    });
  });

  it("REJECTS provider prose at the API boundary", () => {
    // This is the structural half of the fix: even if a future change forgot
    // the sanitizer, the response would fail to serialize rather than ship the
    // vendor's words to a client.
    expect(() =>
      CalendarConnectionSchema.parse({ ...base, last_sync_error: GOOGLE_PROSE }),
    ).toThrow();
  });
});
