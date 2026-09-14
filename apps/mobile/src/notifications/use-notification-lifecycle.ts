import * as Notifications from "expo-notifications";
import { usePathname, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { isDeviceIdentityPaired } from "@/device-identity/paired-state";
import { api, queryClient } from "@/queries/client";
import { deviceTimezone } from "@/queries/today";
import { isCaptureShortcutNotification } from "./capture-shortcut-notification";
import { emitCaptureShortcutTap } from "./capture-shortcut-signal";
import { performReminderAction, type ReminderActionDeps } from "./reminder-action";
import { publishReminderActionOutcome } from "./reminder-action-signal";
import { isReminderActionIdentifier, readReminderNotificationData } from "./reminder-actions";
import { resolveNotificationRoute } from "./resolve-notification-route";
import { cancelRemindersForKey } from "./scheduler";
import { postCaptureShortcutNotification } from "./use-capture-shortcut-notification";

type MinimalRouter = Pick<ReturnType<typeof useRouter>, "canDismiss" | "dismissAll" | "navigate">;

/**
 * Every notification response this process has already acted on, keyed on
 * `${request.identifier}:${actionIdentifier}` -- NOT on the identifier
 * alone, and at MODULE scope rather than in a `useRef`.
 *
 * WHY THE PAIR. Checkpoint 9.4 gives a reminder three action buttons on top
 * of the default tap. If a "Snooze 1h" fails (the API was unreachable) the
 * notification is deliberately left in the shade, and the next thing the
 * owner does is tap "Done" on the SAME notification -- same identifier,
 * different action. An identifier-only guard (what handledIdRef was before
 * 9.4) would silently swallow that second, legitimate action.
 *
 * WHY MODULE SCOPE. A response is re-delivered to a fresh subscriber on
 * every mount (see `useNotificationLifecycle` below: the mount read of
 * getLastNotificationResponseAsync returns the same response a previous
 * mount already acted on), and the pairing gate in _layout.tsx can
 * remount the tree. A ref dies with its component; this Set does not, so
 * a remount can never re-run "complete" against the server. The set holds
 * only short identifier strings, one per interaction, for the life of the
 * process.
 *
 * RELEASED ON FAILURE. The key is added synchronously, BEFORE the action's
 * first await, so a re-delivery mid-flight (the cold read and the listener
 * both carrying one interaction) runs the action once. But a key that
 * stayed for a FAILED action would swallow the retry: the notification is
 * deliberately left in the shade after a network failure, and the next
 * thing the owner does is tap the same button again -- same identifier,
 * same action, same key. So once a failed outcome has been published the
 * key is deleted, and that tap runs the action for real. A re-delivery of
 * the failed response itself (a remount re-reading the last response)
 * would run it again too, which is acceptable: the server side of every
 * action is idempotent (contract §0), and the alternative is a button that
 * is dead for the life of the process.
 */
const handledResponseKeys = new Set<string>();

export function responseDedupeKey(response: Notifications.NotificationResponse): string {
  return `${response.notification.request.identifier}:${response.actionIdentifier}`;
}

/** Test seam only. */
export function resetHandledNotificationResponsesForTest(): void {
  handledResponseKeys.clear();
}

const REAL_DEPS: ReminderActionDeps = {
  api,
  invalidateQueries: (queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] }),
  dismissNotification: (identifier) => Notifications.dismissNotificationAsync(identifier),
  cancelRemindersForKey,
  now: () => new Date(),
  timezone: deviceTimezone,
};

/** The screen currently showing, or null when the caller cannot say. */
export type CurrentPathname = () => string | null;

const NO_PATHNAME: CurrentPathname = () => null;

