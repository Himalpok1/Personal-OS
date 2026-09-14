import { useEffect, useState } from "react";

/** The settle time the search box waits before a keystroke becomes a request. */
export const SEARCH_DEBOUNCE_MS = 250;

/**
 * Returns `value` once it has stopped changing for `delayMs`.
 *
 * Checkpoint 8.3 recorded that the search screen issued one request per
 * keystroke -- typing a six-character query produced five `/search` calls.
 * Harmless at 18-35 ms a response, but 9.6's tokenised, scored search does
 * more work per call and every one of those intermediate requests answered a
 * question the user had already stopped asking. Settling on the trailing
 * edge means a request is sent for the query the user paused on, and only
 * that one.
 *
 * The first render returns `value` immediately rather than waiting a full
 * delay for an initial empty string, so a screen that mounts with a query
 * already in hand (a future deep link) is not blank for 250 ms.
 *
 * Cleanup clears the pending timer, so an unmount mid-typing never sets state
 * on a gone component and a value that changes again before the delay simply
 * restarts the clock.
 */
export function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);

  return debounced;
}
