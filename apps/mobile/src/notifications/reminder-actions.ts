import type * as Notifications from "expo-notifications";

/**
 * Reminder notification actions (Checkpoint 9.4). Pure -- the only
 * `expo-notifications` import is `import type`, erased at compile time --
 * so the category registration in channel.ts, the response handling in
 * use-notification-lifecycle.ts and every test share ONE set of identifier
 * strings instead of three hand-copied ones that can drift (the same reason
 * channel.ts exports its channel ids as constants and the worker's channel
 * test pins against them).
 *
 * THE THREE ACTIONS ALL FOREGROUND THE APP (`opensAppToForeground: true`).
 * This is a correctness requirement, not a UX preference: with
 * `opensAppToForeground: false` and the process dead -- the normal state for
 * a reminder that fires hours after the app was last opened --
 * expo-notifications parks the response in a static in-process collection
 * and it is LOST if the process dies before JS boots (verified in the
 * installed native source; the durable path needs `expo-task-manager`,
 * which is not a dependency -- ADR-060 recorded the identical finding for
 * direct reply). A foregrounding action is delivered exactly like the
 * default tap, which IS cold-start safe and was proven on the Rabbit R1 in
 * Checkpoint 9.1. Never set it to `false`.
 *
 * The category identifier deliberately contains neither `:` nor `-`, per
 * setNotificationCategoryAsync's own documented restriction.
 */
export const REMINDER_CATEGORY_ID = "reminder";

export const REMINDER_ACTION_COMPLETE = "complete";
export const REMINDER_ACTION_SNOOZE_HOUR = "snooze_hour";
export const REMINDER_ACTION_SNOOZE_TOMORROW = "snooze_tomorrow";

export type ReminderActionIdentifier =
  | typeof REMINDER_ACTION_COMPLETE
  | typeof REMINDER_ACTION_SNOOZE_HOUR
  | typeof REMINDER_ACTION_SNOOZE_TOMORROW;

/** Display order on the notification, left to right. */
export const REMINDER_ACTIONS: readonly {
  identifier: ReminderActionIdentifier;
  buttonTitle: string;
}[] = [
  { identifier: REMINDER_ACTION_COMPLETE, buttonTitle: "Done" },
  { identifier: REMINDER_ACTION_SNOOZE_HOUR, buttonTitle: "Snooze 1h" },
  { identifier: REMINDER_ACTION_SNOOZE_TOMORROW, buttonTitle: "Tomorrow 9am" },
];

export function isReminderActionIdentifier(value: string): value is ReminderActionIdentifier {
  return REMINDER_ACTIONS.some((action) => action.identifier === value);
}

/**
 * The exact `actions` argument for
 * `setNotificationCategoryAsync(REMINDER_CATEGORY_ID, ...)`. A function
 * rather than a constant so the "every action foregrounds" invariant is
 * built in one place and a test can assert it over the whole array.
 */
export function buildReminderCategoryActions(): Notifications.NotificationAction[] {
  return REMINDER_ACTIONS.map((action) => ({
    identifier: action.identifier,
    buttonTitle: action.buttonTitle,
    options: { opensAppToForeground: true },
  }));
}

/**
 * The `label` a published ReminderActionOutcome carries: the snooze TARGET,
 * formatted in the device's locale and zone ("10:05 AM", or "Tue 9:00 AM"
 * when it lands on a different local day than `now`), and the empty string
 * for a completion or a failure -- the task detail screen builds its own
 * sentence around it ("Snoozed until 10:05 AM from reminder"). Never task
 * text: the only input is an instant.
 */
export function formatSnoozeTargetLabel(targetIso: string, now: Date): string {
  const target = new Date(targetIso);
  if (Number.isNaN(target.getTime())) return "";
  const time = target.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (target.toDateString() === now.toDateString()) return time;
  return `${target.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
}

/**
 * The payload a reminder notification round-trips through `content.data`
 * (see scheduler.ts). `key` is the server-authored reminder identity --
 * `task:<task id>` for a one-off task, `occ:<occurrence id>` for one
 * instance of a recurring task -- and is what both the scheduler's
 * cancel-by-key and the lifecycle's act-on-tap are keyed on.
 */
export interface ReminderNotificationData {
  key: string;
  taskId: string;
  occurrenceId: string | null;
  remindAt: string;
}

export function taskReminderKey(taskId: string): string {
  return `task:${taskId}`;
}

export function occurrenceReminderKey(occurrenceId: string): string {
  return `occ:${occurrenceId}`;
}

/** A one-off task's key, as opposed to one instance of a recurring task. */
export function isOneOffReminderKey(key: string): boolean {
  return key.startsWith("task:");
}

/**
 * Reads a reminder payload back out of a notification, accepting BOTH the
 * 9.4 shape (`{ key, taskId, occurrenceId, remindAt }`) and the pre-9.4
 * shape (`{ taskId, remindAt }` only). The legacy case is not hypothetical:
 * alarms scheduled by the previous APK stay armed on the device across the
 * update, so the first reconciliation after the update sees them, and they
 * must be recognised as OWNED (so they are cancelled/replaced cleanly)
 * rather than treated as foreign notifications that are never touched. A
 * legacy entry has no `key`, so it is assigned the one-off key
 * `task:<taskId>` -- which is exactly what the new feed emits for the same
 * one-off task, so an unchanged legacy alarm is retained rather than
 * churned, and a recurring task's legacy alarm (whose new key is
 * `occ:<id>`) is cancelled as stale.
 */
export function readReminderNotificationData(data: unknown): ReminderNotificationData | null {
  if (typeof data !== "object" || data === null) return null;
  const record = data as Record<string, unknown>;
  const taskId = record["taskId"];
  const remindAt = record["remindAt"];
  if (typeof taskId !== "string" || taskId.length === 0) return null;
  if (typeof remindAt !== "string" || remindAt.length === 0) return null;
  const key = record["key"];
  const occurrenceId = record["occurrenceId"];
  return {
    key: typeof key === "string" && key.length > 0 ? key : taskReminderKey(taskId),
    taskId,
    occurrenceId: typeof occurrenceId === "string" && occurrenceId.length > 0 ? occurrenceId : null,
    remindAt,
  };
}
