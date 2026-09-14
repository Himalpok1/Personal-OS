import { ApiClientError } from "@personal-os/api-client";
import type { NextOccurrence } from "@personal-os/core/recurrence/next-occurrence";
import type { TaskStatus } from "@personal-os/schema";
import { formatFieldLabel } from "@/components/datetime-field-state";

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
 * Snooze via PATCH moves the task's own `due_at`. On a recurring task that is
 * the SERIES anchor, so a "snooze" would re-point every future occurrence --
 * not what the word means. This PATCH-shaped snooze is therefore offered only
 * on open, one-off tasks; a recurring task snoozes its next OCCURRENCE
 * instead (`snoozeTarget`, Checkpoint 9.4).
 */
export function canSnoozeTask(task: { status: TaskStatus; rrule: string | null }): boolean {
  return isTaskOpen(task.status) && task.rrule === null;
}

/**
 * Where a snooze on the detail screen goes (Checkpoint 9.4). A one-off task
 * PATCHes its own due/remind instants (9.3); a recurring task snoozes the
 * occurrence the "Next:" line names -- `snoozed_until` on that row, never
 * the rule or the parent -- and only when that row is known, since an
 * occurrence id is the one thing POST /occurrences/:id/snooze needs.
 */
export type SnoozeTarget =
  | { kind: "task"; taskId: string }
  | { kind: "occurrence"; occurrenceId: string };

export function snoozeTarget(
  task: { id: string; status: TaskStatus; rrule: string | null },
  next: Pick<NextOccurrence, "id"> | null,
): SnoozeTarget | null {
  if (!isTaskOpen(task.status)) return null;
  if (task.rrule === null) return { kind: "task", taskId: task.id };
  if (next === null) return null;
  return { kind: "occurrence", occurrenceId: next.id };
}

/**
 * The "Next: …" line under a recurring task's status (Checkpoint 9.4), from
 * selectNextOccurrence's answer. `overdue` selects the red tone; a snoozed
 * instance says so, because its effective instant is not the one the rule
 * produced. Null when there is no scheduled occurrence to name -- or when the
 * instant will not format, which formatFieldLabel treats as absent rather
 * than rendering "Invalid Date".
 */
export function nextOccurrenceLine(
  next: NextOccurrence | null,
): { text: string; overdue: boolean } | null {
  if (next === null) return null;
  const label = formatFieldLabel(next.effective_at);
  if (label === null) return null;
  return {
    text: `Next: ${label}${next.snoozed ? " · snoozed" : ""}`,
    overdue: next.overdue,
  };
}

/** How far back "Undo" reaches on a recurring task: a week of terminal occurrences. */
export const UNDO_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export interface UndoableOccurrence {
  id: string;
  action: "done" | "skipped";
}

/**
 * The most recently completed or skipped occurrence within UNDO_WINDOW_MS,
 * the one the "Undo Done" / "Undo Skip" chip reopens (POST
 * /occurrences/:id/reopen, Checkpoint 9.4). Latest by `completed_at`, then
 * by id so the choice is a total order. A terminal row without a
 * `completed_at` (never written by this system, but the column is nullable)
 * is not offered: there is no instant to bound it by.
 */
export function selectUndoableOccurrence(
  items: readonly { id: string; status: string; completed_at: string | null }[],
  now: Date,
): UndoableOccurrence | null {
  const floor = now.getTime() - UNDO_WINDOW_MS;
  let best: { id: string; action: "done" | "skipped"; at: number } | null = null;
  for (const item of items) {
    if (item.status !== "done" && item.status !== "skipped") continue;
    if (item.completed_at === null) continue;
    const at = new Date(item.completed_at).getTime();
    if (Number.isNaN(at) || at < floor) continue;
    if (best === null || at > best.at || (at === best.at && item.id > best.id)) {
      best = { id: item.id, action: item.status, at };
    }
  }
  return best === null ? null : { id: best.id, action: best.action };
}

export function undoLabel(action: UndoableOccurrence["action"]): string {
  return action === "done" ? "Undo last Done" : "Undo last Skip";
}

/**
 * Whether the Undo chip may be offered at all: only on an OPEN recurring
 * parent. POST /occurrences/:id/reopen refuses a dropped or archived parent
 * with 409 task_not_open, and a done parent (a series the owner closed with
 * Complete on the parent itself) has no open instance for an undone
 * occurrence to sit beside -- Reopen on the task is the route back there.
 * Offering the chip on those would be a button whose only outcome is a 409.
 */
export function canOfferUndo(task: { status: TaskStatus; rrule: string | null }): boolean {
  return task.rrule !== null && isTaskOpen(task.status);
}

