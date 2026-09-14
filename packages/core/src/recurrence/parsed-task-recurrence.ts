import { validateEventRecurrenceRule, validateRecurrenceRule } from "./validation.js";

/**
 * The recurrence-bearing subset of the capture parser's `create_task`
 * arguments (CreateTaskToolSchema in packages/schema). Declared structurally
 * here because packages/core sits BELOW packages/schema in the dependency
 * graph and cannot import the tool-call types.
 */
export interface ParsedTaskRecurrenceArgs {
  rrule?: string | null;
  recurrence_anchor?: "due_date" | "completion_date" | null;
  recurrence_timezone?: string | null;
}

export interface ResolvedParsedTaskRecurrence {
  rrule: string;
  recurrenceAnchor: "due_date" | "completion_date";
  recurrenceTimezone: string;
}

/**
 * The defaulting a parsed `create_task` gets when it is committed -- the same
 * rules POST /tasks applies (apps/api/src/routes/tasks.ts): a rule with no
 * stated anchor is due_date-anchored, and a rule with no stated zone recurs
 * in the capture's own timezone. A tool call with no rule carries no
 * recurrence at all, whatever else the parser sent.
 *
 * ONE function, shared by the committability check and the commit itself, so
 * the two cannot disagree about which rule is being judged.
 */
export function resolveParsedTaskRecurrence(
  args: ParsedTaskRecurrenceArgs,
  captureTimezone: string,
): ResolvedParsedTaskRecurrence | null {
  if (!args.rrule) return null;
  return {
    rrule: args.rrule,
    recurrenceAnchor: args.recurrence_anchor ?? "due_date",
    recurrenceTimezone: args.recurrence_timezone ?? captureTimezone,
  };
}

/**
 * Throws if the parsed task's recurrence, as it WOULD be committed, cannot be
 * materialized: an rrule rrulestr does not parse (the parser is free text in,
 * free text out -- "every monday" is a real observed shape), an INTERVAL the
 * expansion cannot iterate, a BY* part on a completion-anchored rule, or an
 * IANA zone Intl does not know. CreateTaskToolSchema validates none of these
 * (rrule and recurrence_timezone are bare strings there), so before
 * Checkpoint 9.3 the first thing to reject a bad rule was the window
 * expansion inside the commit -- AFTER the task row was inserted, outside any
 * transaction, on every one of pg-boss's retries.
 */
export function validateParsedTaskRecurrence(
  args: ParsedTaskRecurrenceArgs,
  captureTimezone: string,
): void {
  const resolved = resolveParsedTaskRecurrence(args, captureTimezone);
  if (!resolved) return;
  validateRecurrenceRule({
    rrule: resolved.rrule,
    recurrenceTimezone: resolved.recurrenceTimezone,
    recurrenceAnchor: resolved.recurrenceAnchor,
    isTask: true,
  });
}

/**
 * The recurrence half of "can this parsed tool call be committed?" -- the
 * companion to packages/schema's `isCommittableToolCall`, which answers the
 * structural half (an `unclear` call has no entity to create) and is
 * client-reachable, whereas this one needs rrulestr and therefore lives
 * server-side. `POST /inbox/:id/confirm` and the worker's confirm path both
 * ask both questions before a commit is attempted (ADR-060: a 202 means a
 * commit WILL be attempted, never that doomed work was accepted).
 *
 * `create_task` and (since Checkpoint 9.5) `create_event` carry a recurrence
 * the commit materializes; every other tool is committable as far as this
 * check is concerned. An event rule is judged by the same grammar POST
 * /events applies (validateEventRecurrenceRule, in the capture's own zone
 * because commit-parsed-entity recurs an event there). The boolean
 * deliberately carries no reason: the refusal it feeds is token-only, and the
 * error message would embed the parser-authored rule text.
 */
export function hasCommittableRecurrence(
  call: { tool: string; args?: unknown },
  captureTimezone: string,
): boolean {
  if (call.tool !== "create_task" && call.tool !== "create_event") return true;
  if (typeof call.args !== "object" || call.args === null) return false;
  try {
    // `args` is an object here; the fields this reads are all optional, so an
    // object of any other shape is simply a task/event with no recurrence.
    if (call.tool === "create_event") {
      const rrule = (call.args as { rrule?: unknown }).rrule;
      if (typeof rrule === "string" && rrule.trim() !== "") {
        validateEventRecurrenceRule(rrule, captureTimezone);
      }
      return true;
    }
    validateParsedTaskRecurrence(call.args, captureTimezone);
    return true;
  } catch {
    return false;
  }
}
