import { useRef, useState } from "react";

/**
 * Single-flight guard for a button whose onPress is a raw async function.
 *
 * Every TanStack-mutation-backed button in this app binds `disabled` to
 * `isPending`; the Settings diagnostics buttons call raw async functions
 * (flushOutbox, registerForPushNotifications, scheduleNotificationAsync)
 * with no mutation object, so nothing supplied a pending flag and repeated
 * taps fired the action concurrently (6.7A, finding AY11). This hook is that
 * missing flag.
 *
 * The re-entry check is a ref, not the state value: two taps landing before
 * React applies the state update would both see `busy === false`, so the
 * synchronous ref is the actual guard and the state exists only to drive
 * `disabled` styling. Rejections release the guard and are swallowed --
 * every caller already reports its own failure into its result line.
 */
export function useBusyPress(action: () => Promise<void>): {
  busy: boolean;
  onPress: () => void;
} {
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);

  const onPress = (): void => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    void action()
      .catch(() => undefined)
      .finally(() => {
        inFlight.current = false;
        setBusy(false);
      });
  };

  return { busy, onPress };
}