export const UNDO_ALREADY_UNDONE_MESSAGE = "Already undone.";
export const UNDO_REOPEN_TASK_FIRST_MESSAGE = "Reopen the task first.";

/**
 * The detail screen's "No upcoming occurrence" line (Checkpoint 9.4): shown
 * only once the scheduled-occurrence query has LOADED and returned nothing
 * for a recurring task -- never while it is still loading (that would flash
 * a warning on every visit) and never for a one-off. A recurring task with
 * no scheduled row is exactly the state the nightly reconciliation repairs
 * (contract §0) or a broken rule produces, so the copy points at the rule.
 */
export const NO_UPCOMING_OCCURRENCE_MESSAGE = "No upcoming occurrence — check the repeat rule";

export function noUpcomingOccurrenceLine(input: {
  rrule: string | null;
  scheduledLoaded: boolean;
  scheduledCount: number;
}): string | null {
  if (input.rrule === null) return null;
  if (!input.scheduledLoaded) return null;
  return input.scheduledCount === 0 ? NO_UPCOMING_OCCURRENCE_MESSAGE : null;
}

/**
 * Whether the screen's own "Snoozed until …" line -- set locally the moment
 * a snooze succeeds, before any refetch -- should still show. For a one-off
 * task it is the only feedback there is. For a recurring task the "Next:"
 * line names the same instant with " · snoozed" once the occurrence query
 * refetches, at which point the local line would say it twice; so it yields
 * to the Next line as soon as that line reports the snooze.
 */
export function localSnoozeLineVisible(input: {
  snoozedUntil: string | null;
  recurring: boolean;
  next: Pick<NextOccurrence, "snoozed"> | null;
}): boolean {
  if (input.snoozedUntil === null) return false;
  if (!input.recurring) return true;
  return !(input.next?.snoozed ?? false);
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

/**
 * A 409 from an occurrence route on a terminal row. Shared with the
 * reminder-action banner (components/reminder-action-banner-state.ts) so a
 * shade tap and a detail-screen chip that hit the same 409 say the same thing.
 */
export const OCCURRENCE_NOT_OPEN_MESSAGE = "That one has already been completed or skipped.";

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
      // POST /occurrences/:id/reopen (Checkpoint 9.4): the row is already
      // scheduled (a double tap, or undone from another device), or its
      // parent is dropped/archived -- two different things to do next.
      case "occurrence_not_reopenable":
        return { kind: "message", message: UNDO_ALREADY_UNDONE_MESSAGE };
      case "task_not_open":
        return { kind: "message", message: UNDO_REOPEN_TASK_FIRST_MESSAGE };
      // POST /occurrences/:id/snooze on a terminal row.
      case "occurrence_not_open":
        return { kind: "message", message: OCCURRENCE_NOT_OPEN_MESSAGE };
      case "invalid_status_transition":
        return { kind: "message", message: "This task can't be started from its current state." };
      default:
        return { kind: "message", message: GENERIC_TASK_ACTION_MESSAGE };
    }
  }
  return { kind: "message", message: GENERIC_TASK_ACTION_MESSAGE };
}

/**
 * The banner for a failed snooze. A 400 from POST /occurrences/:id/snooze
 * means the target fell outside (now, now + MAX_SNOOZE_DAYS] -- not reachable
 * from the three chips, but named rather than folded into "try again"; the
 * 409 and 404 cases share classifyTaskActionError's wording.
 */
export const GENERIC_SNOOZE_MESSAGE = "Couldn't snooze this task. Please try again.";

export function classifySnoozeError(err: unknown): string {
  if (err instanceof ApiClientError && err.code === "validation_failed") {
    return "Couldn't snooze to that time.";
  }
  if (err instanceof ApiClientError && (err.status === 404 || err.status === 409)) {
    const failure = classifyTaskActionError(err);
    return failure.kind === "message" ? failure.message : GENERIC_SNOOZE_MESSAGE;
  }
  return GENERIC_SNOOZE_MESSAGE;
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

/**
 * The detail screen's version (Checkpoint 9.4): a `Task` carries no
 * occurrence id, but the screen has already asked for the next scheduled
 * occurrence to draw the "Next:" line, so Complete and Skip act on THAT row
 * directly when it is known. Otherwise the task endpoint, whose recurring
 * 409 still resolves through classifyTaskActionError.
 */
export function detailCompletionTarget(
  task: { id: string; rrule: string | null },
  next: Pick<NextOccurrence, "id"> | null,
): CompletionTarget {
  if (task.rrule !== null && next !== null) return { kind: "occurrence", occurrenceId: next.id };
  return { kind: "task", taskId: task.id };
}
