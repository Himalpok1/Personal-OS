import * as Notifications from "expo-notifications";
import { useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { isDeviceIdentityPaired } from "@/device-identity/paired-state";
import { isCaptureShortcutNotification } from "./capture-shortcut-notification";
import { emitCaptureShortcutTap } from "./capture-shortcut-signal";
import { postCaptureShortcutNotification } from "./use-capture-shortcut-notification";
import { resolveNotificationRoute } from "./resolve-notification-route";

type MinimalRouter = Pick<ReturnType<typeof useRouter>, "canDismiss" | "dismissAll" | "navigate">;

// expo-notifications has no `.web.ts` override for its native emitter module
// (confirmed by reading node_modules/expo-notifications/src/ -- only
// BadgeModule.web.ts/ServerRegistrationModule.web.ts/getDevicePushTokenAsync.web.ts
// exist). On web it falls back to NotificationsEmitterModule.ts, whose
// `getLastNotificationResponse` property is simply absent -- and
// NotificationsEmitter.ts's `getLastNotificationResponse()` throws
// `UnavailabilityError` when that property is missing. Notifications.
// `useLastNotificationResponse()` calls exactly that inside a
// `useLayoutEffect` on mount, so it cannot be invoked on web at all, not
// even once. `Platform.OS` never changes for the lifetime of a running app,
// so selecting *which function* to call here (rather than branching at the
// call site itself, which would violate react-hooks/rules-of-hooks) keeps
// every render's hook-call order identical while still never reaching the
// throwing path on web.
const useLastNotificationResponseForPlatform: () =>
  Notifications.NotificationResponse | null | undefined =
  Platform.OS === "web" ? () => null : Notifications.useLastNotificationResponse;

/**
 * Pure step factored out of the hook below so it is testable with plain
 * vitest -- this codebase has no React hook/render-testing library (see
 * brief-card.test.tsx's header comment for the established precedent of
 * extracting pure logic rather than rendering). Exported for
 * use-notification-lifecycle.test.ts only.
 *
 * `response` mirrors `useLastNotificationResponse`'s tri-state return:
 * `undefined` ("not sure yet"), `null` ("none received"), or a real
 * response -- per the SDK 57 docs, that hook itself already covers both a
 * cold launch (it calls `getLastNotificationResponse()` on mount, "in case
 * it was set earlier, even in native code on startup") and a warm tap (it
 * also subscribes via `addNotificationResponseReceivedListener`
 * internally), so this hook no longer needs its own listener subscription.
 *
 * `handledIdRef` is a plain mutable box (not React's `useRef` -- no hook
 * call needed here) holding the notification-request identifier of the
 * most recently acted-on response. `useLastNotificationResponse` already
 * dedupes its own *emitted value* by identifier (see its
 * `determineNextResponse`), but nothing upstream stops the *effect that
 * consumes it* from re-running for the same value (a re-render, a
 * `router` identity change, etc.) -- this ref is what makes "act on a given
 * response exactly once" hold at this layer specifically. A genuinely new
 * tap carries a different identifier and is still routed.
 */
export function handleNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
  router: MinimalRouter,
  handledIdRef: { current: string | null },
): void {
  if (!response) return;

  const identifier = response.notification.request.identifier;
  if (handledIdRef.current === identifier) return;
  handledIdRef.current = identifier;

  const data = response.notification.request.content.data;

  // The capture-shortcut notification (Checkpoint 9.1) has no destination
  // for resolveNotificationRoute to resolve -- the composer is a global
  // Modal, not a route (see plugins/withCaptureShortcut.ts) -- so it must be
  // recognised and handled BEFORE resolveNotificationRoute ever sees the
  // payload, not routed through it. A tap here opens the same composer a
  // `kind: "compose"` CaptureIntent already does, via
  // useCaptureIntent()/capture-shortcut-signal.ts, never a router.navigate.
  if (isCaptureShortcutNotification(data)) {
    emitCaptureShortcutTap();
    // REARM immediately -- but only while still paired. The identifier just
    // handled is now "seen" by both useLastNotificationResponse's own
    // dedupe and handledIdRef above, so without SOME repost the persistent
    // shortcut would only ever fire once per process (see
    // capture-shortcut-notification.ts's header comment). This function is
    // a plain, non-hook export (deliberately, so it stays testable with
    // plain vitest) and so cannot call useDeviceIdentity() itself to gate
    // on pairing the way useCaptureShortcutNotification's own mount/
    // foreground path does -- isDeviceIdentityPaired() is the synchronous,
    // always-current snapshot that closes that gap: a tap processed after
    // the device has been unpaired (or while pairing state is still
    // resolving from SecureStore) must not repost a shortcut whose next tap
    // can only ever be a dead end.
    if (isDeviceIdentityPaired()) {
      void postCaptureShortcutNotification().catch((error: unknown) => {
        console.warn("Failed to rearm the capture-shortcut notification after a tap", error);
      });
    }
    return;
  }

  const route = resolveNotificationRoute(data);
  if (route === null) return;

  // A pushed screen (Settings, a task detail) sits on top of the root
  // stack. Navigating straight to a tab route switches the tab
  // underneath it, so the tap appears to do nothing -- dismiss back to
  // the root first, then navigate.
  if (router.canDismiss()) router.dismissAll();
  // `as Href` for the same reason HEALTH_ROUTE carries it: expo-router's route
  // union lives in `.expo/types/router.d.ts`, which is GENERATED and gitignored,
  // so a route added in the same changeset as its first caller is absent from
  // the union until Metro next runs. `/monitor` is declared in AppStack and the
  // generator emits it once it runs; this is a transitional guard for a
  // contributor whose .expo cache predates this changeset, not a permanent gap.
  router.navigate(route as Href);
}

export function useNotificationLifecycle(): void {
  const router = useRouter();
  const handledIdRef = useRef<string | null>(null);
  const lastNotificationResponse = useLastNotificationResponseForPlatform();

  useEffect(() => {
    if (Platform.OS === "web") return;

    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }, []);

  useEffect(() => {
    if (Platform.OS === "web") return;
    handleNotificationResponse(lastNotificationResponse, router, handledIdRef);
  }, [lastNotificationResponse, router]);
}
