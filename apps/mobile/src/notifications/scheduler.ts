import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { REMINDERS_CHANNEL_ID } from "./channel";
import {
  buildReminderBody,
  diffScheduledReminders,
  missedReminderDisposition,
  reminderNotificationIdentifier,
  toScheduledReminder,
  type ReminderTask,
  type ScheduledReminder,
} from "./reconcile";
import { REMINDER_CATEGORY_ID, readReminderNotificationData } from "./reminder-actions";

// expo-notifications' own getAllScheduledNotificationsAsync() is the source
// of truth for "what's currently scheduled" -- key/taskId/occurrenceId/
// remindAt are round-tripped through each notification's own `content.data`
// at schedule time below, rather than kept in a second store that could
// drift out of sync with the OS's real alarm list. Legacy (pre-9.4)
// entries, which carry only `{ taskId, remindAt }`, are read back too --
// see reconcile.ts's toScheduledReminder.
export async function readOwnedReminders(): Promise<ScheduledReminder[]> {
  if (Platform.OS === "web") return [];
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .map((request) => toScheduledReminder(request.identifier, request.content.data))
    .filter((reminder): reminder is ScheduledReminder => reminder !== null);
}

/**
 * The keys of every reminder currently showing in the shade -- read through
 * the same `content.data` the scheduler wrote (the 9.1 dismiss-by-content-
 * marker pattern from use-capture-shortcut-notification.ts, never by a
 * remembered identifier: a fresh process has no memory of what a prior one
 * presented). Web has no shade to read.
 */
async function readPresentedReminderKeys(): Promise<Set<string>> {
  if (Platform.OS === "web") return new Set();
  const presented = await Notifications.getPresentedNotificationsAsync();
  const keys = new Set<string>();
  for (const notification of presented) {
    const payload = readReminderNotificationData(notification.request.content.data);
    if (payload !== null) keys.add(payload.key);
  }
  return keys;
}

/**
 * Identifiers this process has already presented immediately (the
 * `present_now` disposition). A presented notification is not in
 * getAllScheduledNotificationsAsync, so every later reconcile pass finds
 * the same missed one-off in `toSchedule` again; the shade check is the
 * cross-process guard, and this set is the in-process one for the window
 * in which the owner has just swiped the presented entry away but the feed
 * (which drops it an hour after its instant) still lists it. The identifier
 * carries the instant, so a snooze -- a new instant -- is a new entry.
 */
const presentedImmediately = new Set<string>();

/** Test seam only. */
export function resetPresentedImmediatelyForTest(): void {
  presentedImmediately.clear();
}

async function reconcileReminders(
  reminders: ReminderTask[],
  exactAlarmCapable: boolean,
): Promise<void> {
  if (Platform.OS === "web") return;
  const now = new Date();
  const currentlyScheduled = await readOwnedReminders();
  const { toSchedule, toCancel } = diffScheduledReminders(
    reminders,
    currentlyScheduled,
    now,
    exactAlarmCapable,
  );

  await Promise.all(
    toCancel.map((scheduled) =>
      Notifications.cancelScheduledNotificationAsync(scheduled.notificationId),
    ),
  );

  // The shade is read at most once per pass, and only when a missed
  // one-off needs it.
  let presentedKeys: Set<string> | null = null;

  for (const reminder of toSchedule) {
    const identifier = reminderNotificationIdentifier(reminder);
    const disposition = missedReminderDisposition(reminder, now);
    // See reconcile.ts's missedReminderDisposition: a DATE trigger for a
    // past instant is REMOVED by expo-notifications, not fired, so a missed
    // one-off is presented directly and a missed occurrence is left alone.
    if (disposition === "drop") continue;
    if (disposition === "present_now") {
      presentedKeys ??= await readPresentedReminderKeys();
      if (presentedKeys.has(reminder.key) || presentedImmediately.has(identifier)) continue;
      presentedImmediately.add(identifier);
    }
    await Notifications.scheduleNotificationAsync({
      // Deterministic -- see reconcile.ts's reminderNotificationIdentifier
      // for why this is the one notification whose identifier must NOT
      // rotate.
      identifier,
      content: {
        title: reminder.title,
        body: buildReminderBody(reminder),
        // Attaches the Done / Snooze 1h / Tomorrow 9am buttons registered
        // by channel.ts's ensureReminderCategory. Every one of them
        // foregrounds the app, so the response reaches
        // use-notification-lifecycle.ts even from a dead process.
        categoryIdentifier: REMINDER_CATEGORY_ID,
        data: {
          key: reminder.key,
          taskId: reminder.taskId,
          occurrenceId: reminder.occurrenceId,
          remindAt: reminder.remindAt,
          exactAlarmCapable,
        },
      },
      trigger:
        disposition === "present_now"
          ? // ChannelAwareTriggerInput: "delivered immediately", on this
            // channel -- the same shape the capture shortcut uses (see
            // capture-shortcut-notification.ts for why not `trigger: null`,
            // which cannot name a channel).
            { channelId: REMINDERS_CHANNEL_ID }
          : {
              type: Notifications.SchedulableTriggerInputTypes.DATE,
              date: new Date(reminder.remindAt),
              channelId: REMINDERS_CHANNEL_ID,
            },
    });
  }
}

