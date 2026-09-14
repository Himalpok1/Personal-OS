import { ApiClientError } from "@personal-os/api-client";
import type { TaskStatus } from "@personal-os/schema";

/**
 * Pure logic behind the task action controls (Checkpoint 9.3), split out from
 * the JSX so it can be unit-tested without a render harness -- the same split
 * as components/datetime-field-state.ts and components/inbox/confirm-state.ts.
 *
 * Everything here is derived from SERVER-AUTHORED fields (status, error
 * codes, occurrence ids) and never from task text.
 */

export type TaskAction = "start" | "complete" | "drop" | "reopen";

/** inbox | active. The states a task can still be acted on or snoozed from. */
export function isTaskOpen(status: TaskStatus): boolean {
  return status === "inbox" || status === "active";
}

/**
 * Which lifecycle buttons a task offers, in display order.
 *
 * `start` (inbox -> active) only from `inbox`, mirroring the API's
 * `canActivateTask`. Complete and Drop are offered from both open states --
 * POST /tasks/:id/complete and /drop do not gate on `inbox` vs `active`.
 * A closed task offers only Reopen (contract 1: done | dropped -> active).
 */
export function availableTaskActions(status: TaskStatus): TaskAction[] {
  switch (status) {
    case "inbox":
      return ["start", "complete", "drop"];
    case "active":
      return ["complete", "drop"];
    case "done":
    case "dropped":
      return ["reopen"];
  }
}

/**
 * Snooze moves the task's own `due_at`. On a recurring task that is the
 * SERIES anchor, so a "snooze" would re-point every future occurrence -- not
 * what the word means. Snooze is therefore offered only on open, one-off
 * tasks; a recurring task's next date is edited through its rule.
 */
export function canSnoozeTask(task: { status: TaskStatus; rrule: string | null }): boolean {
  return isTaskOpen(task.status) && task.rrule === null;
}

const STATUS_LABEL: Record<TaskStatus, string> = {
  inbox: "New",
  active: "Active",
  done: "Done",
  dropped: "Dropped",
};

/** The status line shown at the top of the task detail screen. */
export function describeTaskStatus(task: {
  status: TaskStatus;
  completed_at: string | null;
}): string {
  const label = STATUS_LABEL[task.status];
  if (task.status !== "done" || !task.completed_at) return label;
  const completed = new Date(task.completed_at);
  if (Number.isNaN(completed.getTime())) return label;
  return `${label} · completed ${completed.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  })}`;
}

/**
 * What the client should do after a task action fails.
 *
 * `use_occurrence`: the server refused POST /tasks/:id/complete because the
 * task repeats and has an open occurrence (409 recurring_task_use_occurrence
 * with a non-null occurrence_id) -- the caller completes THAT occurrence
 * instead, transparently.
 *
 * `message`: something to show the user. Never the raw `ApiClientError.message`
 * (it is the developer-shaped `API error 409: ...`) and never server prose.
 */
export type TaskActionFailure =
  | { kind: "use_occurrence"; occurrenceId: string }
  | { kind: "message"; message: string };

export const NO_OPEN_OCCURRENCE_MESSAGE =
  "This repeats; its next occurrence is not generated yet — try again after 3:00 UTC or edit the repeat rule.";

export const GENERIC_TASK_ACTION_MESSAGE = "Couldn't update this task. Please try again.";

export function classifyTaskActionError(err: unknown): TaskActionFailure {
  if (!(err instanceof ApiClientError)) {
    return { kind: "message", message: GENERIC_TASK_ACTION_MESSAGE };
  }
  if (err.status === 404) {
    return { kind: "message", message: "This task couldn't be found." };
  }
  if (err.status === 409) {
    switch (err.code) {
      case "recurring_task_use_occurrence": {
        const occurrenceId = readOccurrenceId(err.body);
        // A null occurrence_id is the pre-9.3 server's way of saying "no open
        // occurrence"; contract 2 gives it its own code, handled below.
        if (occurrenceId) return { kind: "use_occurrence", occurrenceId };
        return { kind: "message", message: NO_OPEN_OCCURRENCE_MESSAGE };
      }
      case "recurring_task_no_open_occurrence":
        return { kind: "message", message: NO_OPEN_OCCURRENCE_MESSAGE };
      case "task_not_reopenable":
        return { kind: "message", message: "This task can't be reopened from its current state." };
      case "invalid_status_transition":
        return { kind: "message", message: "This task can't be started from its current state." };
      default:
        return { kind: "message", message: GENERIC_TASK_ACTION_MESSAGE };
    }
  }
  return { kind: "message", message: GENERIC_TASK_ACTION_MESSAGE };
}

function readOccurrenceId(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const value = (body as { occurrence_id?: unknown }).occurrence_id;
  return typeof value === "string" && value.length > 0 ? value : null;
}

/**
 * Where a "complete" tap on a list row goes. A row that IS an occurrence
 * (Today carries `occurrence_id` for the materialized instance of a recurring
 * task) completes that occurrence directly -- one round trip -- instead of
 * POSTing the parent, receiving a 409 and then completing the occurrence the
 * 409 named. Rows without an occurrence id go through the task endpoint,
 * with `classifyTaskActionError` covering the recurring 409s.
 */
export type CompletionTarget =
  | { kind: "occurrence"; occurrenceId: string }
  | { kind: "task"; taskId: string };

export function completionTarget(row: {
  id: string;
  occurrence_id?: string | null;
}): CompletionTarget {
  if (row.occurrence_id) return { kind: "occurrence", occurrenceId: row.occurrence_id };
  return { kind: "task", taskId: row.id };
}
