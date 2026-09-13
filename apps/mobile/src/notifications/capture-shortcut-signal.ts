import type { CaptureIntent } from "../../modules/capture-intent/src/CaptureIntent.types";

/**
 * The wire between "a tap on the persistent notification-shade capture
 * affordance happened" (observed in use-notification-lifecycle.ts, which
 * already owns all NotificationResponse handling) and "synthesize a
 * compose intent" (consumed in use-capture-intent.ts, which already owns
 * everything QuickAddFab reads) -- Checkpoint 9.1.
 *
 * WHY A SEPARATE SIGNAL RATHER THAN A THIRD CaptureIntent SOURCE INSIDE THE
 * NATIVE MODULE. A tap on this notification is not a native CaptureIntent at
 * all -- no Android Intent is involved, only a NotificationResponse -- so it
 * cannot go through CaptureIntentModule/dedupe.ts's consume-once contract,
 * which exists specifically to survive a STICKY launch Intent being
 * re-delivered by Android. There is no equivalent replay hazard here: a
 * notification tap fires the response listener exactly once per tap, so
 * this module needs no dedupe of its own.
 *
 * WHY MODULE SCOPE, not shared React state. The emitting side
 * (use-notification-lifecycle.ts) and the consuming side
 * (use-capture-intent.ts) are mounted in different components with no
 * common parent to hold shared state, and a tap that woke the app from cold
 * (delivered as `useLastNotificationResponse`'s initial value) can be
 * observed before QuickAddFab -- and therefore useCaptureIntent -- has
 * mounted even once. Same reasoning as dedupe.ts's module-scope claimed-id
 * set.
 *
 * NO expo-crypto IMPORT for the synthesized intent's `id`. Unlike a share
 * (where quick-add-fab.tsx reads `captureIntent.id` as the capture's
 * `client_uuid`), nothing anywhere reads `.id` for a `kind: "compose"`
 * intent -- QuickAddFab's effect branches on `kind` alone, and its own
 * `submit()` mints a fresh `randomUUID()` for the actual `client_uuid`
 * regardless of where the draft came from. The only property `.id` needs
 * here is to make each synthesized intent a NEW object, so a second tap's
 * object reference differs from the first and QuickAddFab's
 * `useEffect(..., [captureIntent])` re-runs. A monotonic counter gives that
 * with no native dependency, which is what keeps this module importable
 * under plain vitest with zero mocking.
 */
type Listener = () => void;

const listeners = new Set<Listener>();
let syntheticIntentCounter = 0;

/**
 * A tap that arrives while nothing is subscribed yet is BUFFERED, not
 * dropped. This closes a real cold-launch loss: on a true cold start,
 * `useLastNotificationResponse` can deliver the launching tap (via a
 * synchronous `useLayoutEffect`) before `QuickAddFab` -- and therefore
 * useCaptureIntent's subscription -- has mounted at all, since it lives
 * behind the pairing/loading gate in _layout.tsx and pairing state loads
 * asynchronously from SecureStore. Without buffering, that tap is emitted
 * into an empty listener set and is gone forever. This mirrors the
 * PENDING-SLOT pattern the native CaptureIntentModule already uses for the
 * identical shape of problem (see its own header comment: "the pending slot
 * is the source of truth, the event is an optimisation") -- only one tap can
 * usefully be pending at a time (there is nothing to compose yet), so a
 * boolean is enough, unlike the native module's richer payload.
 */
let pendingTap = false;

/** The CaptureIntent shape a notification-shade tap synthesizes. */
export function makeCaptureShortcutComposeIntent(): CaptureIntent {
  syntheticIntentCounter += 1;
  return { kind: "compose", text: "", id: `capture-shortcut-${syntheticIntentCounter}` };
}

/** Called by use-notification-lifecycle.ts's `handleNotificationResponse`
 * when the tapped notification is the capture-shortcut one, in place of a
 * route navigation. */
export function emitCaptureShortcutTap(): void {
  if (listeners.size === 0) {
    pendingTap = true;
    return;
  }
  for (const listener of listeners) listener();
}

/**
 * Called by use-capture-intent.ts. Returns an unsubscribe function.
 * Consumes (and clears) a buffered tap immediately on subscribe -- a
 * pull, exactly like the native module's `consumePendingCaptureIntent`,
 * so a tap that arrived before this subscriber existed is not lost.
 */
export function subscribeToCaptureShortcutTaps(listener: Listener): () => void {
  listeners.add(listener);
  if (pendingTap) {
    pendingTap = false;
    listener();
  }
  return () => listeners.delete(listener);
}

/** Test seam only. */
export function resetCaptureShortcutSignalForTest(): void {
  listeners.clear();
  syntheticIntentCounter = 0;
  pendingTap = false;
}
