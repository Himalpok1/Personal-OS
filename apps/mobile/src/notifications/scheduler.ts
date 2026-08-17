import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { REMINDERS_CHANNEL_ID } from "./channel";
import { diffScheduledReminders, type ReminderTask, type ScheduledReminder } from "./reconcile";

// expo-notifications' own getAllScheduledNotificationsAsync() is the source
// of truth for "what's currently scheduled" -- taskId/remindAt are
// round-tripped through each notification's own `content.data` at schedule
// time below, rather than kept in a second store that could drift out of
// sync with the OS's real alarm list.
function toScheduledReminder(request: Notifications.NotificationRequest): ScheduledReminder | null {
  const data = request.content.data;
  const taskId = typeof data?.["taskId"] === "string" ? data["taskId"] : null;
  const remindAt = typeof data?.["remindAt"] === "string" ? data["remindAt"] : null;
  const exactAlarmCapable =
    typeof data?.["exactAlarmCapable"] === "boolean" ? data["exactAlarmCapable"] : undefined;
  if (!taskId || !remindAt) return null;
  return { taskId, notificationId: request.identifier, remindAt, exactAlarmCapable };
}

export async function readCurrentlyScheduled(): Promise<ScheduledReminder[]> {
  if (Platform.OS === "web") return [];
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .map(toScheduledReminder)
    .filter((reminder): reminder is ScheduledReminder => reminder !== null);
}

async function reconcileReminders(
  tasks: ReminderTask[],
  exactAlarmCapable: boolean,
): Promise<void> {
  if (Platform.OS === "web") return;
  const currentlyScheduled = await readCurrentlyScheduled();
  const { toSchedule, toCancel } = diffScheduledReminders(
    tasks,
    currentlyScheduled,
    new Date(),
    exactAlarmCapable,
  );

  await Promise.all(
    toCancel.map((scheduled) =>
      Notifications.cancelScheduledNotificationAsync(scheduled.notificationId),
    ),
  );

  for (const task of toSchedule) {
    // remind_at is guaranteed non-null here -- diffScheduledReminders only
    // returns eligible tasks (see reconcile.ts's isEligible narrowing).
    await Notifications.scheduleNotificationAsync({
      content: {
        title: task.title,
        body: "Reminder",
        data: {
          taskId: task.id,
          remindAt: task.remind_at as string,
          exactAlarmCapable,
        },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(task.remind_at as string),
        channelId: REMINDERS_CHANNEL_ID,
      },
    });
  }
}

// Reconciliation can be triggered by a task mutation, a foreground event,
// and a device-settings refetch at nearly the same time. Serializing those
// passes guarantees the newest pass runs last instead of letting an older
// async pass cancel notifications scheduled by a newer one.
let reconciliationChain: Promise<void> = Promise.resolve();

export function applyReminderReconciliation(
  tasks: ReminderTask[],
  exactAlarmCapable = true,
): Promise<void> {
  const next = reconciliationChain.then(() => reconcileReminders(tasks, exactAlarmCapable));
  reconciliationChain = next.catch(() => undefined);
  return next;
}

export async function cancelOwnedReminders(): Promise<void> {
  if (Platform.OS === "web") return;
  const scheduled = await readCurrentlyScheduled();
  await Promise.all(
    scheduled.map((reminder) =>
      Notifications.cancelScheduledNotificationAsync(reminder.notificationId),
    ),
  );
}
