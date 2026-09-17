// The CLOSED Focus Now reason vocabulary and its frozen point tables
// (Checkpoint 10.4, ADR-072; extended by Checkpoint 10.6, ADR-075, and by
// Checkpoint 10.7, ADR-077 §5).
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
//   4. the two MEMORY reasons (ADR-077 §5), last of the context tier:
//        matches_preference · supports_goal
//
// `sortReasons` dedupes and orders any list by this table, so a candidate's
// `reasons` is byte-identical for identical inputs no matter which order the
// scorer, the wrapper and the merge happened to push them in.
//
// ===========================================================================
// CONTEXT POINTS: THREE +25 BONUSES, THREE INFORMATIONAL ZEROS, TWO +15 MEMORY
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
//
// The two MEMORY reasons (ADR-077 §5) sit BELOW the +25 tier on purpose:
//
//   matches_preference     +15   a saved `preference`/`fact` memory is linked
//                                (memories.project_id / canvas_course_id,
//                                by id equality only -- packages/core/src/
//                                memory/match.ts) to the row's project or
//                                the assignment's course
//   supports_goal          +15   a saved `goal` memory is linked to the row's
//                                project
//
// +15 is less than any single connection bonus and an order of magnitude
// below an urgency rung (the rungs are 100 apart), so memory can reorder
// two otherwise-equal rows and can never, on its own, lift a row past one
// due sooner. And the WHOLE context tier is capped at the pre-10.7 maximum
// (`FOCUS_NOW_CONTEXT_POINTS_CAP`, 75 = the three +25 connection bonuses):
// a fully stacked merged row -- linked assignment + stalled project +
// high-attention course + both memory reasons, 105 uncapped -- tops out at
// 75, so the strongest possible row (a P1 task, base 325) still lands at
// exactly 400, the 10.6 ceiling: it can at most TIE a bare overdue task and
// loses that tie on due-at. Memory may reorder rows within a rung; the
// row's ceiling is unchanged by 10.7. Each is earned at most ONCE per row -- `match.ts` returns at
// most one memory per reason and `score.ts`'s merge counts a reason once --
// so ten linked memories are worth exactly what one is. When the global
// memory switch is off the composers receive no memory at all and neither
// reason can appear (ADR-077 §7).

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

/** The six context reasons (ADR-075) then the two memory reasons (ADR-077), in vocabulary order. */
export const FOCUS_NOW_CONTEXT_REASONS = [
  "linked_assignment",
  "project_stalled",
  "course_attention_high",
  "no_submission",
  "reminder_set",
  "snoozed",
  "matches_preference",
  "supports_goal",
] as const;
export type FocusNowContextReason = (typeof FOCUS_NOW_CONTEXT_REASONS)[number];

/** The two memory reasons' bonus (ADR-077 §5): below the +25 context tier, far below any urgency rung. */
export const FOCUS_NOW_MEMORY_POINTS = 15;

/** The two reasons a saved memory can add (ADR-077 §5); a subset of `FOCUS_NOW_CONTEXT_REASONS`. */
export const FOCUS_NOW_MEMORY_REASONS = ["matches_preference", "supports_goal"] as const;
export type FocusNowMemoryReason = (typeof FOCUS_NOW_MEMORY_REASONS)[number];

/**
 * The ceiling on a row's TOTAL context points (connection tier + memory,
 * after the merge union). 75 is the pre-10.7 maximum context sum (three +25
 * connection bonuses); memory may reorder within a rung but the row's
 * ceiling is unchanged by 10.7 -- a fully stacked P1 merged row is still
 * 325 + 75 = 400 and can never exceed a bare overdue task (ADR-077 §5, for
 * the whole row).
 */
export const FOCUS_NOW_CONTEXT_POINTS_CAP = 75;

/** The frozen context point table (see the module comment for each row's rationale). */
export const FOCUS_NOW_CONTEXT_POINTS: Readonly<Record<FocusNowContextReason, number>> = {
  linked_assignment: 25,
  project_stalled: 25,
  course_attention_high: 25,
  no_submission: 0,
  reminder_set: 0,
  snoozed: 0,
  matches_preference: FOCUS_NOW_MEMORY_POINTS,
  supports_goal: FOCUS_NOW_MEMORY_POINTS,
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
 * Canvas" / "this came from your reminder" / "this came from your memory"
 * without inspecting the reason. `memory` (ADR-077) is a saved memory the
 * owner wrote or accepted -- never a model, never an inference.
 */
export const FOCUS_NOW_SOURCES = [
  "task",
  "reminder",
  "project",
  "canvas_assignment",
  "course",
  "calendar",
  "memory",
] as const;
export type FocusNowSource = (typeof FOCUS_NOW_SOURCES)[number];
