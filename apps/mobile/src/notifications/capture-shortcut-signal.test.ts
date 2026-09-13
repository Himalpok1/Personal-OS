import { beforeEach, describe, expect, it } from "vitest";
import {
  emitCaptureShortcutTap,
  makeCaptureShortcutComposeIntent,
  resetCaptureShortcutSignalForTest,
  subscribeToCaptureShortcutTaps,
} from "./capture-shortcut-signal";

// No mocking needed: this module imports only a type (CaptureIntent, erased
// at compile time) and has no expo-crypto/native dependency -- see the
// file's own header comment for why.
describe("capture-shortcut pub/sub", () => {
  beforeEach(() => resetCaptureShortcutSignalForTest());

  it("notifies a subscribed listener when a tap is emitted", () => {
    let calls = 0;
    subscribeToCaptureShortcutTaps(() => {
      calls += 1;
    });

    emitCaptureShortcutTap();

    expect(calls).toBe(1);
  });

  it("notifies every subscribed listener, in subscription order", () => {
    const seen: string[] = [];
    subscribeToCaptureShortcutTaps(() => seen.push("a"));
    subscribeToCaptureShortcutTaps(() => seen.push("b"));

    emitCaptureShortcutTap();

    expect(seen).toEqual(["a", "b"]);
  });

  it("stops notifying a listener once unsubscribed", () => {
    let calls = 0;
    const unsubscribe = subscribeToCaptureShortcutTaps(() => {
      calls += 1;
    });

    unsubscribe();
    emitCaptureShortcutTap();

    expect(calls).toBe(0);
  });

  it("does nothing when emitted with no subscribers", () => {
    expect(() => emitCaptureShortcutTap()).not.toThrow();
  });

  it("wires a tap to a fresh synthetic compose intent -- exactly what use-capture-intent.ts's effect does", () => {
    // This mirrors use-capture-intent.ts's actual subscription body
    // (`subscribeToCaptureShortcutTaps(() => setIntent(makeCaptureShortcutComposeIntent()))`)
    // with `setIntent` replaced by a plain local capture, since this
    // codebase has no hook-render harness (see
    // use-notification-lifecycle.test.ts's header comment) and
    // use-capture-intent.ts itself cannot be imported under vitest --
    // it also imports the real native CaptureIntentModule at module scope.
    let received: ReturnType<typeof makeCaptureShortcutComposeIntent> | null = null;
    subscribeToCaptureShortcutTaps(() => {
      received = makeCaptureShortcutComposeIntent();
    });

    emitCaptureShortcutTap();

    expect(received).toEqual({ kind: "compose", text: "", id: expect.any(String) });
  });
});

describe("makeCaptureShortcutComposeIntent", () => {
  beforeEach(() => resetCaptureShortcutSignalForTest());

  it("always yields kind: compose with empty text -- the owner is about to type", () => {
    const intent = makeCaptureShortcutComposeIntent();
    expect(intent.kind).toBe("compose");
    expect(intent.text).toBe("");
  });

  it("yields a distinct id on every call, so QuickAddFab's [captureIntent] effect re-runs on a second tap", () => {
    const first = makeCaptureShortcutComposeIntent();
    const second = makeCaptureShortcutComposeIntent();
    expect(first.id).not.toBe(second.id);
  });
});
