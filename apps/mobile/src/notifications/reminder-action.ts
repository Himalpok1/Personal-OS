import { ApiClientError } from "@personal-os/api-client";
import { buildSnoozePatch, computeSnoozeTargets } from "@personal-os/core/task-snooze";
import type { Task, TaskUpdate } from "@personal-os/schema";
import { classifyTaskActionError, isTaskOpen } from "@/components/task-actions-state";
import {
  REMINDER_ACTION_COMPLETE,
  REMINDER_ACTION_SNOOZE_HOUR,
  REMINDER_ACTION_SNOOZE_TOMORROW,
  formatSnoozeTargetLabel,
  type ReminderActionIdentifier,
  type ReminderNotificationData,
} from "./reminder-actions";
import type { ReminderActionFailureReason, ReminderActionOutcome } from "./reminder-action-signal";

/**
 * Runs one reminder notification action end to end (Checkpoint 9.4). Every
 * side effect arrives through `deps` so this is exercisable with plain
 * vitest and zero module mocking -- use-notification-lifecycle.ts binds the
 * real API client, query client and scheduler. NEVER THROWS: the caller
 * (the lifecycle) navigates to the task either way and publishes whatever
 * outcome this returns, so a network failure ends as a "failed" banner on
 * the task screen, not an unhandled rejection from a notification tap.
 *
 * What each action does, precisely:
 *
 *  complete        occurrenceId ? POST /occurrences/:id/complete
 *                               : POST /tasks/:id/complete -- and when THAT
 *                    is refused with 409 recurring_task_use_occurrence, the
 *                    occurrence the 409 names is completed instead (the
 *                    same fallback the detail screen applies, via the shared
 *                    classifyTaskActionError).
 *  snooze_hour     target = now + 60 min
 *  snooze_tomorrow target = 09:00 tomorrow in the device zone (DST-safe:
 *                    computeSnoozeTargets resolves wall clock, never +24h)
 *                  then occurrenceId ? POST /occurrences/:id/snooze {until}
 *                                    : GET /tasks/:id, then PATCH /tasks/:id
 *                    with buildSnoozePatch(task, target) -- which moves
 *                    remind_at only if the task already HAS one, so a snooze
 *                    can never create a reminder the owner did not set.
 *
 * After a SUCCESSFUL call, and only then: the shown notification is
 * dismissed (Android's autoCancel applies only to the content tap, not to
 * an action button, so the notification would otherwise stay in the shade
 * with its buttons still live), the local alarm for this key is cancelled,
 * and the query caches that render the task are invalidated. The
 * invalidations are fire-and-forget -- the outcome is already "done" on the
 * server and the lifecycle should navigate to the task without waiting on
 * four refetches; each hook re-renders as its query lands.
 *
 * On FAILURE the outcome carries a `reason` (reminder-action-signal.ts):
 * a 404 or a 409 means there is nothing left in the shade to act on -- the
 * occurrence was completed elsewhere, the task was dropped or deleted -- so
 * the notification IS dismissed then, and only then. A failure that never
 * reached the API (no ApiClientError) leaves it in place: the buttons still
 * work, the lifecycle releases its dedupe key, and the owner can retry the
 * very same button from the shade or act from the task screen.
 */
export interface ReminderActionDeps {
  api: {
    completeOccurrence: (id: string) => Promise<unknown>;
    completeTask: (id: string) => Promise<unknown>;
    snoozeOccurrence: (id: string, body: { until: string }) => Promise<unknown>;
    getTask: (id: string) => Promise<Task>;
    updateTask: (id: string, body: TaskUpdate) => Promise<unknown>;
  };
  invalidateQueries: (queryKey: readonly unknown[]) => Promise<unknown> | void;
  dismissNotification: (identifier: string) => Promise<void>;
  cancelRemindersForKey: (key: string) => Promise<void>;
  now: () => Date;
  timezone: () => string;
}

export interface ReminderActionInput {
  /** The notification request identifier, for dismissal after success. */
  identifier: string;
  action: ReminderActionIdentifier;
  data: ReminderNotificationData;
}

/** Every cache a task/occurrence mutation can make stale. Order is not significant. */
export const REMINDER_ACTION_INVALIDATIONS: readonly (readonly string[])[] = [
  ["tasks"],
  ["today"],
  ["occurrences"],
  ["reminders"],
];

async function complete(input: ReminderActionInput, deps: ReminderActionDeps): Promise<void> {
  const { taskId, occurrenceId } = input.data;
  if (occurrenceId !== null) {
    await deps.api.completeOccurrence(occurrenceId);
    return;
  }
  try {
    await deps.api.completeTask(taskId);
  } catch (error) {
    const failure = classifyTaskActionError(error);
    if (failure.kind !== "use_occurrence") throw error;
    await deps.api.completeOccurrence(failure.occurrenceId);
  }
}

