import type { CaptureIntent } from "../../modules/capture-intent/src/CaptureIntent.types";

/**
 * Ids of capture intents already handed to the app.
 *
 * MODULE SCOPE, deliberately, not component state. The hazard this guards is
 * a REMOUNT, and state living in a component dies at exactly the moment it is
 * needed. Three remounts are real here:
 *
 *  - Activity recreation after process death, then restore from Recents. The
 *    launching intent is STICKY and Android re-delivers it.
 *  - This app's own identity gate transitioning Loading -> Pairing ->
 *    Production, which remounts the subtree QuickAddFab lives in.
 *  - The cold-start getter and the warm-start event both reporting the same
 *    intent.
 *
 * The native id is stable per intent across both delivery paths, which is
 * what makes collapsing them possible at all.
 */
const claimedIntentIds = new Set<string>();

/** Returns the intent the first time its id is seen, and null every time after. */
export function claimCaptureIntentOnce(intent: CaptureIntent | null): CaptureIntent | null {
  if (!intent) return null;
  if (claimedIntentIds.has(intent.id)) return null;
  claimedIntentIds.add(intent.id);
  return intent;
}

/** Test seam only -- the production set is deliberately never cleared. */
export function resetClaimedCaptureIntentsForTest(): void {
  claimedIntentIds.clear();
}
