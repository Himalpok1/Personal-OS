import { describe, expect, it } from "vitest";
import { canvasSyncErrorCopy } from "./sync-error-copy";

// Mirrors mail/sync-error-copy.test.ts's shape. Canvas has no closed Zod
// enum to iterate at runtime (see sync-error-copy.ts's file header for why),
// so this hardcodes the same closed vocabulary
// `packages/canvas-providers/src/canvas-client.ts` declares as
// `CanvasFailureClass`. If that union ever gains or loses a member, this
// list and `sync-error-copy.ts`'s `Record<CanvasFailureClass, string>` must
// both be updated by hand -- TypeScript enforces the second half of that
// (a missing key fails to compile), and this file's own exhaustiveness test
// below is the closest runtime analogue available without importing the
// server-side package.
const KNOWN_FAILURE_CLASSES = [
  "auth_failed",
  "rate_limited",
  "not_found",
  "provider_error",
  "network_error",
] as const;

describe("canvasSyncErrorCopy", () => {
  it("has copy for EVERY known failure class", () => {
    for (const code of KNOWN_FAILURE_CLASSES) {
      const copy = canvasSyncErrorCopy(code);
      expect(copy, `no copy for ${code}`).toBeTruthy();
      expect(copy!.length).toBeGreaterThan(10);
    }
  });

  it("never leaks the raw token into the sentence", () => {
    for (const code of KNOWN_FAILURE_CLASSES) {
      expect(canvasSyncErrorCopy(code)).not.toContain(code);
    }
  });

  it("distinguishes NO ERROR from an error it cannot name", () => {
    expect(canvasSyncErrorCopy(null)).toBeNull();
    expect(canvasSyncErrorCopy(undefined)).toBeNull();
    expect(canvasSyncErrorCopy("")).toBeNull();
    expect(canvasSyncErrorCopy("provider_error")).toBeTruthy();
  });

  it("falls back to the provider_error sentence for an unrecognised base token", () => {
    // A worker that gains a token before the app is rebuilt must still
    // render words rather than a raw string.
    expect(canvasSyncErrorCopy("some_future_token")).toBe(canvasSyncErrorCopy("provider_error"));
  });

  it("matches a qualified token on its base member", () => {
    // canvas_sync_runs.failure_class can carry a `:`-qualified token
    // (apps/worker/src/canvas/run.ts), and the qualifier is diagnostic detail
    // for a log line, never for this screen.
    expect(canvasSyncErrorCopy("provider_error:503")).toBe(canvasSyncErrorCopy("provider_error"));
    expect(canvasSyncErrorCopy("rate_limited:429")).toBe(canvasSyncErrorCopy("rate_limited"));
  });

  it("either names an action or says it retries itself", () => {
    for (const code of KNOWN_FAILURE_CLASSES) {
      const copy = canvasSyncErrorCopy(code)!;
      const actionable = /reconnect/i.test(copy);
      const selfHealing = /retry|will try|no longer exists/i.test(copy);
      expect(actionable || selfHealing, `${code}: "${copy}"`).toBe(true);
    }
  });

  it("never mentions a token, a URL, or an address", () => {
    for (const code of KNOWN_FAILURE_CLASSES) {
      const copy = canvasSyncErrorCopy(code)!;
      expect(copy).not.toContain("@");
      expect(copy).not.toContain("http");
    }
  });
});
