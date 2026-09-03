import { beforeEach, describe, expect, it } from "vitest";
import type { CaptureIntent } from "../../modules/capture-intent/src/CaptureIntent.types";
import { claimCaptureIntentOnce, resetClaimedCaptureIntentsForTest } from "./dedupe";

const share = (id: string, text = "shared"): CaptureIntent => ({ kind: "share", text, id });

// Checkpoint 8.4 Lane 1. The native id is stable per intent, and this is the
// only thing standing between one Android share and two Inbox rows.
describe("claimCaptureIntentOnce", () => {
  beforeEach(() => resetClaimedCaptureIntentsForTest());

  it("yields an intent the first time and never again", () => {
    const intent = share("intent-1");
    expect(claimCaptureIntentOnce(intent)).toEqual(intent);
    expect(claimCaptureIntentOnce(intent)).toBeNull();
    expect(claimCaptureIntentOnce(intent)).toBeNull();
  });

  it("collapses the cold-start getter and the warm-start event for one intent", () => {
    // Both paths report the SAME native id -- that is the whole design.
    expect(claimCaptureIntentOnce(share("intent-1"))).not.toBeNull();
    expect(claimCaptureIntentOnce(share("intent-1"))).toBeNull();
  });

  it("survives an Activity recreation, because the set is module scope", () => {
    // Process death then restore from Recents: Android re-delivers the sticky
    // launch intent verbatim, with the same native id. Component state would
    // be gone by here; this must not be.
    expect(claimCaptureIntentOnce(share("sticky"))).not.toBeNull();
    expect(claimCaptureIntentOnce(share("sticky"))).toBeNull();
  });

  it("still yields genuinely distinct shares, even with identical text", () => {
    expect(claimCaptureIntentOnce(share("a", "same text"))).not.toBeNull();
    expect(claimCaptureIntentOnce(share("b", "same text"))).not.toBeNull();
  });

  it("tolerates null (no pending intent) without claiming anything", () => {
    expect(claimCaptureIntentOnce(null)).toBeNull();
    expect(claimCaptureIntentOnce(share("after-null"))).not.toBeNull();
  });

  it("dedupes a compose shortcut the same way", () => {
    const compose: CaptureIntent = { kind: "compose", text: "", id: "shortcut-1" };
    expect(claimCaptureIntentOnce(compose)).toEqual(compose);
    expect(claimCaptureIntentOnce(compose)).toBeNull();
  });
});