/**
 * A refusal decided on the CLIENT, before any write: the one-off snooze
 * path fetches the task first (it needs `remind_at`), and a task that is no
 * longer open must not be PATCHed -- PATCH /tasks/:id would happily move
 * the due date of a done task, which is neither what the button promised
 * nor reversible from the shade. Classified exactly like the server's 409.
 */
class ReminderActionRefused extends Error {
  constructor(readonly reason: ReminderActionFailureReason) {
    super(`reminder action refused: ${reason}`);
    this.name = "ReminderActionRefused";
  }
}

/** Returns the target instant it snoozed to, for the outcome label. */
async function snooze(
  input: ReminderActionInput,
  deps: ReminderActionDeps,
  choice: "inOneHour" | "tomorrowMorning",
): Promise<string> {
  const target = computeSnoozeTargets(deps.now(), deps.timezone())[choice];
  const { taskId, occurrenceId } = input.data;
  if (occurrenceId !== null) {
    await deps.api.snoozeOccurrence(occurrenceId, { until: target });
    return target;
  }
  const task = await deps.api.getTask(taskId);
  if (!isTaskOpen(task.status)) throw new ReminderActionRefused("not_open");
  await deps.api.updateTask(taskId, buildSnoozePatch(task, target));
  return target;
}

/**
 * Maps whatever the action threw to a ReminderActionFailureReason. A 409
 * from any of the routes involved -- occurrence_not_open, task_not_open,
 * occurrence_not_reopenable, recurring_task_no_open_occurrence,
 * invalid_status_transition -- says the same thing at this distance: the
 * state has moved on and the button's premise is gone. Anything that is not
 * an ApiClientError never reached the API.
 */
export function classifyReminderActionFailure(error: unknown): ReminderActionFailureReason {
  if (error instanceof ReminderActionRefused) return error.reason;
  if (!(error instanceof ApiClientError)) return "network";
  if (error.status === 404) return "not_found";
  if (error.status === 409) return "not_open";
  return "unknown";
}

/** Nothing is left to act on: the shade entry should go. */
function isTerminalFailure(reason: ReminderActionFailureReason): boolean {
  return reason === "not_open" || reason === "not_found";
}

export async function performReminderAction(
  input: ReminderActionInput,
  deps: ReminderActionDeps,
): Promise<ReminderActionOutcome> {
  const { action } = input;
  const { taskId } = input.data;
  // The snooze target, formatted for the banner; "" for a completion.
  let label = "";
  try {
    switch (action) {
      case REMINDER_ACTION_COMPLETE:
        await complete(input, deps);
        break;
      case REMINDER_ACTION_SNOOZE_HOUR:
        label = formatSnoozeTargetLabel(await snooze(input, deps, "inOneHour"), deps.now());
        break;
      case REMINDER_ACTION_SNOOZE_TOMORROW:
        label = formatSnoozeTargetLabel(await snooze(input, deps, "tomorrowMorning"), deps.now());
        break;
    }
  } catch (error) {
    const reason = classifyReminderActionFailure(error);
    console.warn("Reminder notification action failed", {
      action,
      reason,
      status: error instanceof Error ? error.name : typeof error,
    });
    if (isTerminalFailure(reason)) {
      // The 404/409 is the server saying this notification is stale; a
      // dismissed stale entry cannot be tapped into the same answer again.
      // Best-effort, like the success-path dismiss below.
      await deps.dismissNotification(input.identifier).catch((dismissError: unknown) => {
        console.warn("Failed to dismiss a stale reminder notification", dismissError);
      });
    }
    return { taskId, action, status: "failed", label: "", reason };
  }

  // Cleanup after success. Each step is best-effort and independent: a
  // failure to dismiss must not skip the alarm cancel, and neither must
  // skip the invalidation that will eventually reconcile everything from
  // the fresh feed anyway. None of it changes the outcome, which is
  // already "done" on the server.
  await deps.dismissNotification(input.identifier).catch((error: unknown) => {
    console.warn("Failed to dismiss an acted-on reminder notification", error);
  });
  await deps.cancelRemindersForKey(input.data.key).catch((error: unknown) => {
    console.warn("Failed to cancel the local alarm for an acted-on reminder", error);
  });
  // Fire-and-forget (see the header): started here, in order, never awaited.
  for (const queryKey of REMINDER_ACTION_INVALIDATIONS) {
    void Promise.resolve(deps.invalidateQueries(queryKey)).catch(() => undefined);
  }

  return { taskId, action, status: "done", label };
}
