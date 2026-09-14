import { OCCURRENCE_NOT_OPEN_MESSAGE } from "@/components/task-actions-state";

/**
 * Pure copy for the reminder-action banner (Checkpoint 9.4), split out from
 * the component so it can be unit-tested without the notifications module.
 *
 * The outcome shape is Lane L4's contract (§6.4): `{ taskId, action, status,
 * label }`, published by use-notification-lifecycle.ts after a Done /
 * Snooze 1h / Tomorrow 9am tap on a reminder notification. It is declared
 * here structurally rather than imported, so this module has no dependency on
 * the signal's own exports beyond the two functions the component calls.
 */

export type ReminderActionOutcome =
  | {
      taskId: string;
      /** "complete" | "snooze_hour" | "snooze_tomorrow" per the notification category. */
      action: string;
      status: "done";
      /** Human label for a snooze target; may be empty for a completion. */
      label: string;
    }
  | {
      taskId: string;
      action: string;
      status: "failed";
      label: string;
      /** "not_open" | "not_found" | "network" | "unknown" -- see reminder-action-signal.ts. */
      reason: string;
    };

function verb(action: string): "complete" | "snooze" {
  return action === "complete" ? "complete" : "snooze";
}

export const TASK_NOT_FOUND_MESSAGE = "That task no longer exists.";

/**
 * The banner line for an outcome. Never includes the task's own text.
 *
 * A failure names what the owner can do about it: a 409 means the state
 * moved on (the same copy the detail screen's snooze chips use for that 409,
 * so the two surfaces agree), a 404 means the task is gone, and only a
 * failure that never reached the API ends in "try again" -- which is
 * truthful now that the lifecycle releases its dedupe key on failure, so
 * the same button CAN be tapped again.
 */
export function reminderActionBannerText(outcome: ReminderActionOutcome): string {
  if (outcome.status === "failed") {
    if (outcome.reason === "not_open") return OCCURRENCE_NOT_OPEN_MESSAGE;
    if (outcome.reason === "not_found") return TASK_NOT_FOUND_MESSAGE;
    return `Couldn't ${verb(outcome.action)} from the reminder — try again`;
  }
  if (verb(outcome.action) === "complete") return "Completed from reminder";
  return outcome.label ? `Snoozed until ${outcome.label} from reminder` : "Snoozed from reminder";
}
