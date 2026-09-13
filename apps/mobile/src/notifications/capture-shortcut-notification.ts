import type * as Notifications from "expo-notifications";

/**
 * Notification-shade capture (Checkpoint 9.1). One persistent, ongoing
 * local notification that opens the existing Quick Capture composer --
 * pull the shade down, tap it, type. Nothing here is sent through the
 * server-side notification router (notification_dispatch_log): it is a
 * purely on-device affordance, posted and re-posted by
 * use-capture-shortcut-notification.ts.
 *
 * NO NEW NATIVE CODE, verified against the real v57.0.0 docs
 * (https://docs.expo.dev/versions/v57.0.0/sdk/notifications/) and the
 * installed source rather than assumed from type comments:
 *
 *  - `NotificationContentInput.sticky` -- "the notification cannot be
 *    dismissed by swipe... Corresponds directly to Android's `isOngoing`
 *    behavior. In Firebase terms this property is called `sticky`" -- and
 *    `.autoDismiss` -- "will not be automatically dismissed when clicked...
 *    Corresponds to Android's `setAutoCancel`" -- are exactly Android's
 *    "ongoing" notification, already exposed as plain content fields
 *    (Notifications.types.ts, both Android-only).
 *  - Re-posting with the SAME `identifier` REPLACES rather than duplicates.
 *    This is not merely assumed: the native side
 *    (ExpoPresentationDelegate.kt) calls
 *    `NotificationManagerCompat.notify(request.identifier, ANDROID_NOTIFICATION_ID, ...)`
 *    where `ANDROID_NOTIFICATION_ID` is the constant `0` -- i.e. every
 *    Expo-scheduled notification shares the same numeric id and is
 *    distinguished only by the identifier-as-tag. Android's own
 *    `notify(tag, id, notification)` contract replaces any currently shown
 *    notification sharing that (tag, id) pair.
 *
 *    THE IDENTIFIER MUST STILL BE ROTATED ON EVERY POST, NOT REUSED. A first
 *    implementation kept one constant identifier for exactly this
 *    replace-not-duplicate reason, and it was wrong: `expo-notifications`'
 *    own `useLastNotificationResponse` dedupes its emitted value by
 *    `request.identifier` (`determineNextResponse`), and
 *    use-notification-lifecycle.ts's own `handledIdRef` dedupes the same
 *    way -- so a SECOND tap reusing an identifier already "seen" is
 *    invisible at both layers. Since a persistent, repeatedly-tappable
 *    shade affordance is the entire point, the identifier must be fresh
 *    every time this is (re-)posted, and use-capture-shortcut-notification.ts
 *    cleans up whatever identifier was previously showing by RECOGNISING it
 *    (via `isCaptureShortcutNotification`'s `data` marker below, which never
 *    changes), not by remembering it across calls or process restarts.
 *  - An immediate (non-scheduled) notification pinned to a specific channel
 *    is `trigger: { channelId }` -- `ChannelAwareTriggerInput`, documented
 *    verbatim as "A trigger that will cause the notification to be
 *    delivered immediately" -- NOT `trigger: null`. `trigger: null` also
 *    delivers immediately but carries no `channelId` field to attach one,
 *    and `scheduleNotificationAsync.ts`'s own `parseTrigger` confirms the
 *    channel-only shape is exactly the "no type, deliver now, on this
 *    channel" case (its final `Platform.select` branch: `{ type: 'channel',
 *    channelId }` on Android). See use-capture-shortcut-notification.ts for
 *    where this is used.
 *
 * STATIC CONTENT ONLY (hard privacy requirement): title/body never derive
 * from captured text -- there is no captured text yet, only the intent to
 * capture -- so nothing here can leak into a lock-screen preview or a log
 * line. Do not parameterize this content.
 */
const CAPTURE_SHORTCUT_NOTIFICATION_ID_PREFIX = "capture-shortcut";

let identifierCounter = 0;

/**
 * A FRESH identifier every call -- see the header comment above for why a
 * single constant identifier is wrong. The prefix carries no meaning beyond
 * making the identifier recognisable in logs/debugging; recognition of "is
 * this the capture-shortcut notification" always goes through
 * `isCaptureShortcutNotification`'s `data` marker, never through parsing
 * this string.
 */
export function makeCaptureShortcutNotificationIdentifier(): string {
  identifierCounter += 1;
  return `${CAPTURE_SHORTCUT_NOTIFICATION_ID_PREFIX}-${identifierCounter}`;
}

/** Test seam only. */
export function resetCaptureShortcutNotificationIdentifierForTest(): void {
  identifierCounter = 0;
}

/**
 * This notification has no destination for resolveNotificationRoute to
 * resolve -- there is no "/capture" route; the composer is a global Modal
 * mounted in the root layout (see plugins/withCaptureShortcut.ts's header
 * comment for why the launcher shortcut already made the same choice) -- so
 * a tap must be recognised and intercepted by
 * use-notification-lifecycle.ts's `handleNotificationResponse` BEFORE
 * `resolveNotificationRoute` ever sees the payload, not routed through it.
 *
 * A plain boolean flag rather than a route-shaped id, matching the
 * data-carries-no-destination shape this payload actually has.
 */
export function isCaptureShortcutNotification(data: unknown): boolean {
  if (typeof data !== "object" || data === null) return false;
  return (data as Record<string, unknown>)["captureShortcut"] === true;
}

/**
 * The exact, static content posted for the shade affordance. Pulled out as
 * its own pure function (zero runtime import of `expo-notifications` --
 * the import above is `import type`, erased at compile time) so it is
 * exercisable with plain vitest and so the "these strings never come from
 * captured text" property is trivially visible at the call site: there is
 * no parameter to smuggle anything through.
 */
export function buildCaptureShortcutNotificationContent(): Notifications.NotificationContentInput {
  return {
    title: "Capture",
    body: "Tap to add a note, task, or reminder.",
    sticky: true,
    autoDismiss: false,
    data: { captureShortcut: true },
  };
}
