/**
 * A synchronous, always-current snapshot of "is a device identity currently
 * stored" -- for the rare call site that needs to check pairing state
 * OUTSIDE a React render and cannot call `useDeviceIdentity()` itself.
 *
 * Checkpoint 9.1: `use-notification-lifecycle.ts`'s capture-shortcut rearm
 * (see its own header comment) calls `postCaptureShortcutNotification()`
 * directly from `handleNotificationResponse`, a plain, non-hook, exported
 * function -- deliberately so it stays testable with plain vitest, matching
 * this file's own established "extract the pure/exported step" convention.
 * That rearm call has no way to read `useDeviceIdentity()`, so without this
 * it would repost the shortcut unconditionally on every tap, including a
 * tap handled after the device becomes unpaired mid-session -- reopening
 * the exact pre-pairing dead-end `useCaptureShortcutNotification`'s own
 * gate (device-identity aware, mount + AppState-driven) otherwise closes.
 *
 * `DeviceIdentityProvider` is the only writer, kept in lockstep with its own
 * `identity` state via a `useEffect`. Nothing else may call `setDeviceIdentityPaired`.
 */
let paired = false;

export function setDeviceIdentityPaired(value: boolean): void {
  paired = value;
}

export function isDeviceIdentityPaired(): boolean {
  return paired;
}
