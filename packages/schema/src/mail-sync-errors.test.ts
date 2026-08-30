import { describe, expect, it } from "vitest";
import {
  MailSyncErrorCodeSchema,
  MailSyncFailureClassSchema,
  sanitizeMailSyncErrorCode,
  sanitizeMailSyncFailureClass,
} from "./mail-sync-errors.js";

describe("MailSyncErrorCode", () => {
  it("accepts every declared member", () => {
    for (const code of MailSyncErrorCodeSchema.options) {
      expect(MailSyncErrorCodeSchema.parse(code)).toBe(code);
    }
  });

  it("names cursor_expired, which has no calendar analogue", () => {
    // The reason this enum is not a copy of CalendarSyncErrorCode: calendar has
    // `conflict` (ETag precondition) and no cursor; mail has cursor expiry and
    // no ETag. Naming it keeps ADR-053's first-class transition visible instead
    // of hiding it inside provider_error.
    expect(MailSyncErrorCodeSchema.options).toContain("cursor_expired");
    expect(MailSyncErrorCodeSchema.options).not.toContain("conflict");
  });

  it("rejects a value outside the vocabulary", () => {
    expect(() => MailSyncErrorCodeSchema.parse("something_else")).toThrow();
  });

  it("rejects provider prose at the boundary rather than passing it through", () => {
    // The whole point: this is what reached the Settings screen in Phase 4 and
    // was closed in Checkpoint 6.5. Typing the wire field to this enum makes a
    // leak a parse failure.
    expect(() => MailSyncErrorCodeSchema.parse("Token has been expired or revoked.")).toThrow();
  });
});

describe("sanitizeMailSyncErrorCode", () => {
  it("passes a known code through unchanged", () => {
    expect(sanitizeMailSyncErrorCode("auth_expired")).toBe("auth_expired");
    expect(sanitizeMailSyncErrorCode("cursor_expired")).toBe("cursor_expired");
  });

  it("collapses anything unrecognised to provider_error", () => {
    expect(sanitizeMailSyncErrorCode("Token has been expired or revoked.")).toBe("provider_error");
    expect(sanitizeMailSyncErrorCode("auth_expired_but_not_really")).toBe("provider_error");
  });

  it("never partially matches or substring-searches", () => {
    // "auth_expired" is a substring of this, and it must NOT be extracted.
    expect(sanitizeMailSyncErrorCode("prefix auth_expired suffix")).toBe("provider_error");
  });

  it("keeps absent distinct from unnameable", () => {
    // "no error" and "an error we cannot name" are different facts.
    expect(sanitizeMailSyncErrorCode(null)).toBeNull();
    expect(sanitizeMailSyncErrorCode(undefined)).toBeNull();
    expect(sanitizeMailSyncErrorCode("")).toBeNull();
    expect(sanitizeMailSyncErrorCode("garbage")).toBe("provider_error");
  });
});

describe("MailSyncFailureClass", () => {
  it("accepts a bare lowercase token", () => {
    expect(MailSyncFailureClassSchema.parse("rate_limited")).toBe("rate_limited");
  });

  it("accepts one colon-separated qualifier", () => {
    expect(MailSyncFailureClassSchema.parse("provider_error:503")).toBe("provider_error:503");
    expect(MailSyncFailureClassSchema.parse("client_request_defect:INVALID_ARGUMENT")).toBe(
      "client_request_defect:INVALID_ARGUMENT",
    );
  });

  it("rejects prose, which is the entire point of the shape", () => {
    for (const prose of [
      "Token has been expired or revoked.",
      "Invalid startHistoryId 12345",
      "rate limited",
      "RateLimited",
      "Precondition check failed.",
    ]) {
      expect(() => MailSyncFailureClassSchema.parse(prose)).toThrow();
    }
  });

  it("rejects a leading digit, an uppercase lead, and a second qualifier", () => {
    expect(() => MailSyncFailureClassSchema.parse("503_error")).toThrow();
    expect(() => MailSyncFailureClassSchema.parse("Provider_error")).toThrow();
    expect(() => MailSyncFailureClassSchema.parse("a:b:c")).toThrow();
  });

  it("sanitizes a non-token to provider_error and keeps absent absent", () => {
    expect(sanitizeMailSyncFailureClass("provider_error:429")).toBe("provider_error:429");
    expect(sanitizeMailSyncFailureClass("Gmail said no")).toBe("provider_error");
    expect(sanitizeMailSyncFailureClass(null)).toBeNull();
    expect(sanitizeMailSyncFailureClass("")).toBeNull();
  });
});
