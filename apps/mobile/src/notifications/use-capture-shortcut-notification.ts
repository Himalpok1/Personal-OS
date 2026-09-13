import * as Notifications from "expo-notifications";
import { useCallback, useEffect } from "react";
import { AppState, Platform } from "react-native";
import { useDeviceIdentity } from "@/device-identity/provider";
import { CAPTURE_CHANNEL_ID, ensureCaptureChannel } from "./channel";
import {
  buildCaptureShortcutNotificationContent,
  isCaptureShortcutNotification,
  makeCaptureShortcutNotificationIdentifier,
} from "./capture-shortcut-notification";

/**
 * Dismisses every currently-presented notification that IS the
 * capture-shortcut affordance, recognised by its `data` marker rather than
 * by a remembered identifier -- a module-scope variable cannot know what
 * identifier a PRIOR process used (this notification is `sticky: true`
 * specifically so it survives process death), so the only reliable way to
 * find "the one(s) already showing" is to ask Android what is actually
 * presented right now and filter by content, not by memory.
 *
 * `keepIdentifier` excludes one identifier from the sweep -- used by
 * `postCaptureShortcutNotification` to avoid dismissing the instance it
 * just scheduled a moment earlier (which may already be presented by the
 * time `getPresentedNotificationsAsync` is called).
 */
async function dismissCaptureShortcutNotifications(keepIdentifier?: string): Promise<void> {
  if (Platform.OS !== "android") return;
  const presented = await Notifications.getPresentedNotificationsAsync();
  await Promise.all(
    presented
      .filter(
        (notification) =>
          notification.request.identifier !== keepIdentifier &&
          isCaptureShortcutNotification(notification.request.content.data),
      )
      .map((notification) =>
        Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {
          // Already gone (user swiped it, or a race with another dismiss) --
          // nothing left to reconcile.
        }),
      ),
  );
}

/**
 * Called when the device is not (or no longer) paired: there is no
 * composer mounted for a tap to open (QuickAddFab lives behind the
 * pairing gate in _layout.tsx), so a shortcut that could only ever be a
 * dead end must not be left showing. Exported for
 * use-capture-shortcut-notification.test.ts only.
 */
export async function clearCaptureShortcutNotification(): Promise<void> {
  await dismissCaptureShortcutNotifications();
}

/**
 * Posts (and, on every foreground AND every rearm after a tap, re-posts)
 * the persistent "tap to capture" shade notification (Checkpoint 9.1).
 *
 * Exported and called directly for testing -- this codebase has no
 * React hook/render-testing library (see quick-add-fab's sibling test
 * files / use-notification-lifecycle.ts's header comment for the
 * established "extract the pure/exported step" precedent), so the actual
 * post-vs-skip decision lives here rather than inline in the effect below.
 * Also called directly by use-notification-lifecycle.ts immediately after
 * handling a tap, to rearm a fresh, freshly-tappable instance -- see
 * capture-shortcut-notification.ts's header comment for why the identifier
 * must rotate on every call rather than stay constant, and why cleanup of
 * whatever was showing before is therefore done by CONTENT recognition
 * (dismissCaptureShortcutNotifications) rather than a remembered identifier.
 *
 * A READ-ONLY permission check, deliberately never `requestPermissionsAsync`.
 * Asking for notification permission is already owned by
 * use-push-token-registration.ts and use-reminder-reconciliation.ts, both of
 * which already run at the same boot/foreground moments this hook does.
 * Calling it a third time here would risk a redundant concurrent prompt for
 * no benefit: if permission is not yet granted, the very next foreground
 * (after one of the other two hooks has asked) posts this notification then
 * -- this hook is never the one that has to ask.
 */
export async function postCaptureShortcutNotification(): Promise<void> {
  if (Platform.OS !== "android") return;

  await ensureCaptureChannel();
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) return;

  // Schedule the fresh instance BEFORE cleaning up whatever was there
  // before, so there is never a moment with nothing in the shade.
  // `trigger: { channelId }` (not `trigger: null`) is what delivers
  // immediately AND pins the channel; see capture-shortcut-notification.ts
  // for why.
  const identifier = makeCaptureShortcutNotificationIdentifier();
  await Notifications.scheduleNotificationAsync({
    identifier,
    content: buildCaptureShortcutNotificationContent(),
    trigger: { channelId: CAPTURE_CHANNEL_ID },
  });

  await dismissCaptureShortcutNotifications(identifier);
}

/**
 * BOOT-PERSISTENCE TRADE-OFF (accepted, Checkpoint 9.1): there is
 * deliberately no BOOT_COMPLETED receiver, no foreground service, and no
 * `expo-task-manager` dependency backing this notification. It is reposted
 * only on JS mount (cold launch, while paired) and on every AppState
 * transition to "active" (covers backgrounded -> foregrounded, and
 * reopening after the owner swiped it away despite `sticky: true` normally
 * preventing that, or after a reboot). If the device reboots and the app is
 * never opened or foregrounded again, the shortcut simply will not reappear
 * until it is -- a narrower gap than it sounds, since the app already asks
 * the owner to open it via reminder/alert/digest pushes for unrelated
 * reasons. Building a boot receiver or foreground service solely to close
 * that gap was explicitly ruled out as disproportionate to the one tap it
 * would save.
 *
 * GATED ON PAIRING. `QuickAddFab` (and therefore the only thing a tap on
 * this notification can usefully open) is mounted only once
 * `useDeviceIdentity()` resolves a non-null `identity` -- see
 * apps/mobile/src/app/_layout.tsx. Posting this notification before that
 * would offer a shortcut whose tap can only ever be lost (there is nothing
 * subscribed to receive it), so this hook posts only while paired, and
 * proactively clears any already-showing instance the moment it is NOT (a
 * device that was paired, then unpaired/forgot-device'd, in this same
 * process must not keep advertising a dead shortcut).
 */
export function useCaptureShortcutNotification(): void {
  const { identity } = useDeviceIdentity();
  const isPaired = identity !== null;

  const postOrClear = useCallback(async () => {
    if (Platform.OS === "web") return;
    if (!isPaired) {
      await clearCaptureShortcutNotification();
      return;
    }
    await postCaptureShortcutNotification();
  }, [isPaired]);

  useEffect(() => {
    void postOrClear().catch((error: unknown) => {
      console.warn("Failed to post/clear the capture-shortcut notification", error);
    });

    if (Platform.OS === "web") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active") {
        void postOrClear().catch((error: unknown) => {
          console.warn("Failed to re-post/clear the capture-shortcut notification", error);
        });
      }
    });
    return () => subscription.remove();
  }, [postOrClear]);
}
