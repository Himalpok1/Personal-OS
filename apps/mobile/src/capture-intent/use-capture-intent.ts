import { useEffect, useState } from "react";
import CaptureIntentModule, { type CaptureIntent } from "../../modules/capture-intent";
import { claimCaptureIntentOnce } from "./dedupe";
import {
  makeCaptureShortcutComposeIntent,
  subscribeToCaptureShortcutTaps,
} from "../notifications/capture-shortcut-signal";

/**
 * Yields each Android capture launch (share sheet or launcher shortcut)
 * exactly once.
 *
 * BOTH paths are required and neither is sufficient alone, because
 * MainActivity is `launchMode="singleTask"`:
 *
 *  - Cold start: the intent is the launch intent, but JS is not attached when
 *    onCreate runs, so no listener exists. Recovered by the getter, which is
 *    a CONSUME on the native side -- it clears the sticky intent too.
 *  - Warm start: onNewIntent fires and onCreate does not. Delivered by the
 *    event.
 *
 * The event is an optimisation; the native pending slot is the source of
 * truth. An intent arriving while this hook is unmounted (during pairing,
 * say) is held natively and picked up by the getter when it finally mounts.
 *
 * A THIRD source, added at Checkpoint 9.1, is not native at all: a tap on
 * the persistent notification-shade capture affordance. That is a
 * NotificationResponse observed in use-notification-lifecycle.ts, not an
 * Android Intent, so it cannot go through CaptureIntentModule or
 * dedupe.ts's consume-once contract (there is no sticky-redelivery hazard
 * to guard against here). It arrives instead over the small module-scope
 * pub/sub in capture-shortcut-signal.ts, which synthesizes the identical
 * `kind: "compose"` shape QuickAddFab already knows how to open on.
 */
export function useCaptureIntent(): CaptureIntent | null {
  const [intent, setIntent] = useState<CaptureIntent | null>(null);

  useEffect(() => {
    const pending = claimCaptureIntentOnce(CaptureIntentModule.consumePendingCaptureIntent());
    if (pending) setIntent(pending);

    const subscription = CaptureIntentModule.addListener("onCaptureIntent", (payload) => {
      const fresh = claimCaptureIntentOnce(payload);
      if (fresh) setIntent(fresh);
    });

    const unsubscribe = subscribeToCaptureShortcutTaps(() => {
      setIntent(makeCaptureShortcutComposeIntent());
    });

    return () => {
      subscription.remove();
      unsubscribe();
    };
  }, []);

  return intent;
}