function navigateTo(router: MinimalRouter, route: string, currentPathname: CurrentPathname): void {
  // Already there -- the owner was on the task when its reminder fired and
  // tapped a button (Checkpoint 9.4). dismissAll + navigate would tear that
  // screen down and mount a fresh one, and the fresh one's banner
  // subscription arrives AFTER the outcome was published and consumed by
  // the screen being torn down: the banner is lost to the remount. The
  // mounted screen already receives the outcome through its subscription,
  // so there is nothing to navigate to.
  if (currentPathname() === route) return;
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

/**
 * Pure step factored out of the hook below so it is testable with plain
 * vitest -- this codebase has no React hook/render-testing library (see
 * brief-card.test.tsx's header comment for the established precedent of
 * extracting pure logic rather than rendering). Exported for
 * use-notification-lifecycle.test.ts only.
 *
 * `response` is `null`/`undefined` when there is nothing to act on, or a
 * real response -- delivered either as the launching interaction of a cold
 * start (read once on mount) or live from the response listener.
 *
 * Returns a promise so a caller can await a reminder ACTION (which calls
 * the API); the default-tap paths complete synchronously before the
 * returned promise is even constructed, which is what keeps the existing
 * navigate-on-tap behaviour observable without awaiting.
 *
 * `deps` is injectable for tests only; production callers use the real
 * API client, query client and scheduler. `currentPathname` reports the
 * screen showing when a reminder ACTION resolves (see navigateTo); the hook
 * supplies expo-router's usePathname through a ref, tests supply a stub,
 * and the default answers "unknown", which always navigates.
 */
export function handleNotificationResponse(
  response: Notifications.NotificationResponse | null | undefined,
  router: MinimalRouter,
  deps: ReminderActionDeps = REAL_DEPS,
  currentPathname: CurrentPathname = NO_PATHNAME,
): Promise<void> {
  if (!response) return Promise.resolve();

  const dedupeKey = responseDedupeKey(response);
  if (handledResponseKeys.has(dedupeKey)) return Promise.resolve();
  handledResponseKeys.add(dedupeKey);

  const identifier = response.notification.request.identifier;
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
    // handled is now "seen" by handledResponseKeys above, so without SOME
    // repost the persistent shortcut would only ever fire once per process
    // (see capture-shortcut-notification.ts's header comment). This
    // function is a plain, non-hook export (deliberately, so it stays
    // testable with plain vitest) and so cannot call useDeviceIdentity()
    // itself to gate on pairing the way useCaptureShortcutNotification's
    // own mount/foreground path does -- isDeviceIdentityPaired() is the
    // synchronous, always-current snapshot that closes that gap: a tap
    // processed after the device has been unpaired (or while pairing state
    // is still resolving from SecureStore) must not repost a shortcut whose
    // next tap can only ever be a dead end.
    if (isDeviceIdentityPaired()) {
      void postCaptureShortcutNotification().catch((error: unknown) => {
        console.warn("Failed to rearm the capture-shortcut notification after a tap", error);
      });
    }
    return Promise.resolve();
  }

  // Checkpoint 9.4: a reminder ACTION button (Done / Snooze 1h / Tomorrow
  // 9am). Recognised by the action identifier the category registered
  // (reminder-actions.ts) AND a reminder-shaped payload -- an action
  // identifier on any other payload, or a reminder payload with the default
  // tap, falls through to plain routing below. On web nothing schedules a
  // reminder in the first place, so there is nothing to act on.
  //
  // Not gated on isDeviceIdentityPaired(), unlike the capture-shortcut
  // rearm above, and deliberately: the launching action of a COLD start is
  // read from getLastNotificationResponseAsync on mount, while the pairing
  // snapshot is still `false` because SecureStore has not resolved yet --
  // gating here would drop exactly the case the buttons exist for. The
  // calls below are Tailscale-perimeter routes needing no device token,
  // and a reminder can only have been scheduled by a paired primary device.
  const action = response.actionIdentifier;
  const reminder = readReminderNotificationData(data);
  if (Platform.OS !== "web" && reminder !== null && isReminderActionIdentifier(action)) {
    return performReminderAction({ identifier, action, data: reminder }, deps).then((outcome) => {
      // Outcome first, then navigate: the task screen mounted by the
      // navigation pulls the pending outcome on mount (reminder-action-
      // signal.ts), and a screen already showing this task receives it
      // through its subscription. Navigation happens on failure too -- the
      // owner tapped a button about THIS task, so landing on it with a
      // "couldn't … try again here" banner is the honest result.
      publishReminderActionOutcome(outcome);
      // Release the dedupe key AFTER publishing (see handledResponseKeys):
      // the retry tap must not be swallowed, and it must not race the
      // outcome it is retrying.
      if (outcome.status === "failed") handledResponseKeys.delete(dedupeKey);
      navigateTo(router, `/tasks/${reminder.taskId}`, currentPathname);
    });
  }

  const route = resolveNotificationRoute(data);
  if (route === null) return Promise.resolve();

  navigateTo(router, route, NO_PATHNAME);
  return Promise.resolve();
}

export function useNotificationLifecycle(): void {
  const router = useRouter();
  // The current route, read at the moment an action RESOLVES rather than
  // captured when the listener was registered: the owner can navigate
  // during the round trip. A ref keeps the effect below independent of
  // route changes (re-subscribing on every navigation would re-read the
  // launching response each time; handledResponseKeys absorbs that, but
  // there is no reason to provoke it).
  const pathname = usePathname();
  const pathnameRef = useRef(pathname);
  pathnameRef.current = pathname;

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

  // WHY NOT `useLastNotificationResponse` (which this hook used through
  // Checkpoint 9.3). That hook's `determineNextResponse` keeps the PREVIOUS
  // response whenever a new one carries the same `request.identifier` --
  // it was written for "which notification was tapped", where the
  // identifier is the whole story. With action buttons it is not: two
  // different actions on one reminder (a failed snooze, then Done) share
  // an identifier and differ only in `actionIdentifier`, and the hook
  // would never emit the second one. So this hook goes one layer down and
  // does the two things useLastNotificationResponse does internally,
  // minus its collapse: (1) `getLastNotificationResponseAsync()` once on
  // mount, for the response that LAUNCHED a dead process (an action button
  // with `opensAppToForeground: true` is delivered exactly like the default
  // tap here, which is the cold-start path proven on the Rabbit R1), and
  // (2) `addNotificationResponseReceivedListener` for every response while
  // the process is alive. Anything delivered twice -- the cold response
  // also arriving on the listener, or a remount re-reading it -- is
  // absorbed by handledResponseKeys, which is why that set is module-scoped.
  //
  // On web, expo-notifications has no emitter module: both calls would
  // throw UnavailabilityError (see the 9.1 header comment that used to sit
  // here). `Platform.OS` never changes for the lifetime of a running app,
  // so the early return keeps the hook-call order identical every render.
  useEffect(() => {
    if (Platform.OS === "web") return;
    let active = true;

    const currentPathname: CurrentPathname = () => pathnameRef.current;

    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      if (!active) return;
      void handleNotificationResponse(response, router, REAL_DEPS, currentPathname).catch(
        (error: unknown) => {
          console.warn("Failed to handle a notification response", error);
        },
      );
    });

    void Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        if (!active) return;
        return handleNotificationResponse(response, router, REAL_DEPS, currentPathname);
      })
      .catch((error: unknown) => {
        console.warn("Failed to read the launching notification response", error);
      });

    return () => {
      active = false;
      subscription.remove();
    };
  }, [router]);
}
