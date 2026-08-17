import * as Notifications from "expo-notifications";
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
  if (!taskId || !remindAt) return null;
  return { taskId, notificationId: request.identifier, remindAt };
}

export async function readCurrentlyScheduled(): Promise<ScheduledReminder[]> {
  const all = await Notifications.getAllScheduledNotificationsAsync();
  return all
    .map(toScheduledReminder)
    .filter((reminder): reminder is ScheduledReminder => reminder !== null);
}

export async function applyReminderReconciliation(tasks: ReminderTask[]): Promise<void> {
  const currentlyScheduled = await readCurrentlyScheduled();
  const { toSchedule, toCancel } = diffScheduledReminders(tasks, currentlyScheduled, new Date());

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
        data: { taskId: task.id, remindAt: task.remind_at as string },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: new Date(task.remind_at as string),
        channelId: REMINDERS_CHANNEL_ID,
      },
    });
  }
}
