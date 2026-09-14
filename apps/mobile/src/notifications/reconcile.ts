// Pure, zero expo-notifications import on purpose -- this is the one piece
// of genuine client-side domain logic Phase 3 adds (see docs/STATUS.md's
// Phase 2 "apps/mobile has no automated test coverage" note, and the Phase
// 3 plan's §16/§21: everything else in the mobile app is thin composition
// over already-tested packages/core and packages/api-client). Keeping this
// free of expo-notifications means it's testable with plain vitest, no
// native-module mocking required, and it's the function a reboot-survival
// fallback (a headless JS task, if the built-in mechanism turns out to need
// one) would call too -- see the exact-alarm/reboot spike notes in
// docs/STATUS.md.
//
// Checkpoint 9.4: the input is no longer a page of `tasks` rows but the
// server-derived `GET /reminders` feed -- one item per one-off task with a
// reminder and one per open OCCURRENCE of a recurring task (the A3 debt:
// a recurring task's reminder used to fire once, on the parent's remind_at,
// and never again). Each item carries a server-authored `key`
// (`task:<id>` / `occ:<id>`), and everything here is keyed on it.

import type { ReminderItem } from "@personal-os/schema";
import { isOneOffReminderKey, readReminderNotificationData } from "./reminder-actions";

export interface ReminderTask {
  key: string;
  taskId: string;
  occurrenceId: string | null;
  title: string;
  /** ISO instant the local notification fires at. */
  remindAt: string;
  /** The effective due instant (snoozed_until ?? occurs_at for an occurrence), or null. */
  dueAt: string | null;
  recurring: boolean;
}

/** The feed's wire shape, projected to the fields the scheduler needs. */
export function toReminderTask(item: ReminderItem): ReminderTask {
  return {
    key: item.key,
    taskId: item.task_id,
    occurrenceId: item.occurrence_id,
    title: item.title,
    remindAt: item.remind_at,
    dueAt: item.due_at,
    recurring: item.recurring,
  };
}

// One row per notification currently scheduled with expo-notifications.
// There is no separate bookkeeping table for this -- the scheduler reads
// getAllScheduledNotificationsAsync() and reconstructs this shape from each
// notification's own `content.data` (see scheduler.ts), since
// expo-notifications is already the durable source of truth for "what's
// currently scheduled" and a second store would just be a second place for
// that to drift out of sync.
export interface ScheduledReminder {
  key: string;
  taskId: string;
  occurrenceId: string | null;
  notificationId: string;
  remindAt: string;
  exactAlarmCapable?: boolean;
  /**
   * Armed by the pre-9.4 APK: `content.data` carries no `key`, and the
   * request carries no `categoryIdentifier` -- so, once fired, it shows NO
   * action buttons. Never retained by the diff (see diffScheduledReminders):
   * it is cancelled and its reminder re-scheduled, once, with the category.
   */
  legacy: boolean;
}

export interface ReconcileResult {
  toSchedule: ReminderTask[];
  toCancel: ScheduledReminder[];
}

/**
 * The identifier a reminder is scheduled under. DETERMINISTIC -- a function
 * of the reminder's identity and instant -- so that (a) a reconcile pass
 * that re-schedules an unchanged reminder REPLACES the existing entry
 * (Android's `notify(tag, id)` replaces on an equal tag) rather than
 * stacking a duplicate, and (b) a response's `request.identifier` is
 * meaningful in a log line without carrying task text. The capture
 * shortcut (capture-shortcut-notification.ts) deliberately ROTATES its
 * identifier because it must be re-tappable after each tap; a reminder is
 * the opposite case -- one instant, acted on once, then dismissed -- and
 * the lifecycle dedupes on `${identifier}:${actionIdentifier}` so two
 * DIFFERENT actions on one reminder are both honoured.
 */
export function reminderNotificationIdentifier(reminder: {
  key: string;
  remindAt: string;
}): string {
  return `reminder:${reminder.key}:${reminder.remindAt}`;
}

/**
 * G2a (contract §6): a reminder stays eligible for ONE HOUR after its
 * instant. The server applies the same `now - 1h` cutoff to the feed, so
 * this is defence in depth against clock skew, not the primary filter. The
 * rule's other half matters just as much: a scheduled entry is never
 * cancelled SOLELY because its instant passed within the last hour -- the
 * feed still lists it, so it is retained as a match.
 *
 * What a PAST instant inside the window does is decided by
 * `missedReminderDisposition` below -- NOT by scheduling a DATE trigger for
 * it. An earlier revision of this comment claimed such a trigger "fires
 * immediately"; on the installed expo-notifications (57.0.12) it does the
 * opposite: Android's `DateTrigger.nextTriggerDate()` returns null for an
 * instant before `now`, and `ExpoSchedulingDelegate.setupScheduledNotification`
 * then REMOVES the request ("will not trigger in the future, removing")
 * rather than delivering it. A missed reminder scheduled that way would
 * simply vanish.
 */
export const REMINDER_GRACE_MS = 60 * 60 * 1000;

function isEligible(reminder: ReminderTask, now: Date): boolean {
  const remindAt = new Date(reminder.remindAt).getTime();
  if (Number.isNaN(remindAt)) return false;
  return remindAt > now.getTime() - REMINDER_GRACE_MS;
}

