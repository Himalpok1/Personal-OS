import { CalendarSyncErrorCodeSchema } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { calendarSyncErrorCopy } from "./sync-error-copy";

describe("calendarSyncErrorCopy", () => {
  it("has copy for EVERY member of the closed vocabulary", () => {
    // The point of the enum is that adding a code without adding copy is
    // caught here rather than rendering a raw token to a user.
    for (const code of CalendarSyncErrorCodeSchema.options) {
      const copy = calendarSyncErrorCopy(code);
      expect(copy, `missing copy for ${code}`).toBeTruthy();
      expect(copy).not.toContain(code);
    }
  });

  it("renders nothing when there is no error", () => {
    expect(calendarSyncErrorCopy(null)).toBeNull();
    expect(calendarSyncErrorCopy(undefined)).toBeNull();
  });

  it("falls back to the generic sentence for a code this build predates", () => {
    // A server that gains a code before the app is rebuilt must still show
    // words, not a bare token.
    const copy = calendarSyncErrorCopy("some_future_code" as never);
    expect(copy).toBe(calendarSyncErrorCopy("provider_error"));
    expect(copy).not.toContain("some_future_code");
  });

  it("tells the user what to do, or explicitly that nothing is needed", () => {
    // Every sentence must either name an action or say it retries itself --
    // otherwise a transient failure reads as something to act on.
    for (const code of CalendarSyncErrorCodeSchema.options) {
      const copy = calendarSyncErrorCopy(code) ?? "";
      const selfHealing = /will retry|will try again|will reconcile/i;
      const actionable = /reconnect|try again|update|allow/i;
      const terminal = /no longer exists|paused|rejected/i;
      const ok = selfHealing.test(copy) || actionable.test(copy) || terminal.test(copy);
      expect(ok, `${code}: ${copy}`).toBe(true);
    }
  });
});
