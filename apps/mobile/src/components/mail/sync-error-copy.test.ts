import { MailSyncErrorCodeSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { mailSyncErrorCopy } from "./sync-error-copy";

// Mirrors calendar/sync-error-copy.test.ts exactly. The value of this shape is
// that it fails when a NEW code is added to the enum without words to go with
// it -- otherwise the app would render a bare token like `cursor_expired` at the
// user, which is what the closed enum was introduced to prevent.

describe("mailSyncErrorCopy", () => {
  it("has copy for EVERY member of the closed enum", () => {
    for (const code of MailSyncErrorCodeSchema.options) {
      const copy = mailSyncErrorCopy(code);
      expect(copy, `no copy for ${code}`).toBeTruthy();
      expect(copy!.length).toBeGreaterThan(10);
    }
  });

  it("never leaks the raw code into the sentence", () => {
    // A bare token on screen is the failure mode. `cursor_expired` is the one
    // most likely to slip through, because it reads almost like English.
    for (const code of MailSyncErrorCodeSchema.options) {
      expect(mailSyncErrorCopy(code)).not.toContain(code);
    }
  });

  it("distinguishes NO ERROR from an error it cannot name", () => {
    // `sanitizeMailSyncErrorCode` makes the same three-way distinction on the
    // server; collapsing null and provider_error here would throw it away at the
    // last step.
    expect(mailSyncErrorCopy(null)).toBeNull();
    expect(mailSyncErrorCopy(undefined)).toBeNull();
    expect(mailSyncErrorCopy("provider_error")).toBeTruthy();
  });

  it("falls back to the provider_error sentence for an unknown code", () => {
    // A server that gains a code before the app is rebuilt must still render
    // words rather than a raw token.
    const unknown = "some_future_code" as never;
    expect(mailSyncErrorCopy(unknown)).toBe(mailSyncErrorCopy("provider_error"));
  });

  it("either names an action or says it retries itself", () => {
    // Without this, a transient failure reads as a chore the user must do
    // something about.
    for (const code of MailSyncErrorCodeSchema.options) {
      const copy = mailSyncErrorCopy(code)!;
      const actionable = /reconnect|allow|try again|catching up/i.test(copy);
      const selfHealing = /retry|will try|paused|no longer exists|rejected/i.test(copy);
      expect(actionable || selfHealing, `${code}: "${copy}"`).toBe(true);
    }
  });

  it("says cursor expiry SELF-HEALS rather than asking for a reconnect", () => {
    // Recovery is automatic and bounded (ADR-053). Telling the user to reconnect
    // would be false, and would not help.
    const copy = mailSyncErrorCopy("cursor_expired")!;
    expect(copy).not.toMatch(/reconnect/i);
    expect(copy).toMatch(/catching up/i);
  });

  it("never mentions a token, a URL or an address", () => {
    for (const code of MailSyncErrorCodeSchema.options) {
      const copy = mailSyncErrorCopy(code)!;
      expect(copy).not.toContain("@");
      expect(copy).not.toContain("http");
    }
  });
});
