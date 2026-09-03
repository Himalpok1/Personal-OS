import { useEffect, useState } from "react";
import CaptureIntentModule, {
  type CaptureIntent,
} from "../../modules/capture-intent";
import { claimCaptureIntentOnce } from "./dedupe";

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
    return () => subscription.remove();
  }, []);

  return intent;
}
