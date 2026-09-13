import { beforeEach, describe, expect, it } from "vitest";
import {
  buildCaptureShortcutNotificationContent,
  isCaptureShortcutNotification,
  makeCaptureShortcutNotificationIdentifier,
  resetCaptureShortcutNotificationIdentifierForTest,
} from "./capture-shortcut-notification";

// Zero runtime import of expo-notifications (the one above is `import
// type`, erased at compile time) -- same "pure, zero native import"
// philosophy as resolve-notification-route.ts, so this needs no mocking at
// all.
describe("isCaptureShortcutNotification", () => {
  it("recognises the capture-shortcut payload", () => {
    expect(isCaptureShortcutNotification({ captureShortcut: true })).toBe(true);
  });

  it("rejects a payload where the flag is present but not true", () => {
    expect(isCaptureShortcutNotification({ captureShortcut: false })).toBe(false);
    expect(isCaptureShortcutNotification({ captureShortcut: "true" })).toBe(false);
    expect(isCaptureShortcutNotification({ captureShortcut: 1 })).toBe(false);
  });

  it("returns false for every existing notification payload shape, unaffected", () => {
    expect(isCaptureShortcutNotification({ taskId: "abc" })).toBe(false);
    expect(isCaptureShortcutNotification({ inboxId: "def" })).toBe(false);
    expect(isCaptureShortcutNotification({ monitorIncidentId: "ghi" })).toBe(false);
    expect(isCaptureShortcutNotification({ mailDigestDate: "2026-09-01" })).toBe(false);
  });

  it("returns false for null, undefined, and non-object payloads", () => {
    expect(isCaptureShortcutNotification(null)).toBe(false);
    expect(isCaptureShortcutNotification(undefined)).toBe(false);
    expect(isCaptureShortcutNotification("captureShortcut")).toBe(false);
    expect(isCaptureShortcutNotification(42)).toBe(false);
  });

  it("returns false for an empty object", () => {
    expect(isCaptureShortcutNotification({})).toBe(false);
  });
});

describe("buildCaptureShortcutNotificationContent", () => {
  it("is entirely static -- no parameter exists to smuggle captured text through", () => {
    expect(buildCaptureShortcutNotificationContent()).toEqual({
      title: "Capture",
      body: "Tap to add a note, task, or reminder.",
      sticky: true,
      autoDismiss: false,
      data: { captureShortcut: true },
    });
  });

  it("marks itself recognisable by isCaptureShortcutNotification", () => {
    const content = buildCaptureShortcutNotificationContent();
    expect(isCaptureShortcutNotification(content.data)).toBe(true);
  });

});

describe("makeCaptureShortcutNotificationIdentifier", () => {
  beforeEach(() => {
    resetCaptureShortcutNotificationIdentifierForTest();
  });

  it("returns a fresh, non-empty identifier on every call -- never a reused constant", () => {
    // A single reused identifier is exactly the bug this replaced: both
    // expo-notifications' own useLastNotificationResponse and
    // use-notification-lifecycle.ts's handledIdRef dedupe by identifier, so
    // a persistent notification that always posts under the same one can
    // only ever be tapped once per process. See this module's header
    // comment.
    const first = makeCaptureShortcutNotificationIdentifier();
    const second = makeCaptureShortcutNotificationIdentifier();
    expect(first).not.toBe(second);
    expect(first.length).toBeGreaterThan(0);
    expect(second.length).toBeGreaterThan(0);
  });

  it("still identifies itself as the capture-shortcut prefix, for debuggability only", () => {
    expect(makeCaptureShortcutNotificationIdentifier()).toMatch(/^capture-shortcut-/);
  });
});