// Reconciliation can be triggered by a task mutation, a foreground event,
// and a device-settings refetch at nearly the same time. Serializing those
// passes guarantees the newest pass runs last instead of letting an older
// async pass cancel notifications scheduled by a newer one. Checkpoint 9.4's
// cancelRemindersForKey rides the same chain, so a cancel issued from a
// mutation's onSuccess can never interleave with a reconcile pass that is
// mid-way through re-scheduling the same key.
let reconciliationChain: Promise<void> = Promise.resolve();

function enqueue(step: () => Promise<void>): Promise<void> {
  const next = reconciliationChain.then(step);
  reconciliationChain = next.catch(() => undefined);
  return next;
}

export function applyReminderReconciliation(
  reminders: ReminderTask[],
  exactAlarmCapable = true,
): Promise<void> {
  return enqueue(() => reconcileReminders(reminders, exactAlarmCapable));
}

/**
 * Cancels every owned local reminder whose key matches (Checkpoint 9.4,
 * cancel-on-mutation) -- the SCHEDULED entries, and also any notification
 * for that key already PRESENTED in the shade. The second half is what
 * completing a task in the app does to the reminder that already fired for
 * it: Android's autoCancel clears a notification only on its content tap,
 * so without this the fired entry would stay in the shade with its Done /
 * Snooze buttons live, pointing at a task the owner just finished. Matched
 * by `content.data.key` (the 9.1 dismiss-by-content-marker pattern), never
 * by a remembered identifier.
 *
 * Called from the onSuccess of every task/occurrence mutation that can make
 * a reminder stale (complete, drop, archive, update, snooze, skip, reopen)
 * and from the lifecycle after a notification action, BEFORE the query
 * invalidation that will eventually reconcile from the fresh feed -- so an
 * alarm for something the owner just completed cannot fire in the window
 * between the mutation and the next reconcile pass. `key` is `task:<id>`
 * for a one-off task and `occ:<id>` for an occurrence, exactly as the feed
 * labels them (reminder-actions.ts's helpers).
 */
export function cancelRemindersForKey(key: string): Promise<void> {
  if (Platform.OS !== "android") return Promise.resolve();
  return enqueue(async () => {
    const scheduled = await readOwnedReminders();
    const presented = await Notifications.getPresentedNotificationsAsync();
    await Promise.all([
      ...scheduled
        .filter((reminder) => reminder.key === key)
        .map((reminder) => Notifications.cancelScheduledNotificationAsync(reminder.notificationId)),
      ...presented
        .filter(
          (notification) =>
            readReminderNotificationData(notification.request.content.data)?.key === key,
        )
        .map((notification) =>
          Notifications.dismissNotificationAsync(notification.request.identifier).catch(() => {
            // Already gone (the owner swiped it, or a race with another
            // dismiss) -- nothing to recover.
          }),
        ),
    ]);
  });
}

export async function cancelOwnedReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  const scheduled = await readOwnedReminders();
  await Promise.all(
    scheduled.map((reminder) =>
      Notifications.cancelScheduledNotificationAsync(reminder.notificationId),
    ),
  );
}
