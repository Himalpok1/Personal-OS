import type { SnoozeChoice } from "@personal-os/core/task-snooze";
import type { TodayTaskItem } from "@personal-os/schema";

// Pure, React-free decisions behind the Today quick actions (Checkpoint
// 10.6), split from use-today-task-actions.ts so the hook module (which
// reaches the API client) can be mocked whole in a render test while these
// stay real.

/** The three snooze targets a Today row offers, in the order the sheet lists them. */
export const SNOOZE_CHOICES: readonly { choice: SnoozeChoice; label: string }[] = [
  { choice: "inOneHour", label: "In 1 hour" },
  { choice: "tomorrowMorning", label: "Tomorrow 9am" },
  { choice: "nextWeekMorning", label: "Next week" },
];

/**
 * A Today row can be snoozed when it is an occurrence (one instance of a
 * recurring task, `occurrences.snoozed_until`) or a one-off task (its own
 * `due_at`). A recurring PARENT row -- which Today has not bucketed since
 * Checkpoint 9.4 -- has no target: moving its `due_at` would re-point the
 * whole series (task-actions-state.ts's `canSnoozeTask`).
 */
export function canSnoozeTodayTask(item: Pick<TodayTaskItem, "occurrence_id" | "rrule">): boolean {
  return item.occurrence_id != null || item.rrule === null;
}
