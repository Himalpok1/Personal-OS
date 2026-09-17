// The CLOSED Focus Now reason vocabulary and its frozen point tables
// (Checkpoint 10.4, ADR-072; extended by Checkpoint 10.6, ADR-075).
//
// This is a LEAF module on purpose: `score.ts` needs the context point table
// at scoring time and `explain.ts` needs `score.ts`'s candidate shape, so
// the vocabulary both depend on lives below both of them rather than in
// either -- a runtime import cycle between two modules that read each
// other's tables at evaluation time is exactly the kind of order-dependent
// bug a pure module must not carry. `score.ts` and `explain.ts` re-export
// everything here, so a consumer never has to import this file directly.
//
// ===========================================================================
// THE VOCABULARY IS ONE FROZEN ORDER, IN THREE TIERS
// ===========================================================================
//
//   1. academic's own six   (packages/core/src/academic/urgency.ts, ADR-071):
//        overdue · due_within_24h · due_this_week · marked_missing ·
//        marked_late · high_points
//   2. the task-only reason (ADR-072): top_priority
//   3. the six CONTEXT reasons (ADR-075):
//        linked_assignment · project_stalled · course_attention_high ·
//        no_submission · reminder_set · snoozed
//
// `sortReasons` dedupes and orders any list by this table, so a candidate's
// `reasons` is byte-identical for identical inputs no matter which order the
// scorer, the wrapper and the merge happened to push them in.
//
// ===========================================================================
// CONTEXT POINTS: THREE BONUSES, THREE INFORMATIONAL ZEROS
// ===========================================================================
//
// The 10.6 brief's rule is "a task becomes more important when: task +
// upcoming deadline + connected course/project + no progress". The three
// CONNECTION reasons therefore carry a bonus on ADR-071's additive scale --
// +25, the same weight as `marked_late` / `high_points` / `top_priority`, so
// a connection is worth exactly one extra additive reason and never
// outranks an urgency rung on its own (the rungs are 100 apart):
//
//   linked_assignment      +25   a task the owner explicitly linked to a
//                                Canvas assignment (tasks.canvas_assignment_id,
//                                ADR-074) -- the two rows collapse into one
//   project_stalled        +25   the task's project has had no activity for
//                                14 days (docs/ARCHITECTURE.md rule 8)
//   course_attention_high  +25   the assignment's course is at attention
//                                level `high` (ADR-071)
//
// The other three are INFORMATIONAL ONLY -- they explain a row without
// moving it, because none of them is evidence that the item matters MORE:
//
//   no_submission           0   Canvas records no submission (this is the
//                                default state of every open assignment)
//   reminder_set            0   a reminder is scheduled (the owner already
//                                arranged to be told)
//   snoozed                 0   the owner deliberately deferred it
//
// Zero-point reasons are listed in `reasons` and rendered by `explain.ts`
// but never enter a score or the equation, so adding one can never reorder
// a list -- the same "a weight change is a diff to ONE table" discipline
// ADR-065 set for search scoring.

import { ACADEMIC_PRIORITY_REASONS, type AcademicPriorityReason } from "../academic/urgency.js";

/**
 * The one task-only reason from ADR-072: Personal OS's priority convention
 * is LOWER value = HIGHER priority (docs/ARCHITECTURE.md "Today & agenda
 * read models" rule 6; P1 is the top rung), an unconstrained nullable
 * smallint historically written only by AI capture, so `priority === 1` is
 * the one value worth rewarding rather than trying to rank the whole range.
 */
export const FOCUS_NOW_TASK_REASON = "top_priority" as const;

/** `priority === FOCUS_NOW_TOP_PRIORITY` (P1) is what `top_priority` rewards. */
export const FOCUS_NOW_TOP_PRIORITY = 1;
/** Same additive scale as academic's own `marked_late`/`high_points` (ADR-071). */
export const FOCUS_NOW_TOP_PRIORITY_POINTS = 25;

/** The six context reasons (ADR-075), in vocabulary order. */
export const FOCUS_NOW_CONTEXT_REASONS = [
  "linked_assignment",
  "project_stalled",
  "course_attention_high",
  "no_submission",
  "reminder_set",
  "snoozed",
] as const;
export type FocusNowContextReason = (typeof FOCUS_NOW_CONTEXT_REASONS)[number];

/** The frozen context point table (see the module comment for each row's rationale). */
export const FOCUS_NOW_CONTEXT_POINTS: Readonly<Record<FocusNowContextReason, number>> = {
  linked_assignment: 25,
  project_stalled: 25,
  course_attention_high: 25,
  no_submission: 0,
  reminder_set: 0,
  snoozed: 0,
};

/** The full closed vocabulary a Focus Now row can carry. */
export type FocusNowReason =
  AcademicPriorityReason | typeof FOCUS_NOW_TASK_REASON | FocusNowContextReason;

/** The one frozen order every `reasons` list is sorted by: academic's six, then the task reason, then context. */
export const FOCUS_NOW_REASON_ORDER: readonly FocusNowReason[] = [
  ...ACADEMIC_PRIORITY_REASONS,
  FOCUS_NOW_TASK_REASON,
  ...FOCUS_NOW_CONTEXT_REASONS,
];

const REASON_RANK: ReadonlyMap<FocusNowReason, number> = new Map(
  FOCUS_NOW_REASON_ORDER.map((reason, index) => [reason, index]),
);

/**
 * Dedupes and orders a reasons list by `FOCUS_NOW_REASON_ORDER`, returning a
 * NEW array (the input is never mutated), so identical inputs -- in any
 * push order -- are byte-identical.
 */
export function sortReasons(reasons: readonly FocusNowReason[]): FocusNowReason[] {
  const unique = [...new Set(reasons)];
  return unique.sort((a, b) => (REASON_RANK.get(a) ?? 0) - (REASON_RANK.get(b) ?? 0));
}

/**
 * Where a piece of Focus Now evidence came from -- the closed source
 * vocabulary an explanation names so the client can say "this came from
 * Canvas" / "this came from your reminder" without inspecting the reason.
 */
export const FOCUS_NOW_SOURCES = [
  "task",
  "reminder",
  "project",
  "canvas_assignment",
  "course",
  "calendar",
] as const;
export type FocusNowSource = (typeof FOCUS_NOW_SOURCES)[number];