/**
 * How the scheduler delivers one entry of `toSchedule` (Checkpoint 9.4):
 *
 *  `date`         the instant is still ahead -- an ordinary DATE trigger.
 *  `present_now`  a ONE-OFF task's reminder whose instant passed within the
 *                 grace hour (the phone was off, or the app was not running
 *                 to schedule it in time): presented immediately, on the
 *                 reminders channel, IF nothing for this key is already in
 *                 the shade -- that check lives in scheduler.ts, where the
 *                 shade can be read, and is what makes this happen once.
 *  `drop`         an OCCURRENCE reminder whose instant passed. Never
 *                 presented late: a freshly generated successor -- or a
 *                 just-snoozed instance whose new instant is somehow behind
 *                 the clock -- must not ring the moment it is created. The
 *                 feed stops listing it within the hour and nothing else
 *                 needs doing.
 */
export type MissedReminderDisposition = "date" | "present_now" | "drop";

export function missedReminderDisposition(
  reminder: Pick<ReminderTask, "key" | "remindAt">,
  now: Date,
): MissedReminderDisposition {
  const remindAt = new Date(reminder.remindAt).getTime();
  if (Number.isNaN(remindAt) || remindAt >= now.getTime()) return "date";
  return isOneOffReminderKey(reminder.key) ? "present_now" : "drop";
}

/**
 * Notification body. The TITLE is the task title (as it has been since
 * Phase 3); the body is a due time formatted in the device's locale and
 * zone, plus a repeat marker. Never the task body/notes -- a lock screen
 * is not the place for them, and nothing here has access to them anyway
 * (the feed's shape is closed and carries none).
 */
export function buildReminderBody(reminder: {
  dueAt: string | null;
  remindAt: string;
  recurring: boolean;
}): string {
  const due = reminder.dueAt === null ? null : new Date(reminder.dueAt);
  let text: string;
  if (due === null || Number.isNaN(due.getTime())) {
    text = "Reminder";
  } else {
    const time = due.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    // A due instant on a different local day than the reminder fires on
    // ("remind me the evening before") gets its weekday, otherwise "Due
    // 9:00 AM" reads as today.
    const remind = new Date(reminder.remindAt);
    const sameLocalDay =
      Number.isNaN(remind.getTime()) || due.toDateString() === remind.toDateString();
    text = sameLocalDay
      ? `Due ${time}`
      : `Due ${due.toLocaleDateString(undefined, { weekday: "short" })} ${time}`;
  }
  return reminder.recurring ? `${text} · repeats` : text;
}

/**
 * Reads the scheduler's own `content.data` back into a ScheduledReminder.
 * Delegates the legacy-payload tolerance to readReminderNotificationData
 * (reminder-actions.ts): entries armed by the pre-9.4 APK carry only
 * `{ taskId, remindAt }` and are keyed `task:<taskId>`, so they are
 * recognised as OWNED (cancel-by-key finds them; the diff cancels them)
 * rather than left orphaned as foreign notifications. They are flagged
 * `legacy` -- the absence of `key` is the whole test, since scheduler.ts
 * writes `key` and `categoryIdentifier` together -- and the diff never
 * retains one: an alarm armed without the category would fire without its
 * Done / Snooze buttons, so it is replaced, once, with one that has them.
 */
export function toScheduledReminder(
  notificationId: string,
  data: unknown,
): ScheduledReminder | null {
  const payload = readReminderNotificationData(data);
  if (payload === null) return null;
  const record = data as Record<string, unknown>;
  const exactAlarmCapable =
    typeof record["exactAlarmCapable"] === "boolean" ? record["exactAlarmCapable"] : undefined;
  const legacy = typeof record["key"] !== "string" || record["key"].length === 0;
  return {
    key: payload.key,
    taskId: payload.taskId,
    occurrenceId: payload.occurrenceId,
    notificationId,
    remindAt: payload.remindAt,
    exactAlarmCapable,
    legacy,
  };
}

export function diffScheduledReminders(
  reminders: ReminderTask[],
  currentlyScheduled: ScheduledReminder[],
  now: Date,
  exactAlarmCapable?: boolean,
): ReconcileResult {
  const scheduledByKey = new Map<string, ScheduledReminder[]>();
  for (const scheduled of currentlyScheduled) {
    const entries = scheduledByKey.get(scheduled.key) ?? [];
    entries.push(scheduled);
    scheduledByKey.set(scheduled.key, entries);
  }
  const eligibleKeys = new Set<string>();
  const retainedNotificationIds = new Set<string>();

  const toSchedule: ReminderTask[] = [];
  for (const reminder of reminders) {
    if (!isEligible(reminder, now)) continue;
    eligibleKeys.add(reminder.key);
    const existing = scheduledByKey
      .get(reminder.key)
      ?.find(
        (scheduled) =>
          !scheduled.legacy &&
          scheduled.remindAt === reminder.remindAt &&
          (exactAlarmCapable === undefined || scheduled.exactAlarmCapable === exactAlarmCapable),
      );
    // No existing schedule, or the reminder's instant moved (an edit, or a
    // snooze on the occurrence) since it was last scheduled, or the only
    // entry is a legacy one without the action category -- either way
    // the stale/missing entry needs a fresh notification.
    if (!existing) {
      toSchedule.push(reminder);
    } else {
      // Retain exactly one matching notification. Any duplicate matching
      // entries, plus stale entries for this key, are repaired below.
      retainedNotificationIds.add(existing.notificationId);
    }
  }

  const toCancel: ScheduledReminder[] = [];
  for (const scheduled of currentlyScheduled) {
    if (!eligibleKeys.has(scheduled.key)) {
      toCancel.push(scheduled);
      continue;
    }
    // Still eligible, but only the single matching notification selected
    // above is retained. This cancels both stale entries and duplicate
    // copies of the same intended reminder.
    if (!retainedNotificationIds.has(scheduled.notificationId)) {
      toCancel.push(scheduled);
    }
  }

  return { toSchedule, toCancel };
}
