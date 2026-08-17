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

export type ReminderTaskStatus = "inbox" | "active" | "done" | "dropped";

export interface ReminderTask {
  id: string;
  title: string;
  remind_at: string | null;
  status: ReminderTaskStatus;
  archived_at: string | null;
}

// One row per notification currently scheduled with expo-notifications.
// There is no separate bookkeeping table for this -- the scheduler reads
// getAllScheduledNotificationsAsync() and reconstructs this shape from each
// notification's own `content.data` (see scheduler.ts), since
// expo-notifications is already the durable source of truth for "what's
// currently scheduled" and a second store would just be a second place for
// that to drift out of sync.
export interface ScheduledReminder {
  taskId: string;
  notificationId: string;
  remindAt: string;
  exactAlarmCapable?: boolean;
}

export interface ReconcileResult {
  toSchedule: ReminderTask[];
  toCancel: ScheduledReminder[];
}

// "dropped, completed or archived tasks must not remain scheduled" (Phase 3
// checkpoint 4 scope) -- the complement (inbox and active) is what remains
// eligible. A remind_at in the past is excluded too: scheduling an
// expo-notifications DATE trigger for a past instant fires immediately,
// and a reconcile pass that runs after the device was off for a while
// would otherwise fire a burst of stale reminders on next launch.
function isEligible(task: ReminderTask, now: Date): task is ReminderTask & { remind_at: string } {
  return (
    task.remind_at !== null &&
    task.archived_at === null &&
    task.status !== "done" &&
    task.status !== "dropped" &&
    new Date(task.remind_at).getTime() > now.getTime()
  );
}

export function diffScheduledReminders(
  tasks: ReminderTask[],
  currentlyScheduled: ScheduledReminder[],
  now: Date,
  exactAlarmCapable?: boolean,
): ReconcileResult {
  const scheduledByTaskId = new Map(currentlyScheduled.map((s) => [s.taskId, s]));
  const tasksById = new Map(tasks.map((task) => [task.id, task]));
  const eligibleTaskIds = new Set<string>();

  const toSchedule: ReminderTask[] = [];
  for (const task of tasks) {
    if (!isEligible(task, now)) continue;
    eligibleTaskIds.add(task.id);
    const existing = scheduledByTaskId.get(task.id);
    // No existing schedule, or the task's remind_at moved (an edit) since
    // it was last scheduled -- either way the stale/missing entry needs a
    // fresh notification.
    if (
      !existing ||
      existing.remindAt !== task.remind_at ||
      (exactAlarmCapable !== undefined &&
        existing.exactAlarmCapable !== exactAlarmCapable)
    ) {
      toSchedule.push(task);
    }
  }

  const toCancel: ScheduledReminder[] = [];
  for (const scheduled of currentlyScheduled) {
    if (!eligibleTaskIds.has(scheduled.taskId)) {
      toCancel.push(scheduled);
      continue;
    }
    // Still eligible, but the reschedule case above needs the stale
    // notification cancelled too, or the task would end up with two.
    const task = tasksById.get(scheduled.taskId);
    if (
      task &&
      (task.remind_at !== scheduled.remindAt ||
        (exactAlarmCapable !== undefined &&
          scheduled.exactAlarmCapable !== exactAlarmCapable))
    ) {
      toCancel.push(scheduled);
    }
  }

  return { toSchedule, toCancel };
}
