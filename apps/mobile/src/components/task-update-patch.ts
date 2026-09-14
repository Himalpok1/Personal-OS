import type { Task, TaskUpdate } from "@personal-os/schema";
import {
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";

/**
 * The PATCH body the task edit screen sends (Checkpoint 9.4), built as a DIFF
 * against the loaded task rather than a dump of every form field.
 *
 * Why a diff. The API's PATCH /tasks/:id treats the recurrence columns and
 * `due_at` as a series edit: an rrule in the body -- even the same one --
 * used to delete and re-expand every scheduled occurrence, which also threw
 * away any per-occurrence snooze (contract §4). The server now skips the
 * regeneration when the effective rule is unchanged, but the client should
 * not depend on that: a title-only edit sends only title/body/project, and
 * the recurrence fields travel together only when the repeat actually
 * changed, so the two sides agree on what "unchanged" means.
 *
 * Pure and testable: everything here is derived from the loaded Task and the
 * form's values; nothing reads a clock or a device setting.
 */

export interface TaskEditForm {
  title: string;
  body: string;
  dueAt: string | null;
  remindAt: string | null;
  projectId: string | undefined;
  recurrence: RecurrenceEditorState;
}

/**
 * True when two ISO strings name the same instant (or are both null). A
 * picker re-serializes with the zone's offset ("…T09:00:00-05:00") while the
 * API returns UTC ("…T14:00:00.000Z"), so the comparison is on epoch
 * milliseconds; an unparseable value compares by string, so a stored
 * free-text oddity round-trips as "unchanged" rather than as a rewrite.
 */
export function sameInstant(a: string | null, b: string | null): boolean {
  if (a === null || b === null) return a === b;
  const ams = Date.parse(a);
  const bms = Date.parse(b);
  if (Number.isNaN(ams) || Number.isNaN(bms)) return a === b;
  return ams === bms;
}

/**
 * Canonical form of an RRULE for equality: case-insensitive, without the
 * optional `RRULE:` prefix, without an explicit `INTERVAL=1` -- which the
 * editor never writes but a stored rule may carry -- and with the parts
 * SORTED, so `BYDAY=TU;FREQ=WEEKLY` and `FREQ=WEEKLY;BYDAY=TU` are one rule.
 * Mirrors the server's own normalisation in PATCH /tasks/:id
 * (apps/api/src/routes/task-recurrence-diff.ts, contract §4 branch F) part
 * for part, which is what makes "both sides agree on unchanged" true rather
 * than merely claimed: a client that judged an order-swapped rule unchanged
 * while the server regenerated would drop every occurrence snooze silently.
 */
export function normalizeRrule(rrule: string | null): string | null {
  if (rrule === null) return null;
  const parts = rrule
    .trim()
    .replace(/^RRULE:/i, "")
    .toUpperCase()
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part !== "INTERVAL=1");
  parts.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return parts.join(";");
}

export interface RecurrenceSnapshot {
  rrule: string | null;
  recurrence_timezone: string | null;
  recurrence_anchor: "due_date" | "completion_date" | null;
  recurrence_until: string | null;
  recurrence_count: number | null;
}

function snapshotOfTask(task: Task): RecurrenceSnapshot {
  return {
    rrule: task.rrule,
    recurrence_timezone: task.rrule ? task.recurrence_timezone : null,
    recurrence_anchor: task.rrule ? task.recurrence_anchor : null,
    recurrence_until: task.rrule ? task.recurrence_until : null,
    recurrence_count: task.rrule ? task.recurrence_count : null,
  };
}

function snapshotOfForm(form: TaskEditForm, task: Task): RecurrenceSnapshot {
  const serialized = serializeEditorStateToRRule(form.recurrence);
  return {
    rrule: serialized.rrule,
    // A rule always carries a zone. The editor state has one whenever it was
    // parsed from a task (defaultTimezone) or built by a preset, so the
    // fallback is belt and braces rather than a path the UI reaches.
    recurrence_timezone: serialized.rrule
      ? (serialized.recurrence_timezone ?? task.recurrence_timezone ?? task.timezone)
      : null,
    recurrence_anchor: serialized.recurrence_anchor,
    recurrence_until: serialized.recurrence_until
      ? serialized.recurrence_until.toISOString()
      : null,
    recurrence_count: serialized.recurrence_count,
  };
}

export function recurrenceChanged(before: RecurrenceSnapshot, after: RecurrenceSnapshot): boolean {
  if (normalizeRrule(before.rrule) !== normalizeRrule(after.rrule)) return true;
  // With no rule on either side the remaining columns are all null-by-
  // construction, so nothing else can differ.
  if (before.rrule === null && after.rrule === null) return false;
  return (
    before.recurrence_timezone !== after.recurrence_timezone ||
    (before.recurrence_anchor ?? "due_date") !== (after.recurrence_anchor ?? "due_date") ||
    !sameInstant(before.recurrence_until, after.recurrence_until) ||
    before.recurrence_count !== after.recurrence_count
  );
}

/**
 * The body for PATCH /tasks/:id. Title, notes and project are always sent
 * (the pre-9.4 behaviour, and cheap for the server); `due_at` and
 * `remind_at` only when their instant changed; the five recurrence fields
 * only -- and always together -- when the repeat changed.
 */
export function buildTaskUpdatePatch(loaded: Task, form: TaskEditForm): TaskUpdate {
  const patch: TaskUpdate = {
    title: form.title.trim() || undefined,
    body: form.body.trim(),
    project_id: form.projectId ?? null,
  };

  if (!sameInstant(loaded.due_at, form.dueAt)) patch.due_at = form.dueAt;
  if (!sameInstant(loaded.remind_at, form.remindAt)) patch.remind_at = form.remindAt;

  const before = snapshotOfTask(loaded);
  const after = snapshotOfForm(form, loaded);
  if (recurrenceChanged(before, after)) {
    patch.rrule = after.rrule;
    patch.recurrence_timezone = after.recurrence_timezone;
    patch.recurrence_anchor = after.recurrence_anchor;
    patch.recurrence_until = after.recurrence_until;
    patch.recurrence_count = after.recurrence_count;
  }

  return patch;
}
