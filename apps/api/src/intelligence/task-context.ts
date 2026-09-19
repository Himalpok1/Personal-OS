// Checkpoint 10.9 -- `buildTaskContext`: the `get_task_context` read tool's
// implementation (ADR-081 §5), written to `buildTodayContext`'s rules:
//
//   - `assertGrant` FIRST, before any read (ask/authorize.ts).
//   - Reads ONLY through read-models/task-context.ts, which selects the
//     task's schedule columns and derives `recurring` / `canvas_linked` as
//     booleans in SQL -- the body, the rrule text and the assignment id are
//     never selected, so this file cannot leak what it never receives.
//   - Output is `GetTaskContextOutputSchema` (`.strict()`, id-carrying,
//     body-free); every instant is an ISO string with offset, never a
//     wall-clock guess -- the agent receives data, not prose.
//   - `null` when the id names no row; an ARCHIVED row is returned with
//     `archived: true` -- "archived" and "unknown" are different answers for
//     an agent that holds a stale id (ADR-078's executor makes the same
//     distinction).
//   - Never writes, never logs (Guard 4).
import {
  stripUnsummarizableCharacters,
  truncateAtWordBoundary,
} from "@personal-os/core/mail/provider-strings";
import {
  GetTaskContextOutputSchema,
  TODAY_CONTEXT_TITLE_MAX_CHARS,
  type GetTaskContextOutput,
  type ReadToolInput,
} from "@personal-os/schema";
import { assertGrant } from "../ask/authorize.js";
import { loadTaskContextRow } from "../read-models/task-context.js";
import type { ReadContext } from "./read-context.js";

export type GetTaskContextInput = ReadToolInput<"get_task_context">;

function bound(value: string | null | undefined, cap: number): string {
  return truncateAtWordBoundary(stripUnsummarizableCharacters(value) ?? "", cap) ?? "";
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/**
 * `get_task_context`: one task's schedule, project and open occurrences by
 * id, or `null` when no such row exists. `input` is expected to have passed
 * `GetTaskContextInputSchema` (a uuid); the gateway parses it.
 */
export async function buildTaskContext(
  ctx: ReadContext,
  input: GetTaskContextInput,
): Promise<GetTaskContextOutput | null> {
  assertGrant(ctx.grant);

  const row = await loadTaskContextRow(ctx.db, input.id);
  if (row === null) return null;

  return GetTaskContextOutputSchema.parse({
    id: row.task.id,
    title: bound(row.task.title, TODAY_CONTEXT_TITLE_MAX_CHARS),
    status: row.task.status,
    priority: row.task.priority,
    due_at: isoOrNull(row.task.dueAt),
    remind_at: isoOrNull(row.task.remindAt),
    completed_at: isoOrNull(row.task.completedAt),
    archived: row.task.archivedAt !== null,
    recurring: row.task.recurring,
    project:
      row.project === null
        ? null
        : { id: row.project.id, name: bound(row.project.name, TODAY_CONTEXT_TITLE_MAX_CHARS) },
    canvas_linked: row.task.canvasLinked,
    open_occurrences: row.openOccurrences.map((occurrence) => ({
      id: occurrence.id,
      occurs_at: occurrence.occursAt.toISOString(),
      status: occurrence.status,
      snoozed_until: isoOrNull(occurrence.snoozedUntil),
    })),
    open_occurrences_total: row.openOccurrencesTotal,
    updated_at: row.task.updatedAt.toISOString(),
  });
}
