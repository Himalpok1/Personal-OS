// "Focus Now" -- a deterministic, client-side merge of personal urgent tasks
// (Today's overdue / due-today buckets) and already-ranked academic priority
// items (the academic Today read model's `priorities` section, Checkpoint
// 10.3) into ONE ranked, capped, explainable list (Checkpoint 10.4, ADR-072;
// context scoring and the linked-assignment dedupe added by Checkpoint 10.6,
// ADR-075).
//
// Pure, total functions, no clock read (the caller passes `effectiveNow` and,
// for a task, the same `horizonEndUtc` `academicTodayWindows` computes), no
// database, no Node builtin -- this module ships to the Expo bundle through
// the `./focus-now/*` subpath like `./academic/*` and is never re-exported
// from core's root barrel.
//
// WHY THIS LIVES HERE AND NOT SERVER-SIDE: `apps/api/src/ask/
// ai-egress-guard.test.ts`'s Guard 5 forbids every file under
// `apps/api/src/read-models/` (today.ts included) from importing the
// academic read model at all -- a deliberate privacy wall (docs/ARCHITECTURE
// "Personal intelligence" / ADR-046's posture, extended to Canvas by
// ADR-070). A server-side merge of `/today` and `/academic/today` is
// therefore off the table structurally. This module is the client-side
// composition instead, mirroring the ONE other permitted client derivation
// (the course detail screen's own urgency-against-`dataUpdatedAt`,
// `components/academic/assignment-urgency.ts`) rather than inventing a new
// exception.
//
// ===========================================================================
// A SCORE IS TWO NUMBERS: A BASE AND A CONTEXT BONUS
// ===========================================================================
//
//   score = baseScore + contextPoints
//
//   baseScore      a TASK: the urgency ladder + `top_priority`, scored here
//                  an ASSIGNMENT: the SERVER's own `AcademicPriorityItem.score`,
//                  taken VERBATIM
//   contextPoints  Σ FOCUS_NOW_CONTEXT_POINTS[reason] over the context
//                  reasons (reasons.ts): +25 for a linked assignment, a
//                  stalled project or a high-attention course; 0 for the
//                  informational ones
//
// THIS MODULE NEVER RE-DERIVES AN ACADEMIC SCORE. An academic candidate's
// `baseScore`/urgency reasons are taken verbatim from the server's own
// `scoreAcademicPriority` (packages/core/src/academic/urgency.ts); the
// context bonus is ADDED ON TOP and reported SEPARATELY (`contextPoints`),
// so the server's number is still readable on the row and ADR-072 §4 holds
// unchanged -- only a PERSONAL TASK is scored here, on the SAME base-point
// table and the SAME urgency ladder (`deriveUrgency`, reused rather than
// reimplemented), so the two domains sit on one comparable total order.
//
// ===========================================================================
// A TASK LINKED TO AN ASSIGNMENT IS ONE ROW, NOT TWO (ADR-075)
// ===========================================================================
//
// `tasks.canvas_assignment_id` (ADR-074) is the one explicit, owner-written
// relationship between the two domains. When a task candidate's link names
// an academic candidate in the SAME list, `mergeLinkedCandidates` collapses
// them into ONE row of kind `task` -- the task is the thing the owner can act
// on in-app -- keeping the stronger base, summing the context bonuses,
// adding `linked_assignment` (+25) and the union of both reasons lists. A
// link that points at an assignment NOT in the list is left alone: there is
// nothing in this list to link to, so no bonus and no reason.
import {
  ACADEMIC_URGENCY_BASE_POINTS,
  compareAcademicPriorities,
  deriveUrgency,
  rankAcademicPriorities,
  type AcademicPriorityCandidate,
  type AcademicPriorityReason,
  type AcademicUrgency,
} from "../academic/urgency.js";
import {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_TASK_REASON,
  FOCUS_NOW_TOP_PRIORITY,
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowReason,
} from "./reasons.js";

// The vocabulary and its tables live in reasons.ts (a leaf, see its header);
// re-exported here so every pre-10.6 import of this module keeps resolving.
export {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_CONTEXT_REASONS,
  FOCUS_NOW_REASON_ORDER,
  FOCUS_NOW_SOURCES,
  FOCUS_NOW_TASK_REASON,
  FOCUS_NOW_TOP_PRIORITY,
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowReason,
  type FocusNowSource,
} from "./reasons.js";

/** What kind of thing a Focus Now row represents. */
export type FocusNowKind = "task" | "event" | "academic_assignment";

/** At most this many rows survive `rankFocusNowCandidates(...).slice(0, FOCUS_NOW_CAP)`. */
export const FOCUS_NOW_CAP = 5;

/** One ranked "what should I focus on right now?" candidate, from either domain. */
export interface FocusNowCandidate {
  id: string;
  kind: FocusNowKind;
  title: string;
  dueAt: Date | null;
  /** A task: the urgency ladder + top_priority. An assignment: the server's own score, verbatim. */
  baseScore: number;
  /** Σ FOCUS_NOW_CONTEXT_POINTS over the context reasons carried. */
  contextPoints: number;
  /** `baseScore + contextPoints` -- what the ranking compares. */
  score: number;
  /** The full vocabulary list, deduped and in `FOCUS_NOW_REASON_ORDER`. */
  reasons: FocusNowReason[];
  /** A task's `tasks.canvas_assignment_id` (ADR-074); null for an unlinked task and for every assignment. */
  linkedAssignmentId: string | null;
}

/** Σ FOCUS_NOW_CONTEXT_POINTS over a list of context reasons. */
function contextPointsFor(reasons: readonly FocusNowContextReason[]): number {
  return reasons.reduce((sum, reason) => sum + FOCUS_NOW_CONTEXT_POINTS[reason], 0);
}

// ---------------------------------------------------------------------------
// Scoring a personal task
// ---------------------------------------------------------------------------

export interface FocusNowTaskInput {
  id: string;
  title: string;
  dueAt: Date | null;
  /** Personal OS's priority convention: lower value = higher priority; null means unset. */
  priority: number | null;
  /** `tasks.canvas_assignment_id` (ADR-074); the dedupe key `mergeLinkedCandidates` matches on. */
  canvasAssignmentId?: string | null;
  /** `tasks.remind_at` (or the occurrence's derived reminder); non-null adds the informational `reminder_set`. */
  remindAt?: Date | null;
  /** `occurrences.snoozed_until` / a snoozed one-off (ADR-063); non-null adds the informational `snoozed`. */
  snoozedUntil?: Date | null;
  /** The task's project is stalled (docs/ARCHITECTURE.md rule 8); true adds `project_stalled` (+25). */
  projectStalled?: boolean;
}

export interface FocusNowTaskScore {
  urgency: AcademicUrgency;
  baseScore: number;
  contextPoints: number;
  score: number;
  reasons: FocusNowReason[];
}

/**
 * The reason an urgency contributes to a TASK's score, reusing academic's own
 * closed vocabulary so a critical task and a critical assignment explain
 * themselves identically ("Overdue", "Due <24h", "This week"). `urgency.ts`'s
 * own `URGENCY_REASON` table is private to that module, so this is the
 * smallest possible re-statement of it, not a re-derivation of the ladder
 * itself (which is reused via `deriveUrgency`, below).
 */
const TASK_URGENCY_REASON: Readonly<Record<AcademicUrgency, AcademicPriorityReason | null>> = {
  critical: "overdue",
  high: "due_within_24h",
  medium: "due_this_week",
  low: null,
};

/**
 * Scores a personal task on the SAME ladder `packages/core/src/academic/
 * urgency.ts` uses for an assignment: `deriveUrgency` decides critical / high
 * / medium / low from `dueAt` against `effectiveNow` and `horizonEndUtc`; an
 * undated task (`dueAt === null`) is never urgent and scores at the `low`
 * floor, exactly as academic's own "undated is never urgent" rule reads for
 * an assignment. In today's actual wiring only `critical` and `high` are
 * ever reachable (Today's `overdue`/`due_today` buckets never hand this
 * function anything due more than 24h out), but the function itself stays
 * total and general, like the ladder it reuses.
 *
 * The base is the ladder + `top_priority`; the context reasons (reasons.ts)
 * stack on top and are reported separately as `contextPoints`.
 */
export function scoreFocusNowTask(
  input: FocusNowTaskInput,
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowTaskScore {
  const urgency = deriveUrgency(input.dueAt, effectiveNow, horizonEndUtc) ?? "low";
  const reasons: FocusNowReason[] = [];
  let baseScore = ACADEMIC_URGENCY_BASE_POINTS[urgency];
  const urgencyReason = TASK_URGENCY_REASON[urgency];
  if (urgencyReason !== null) reasons.push(urgencyReason);
  if (input.priority !== null && input.priority <= FOCUS_NOW_TOP_PRIORITY) {
    reasons.push(FOCUS_NOW_TASK_REASON);
    baseScore += FOCUS_NOW_TOP_PRIORITY_POINTS;
  }

  const context: FocusNowContextReason[] = [];
  if (input.projectStalled === true) context.push("project_stalled");
  if (input.remindAt !== undefined && input.remindAt !== null) context.push("reminder_set");
  if (input.snoozedUntil !== undefined && input.snoozedUntil !== null) context.push("snoozed");
  const contextPoints = contextPointsFor(context);

  return {
    urgency,
    baseScore,
    contextPoints,
    score: baseScore + contextPoints,
    reasons: sortReasons([...reasons, ...context]),
  };
}

/** A scored personal-task candidate, ready to rank alongside an academic one. */
export function focusNowCandidateFromTask(
  input: FocusNowTaskInput,
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowCandidate {
  const { baseScore, contextPoints, score, reasons } = scoreFocusNowTask(
    input,
    effectiveNow,
    horizonEndUtc,
  );
  return {
    id: input.id,
    kind: "task",
    title: input.title,
    dueAt: input.dueAt,
    baseScore,
    contextPoints,
    score,
    reasons,
    linkedAssignmentId: input.canvasAssignmentId ?? null,
  };
}

// ---------------------------------------------------------------------------
// Wrapping an already-scored academic priority item -- never re-derived
// ---------------------------------------------------------------------------

export interface FocusNowAcademicInput {
  id: string;
  title: string;
  dueAt: Date | null;
  /** The server's own `AcademicPriorityItem.score`, taken verbatim. */
  score: number;
  /** The server's own `AcademicPriorityItem.reasons`, taken verbatim. */
  reasons: readonly AcademicPriorityReason[];
  /** Canvas records no submission (`submission.status === "unsubmitted"`); true adds the informational `no_submission`. */
  submissionUnsubmitted?: boolean;
  /** The assignment's course is at attention level `high` (ADR-071); true adds `course_attention_high` (+25). */
  courseAttentionHigh?: boolean;
}

/**
 * Wraps an already-ranked academic priority item as a Focus Now candidate.
 * `score`/`reasons` are copied verbatim, never recomputed: the server's
 * score becomes `baseScore` untouched, and only the context bonus is added
 * on top, reported separately as `contextPoints`.
 */
export function focusNowCandidateFromAcademic(input: FocusNowAcademicInput): FocusNowCandidate {
  const context: FocusNowContextReason[] = [];
  if (input.courseAttentionHigh === true) context.push("course_attention_high");
  if (input.submissionUnsubmitted === true) context.push("no_submission");
  const contextPoints = contextPointsFor(context);
  return {
    id: input.id,
    kind: "academic_assignment",
    title: input.title,
    dueAt: input.dueAt,
    baseScore: input.score,
    contextPoints,
    score: input.score + contextPoints,
    reasons: sortReasons([...input.reasons, ...context]),
    linkedAssignmentId: null,
  };
}

// ---------------------------------------------------------------------------
// Dedupe: a task linked to an assignment in the same list is ONE row
// ---------------------------------------------------------------------------

/**
 * Collapses every `kind: "task"` candidate whose `linkedAssignmentId` names a
 * `kind: "academic_assignment"` candidate in the SAME list into ONE row of
 * kind `task` (the task is what the owner can act on in-app), and drops the
 * academic row:
 *
 *   id / title            the task's
 *   dueAt                 the task's, falling back to the assignment's
 *   baseScore             max(task.baseScore, academic.baseScore)
 *   contextPoints         task.contextPoints + academic.contextPoints
 *                         + FOCUS_NOW_CONTEXT_POINTS.linked_assignment
 *   reasons               sortReasons(task ∪ academic ∪ {linked_assignment})
 *   linkedAssignmentId    kept
 *
 * A task whose link names an assignment NOT in the list is returned
 * unchanged -- no `linked_assignment` reason, no bonus: there is nothing in
 * this list to link it to. Two tasks linked to the same assignment both
 * merge with it (each earns the bonus) and the assignment row is dropped
 * once. Pure: returns a NEW array, never mutates a candidate, and keeps
 * every surviving row in its input position (the merged row takes the
 * task's), so the caller ranks the result exactly as before.
 */
export function mergeLinkedCandidates<T extends FocusNowCandidate>(candidates: readonly T[]): T[] {
  const academicById = new Map<string, T>();
  for (const candidate of candidates) {
    if (candidate.kind === "academic_assignment") academicById.set(candidate.id, candidate);
  }
  const consumed = new Set<string>();
  const merged: T[] = [];
  for (const candidate of candidates) {
    if (candidate.kind === "task" && candidate.linkedAssignmentId !== null) {
      const academic = academicById.get(candidate.linkedAssignmentId);
      if (academic !== undefined) {
        consumed.add(academic.id);
        const contextPoints =
          candidate.contextPoints +
          academic.contextPoints +
          FOCUS_NOW_CONTEXT_POINTS.linked_assignment;
        const baseScore = Math.max(candidate.baseScore, academic.baseScore);
        merged.push({
          ...candidate,
          dueAt: candidate.dueAt ?? academic.dueAt,
          baseScore,
          contextPoints,
          score: baseScore + contextPoints,
          reasons: sortReasons([...candidate.reasons, ...academic.reasons, "linked_assignment"]),
        });
        continue;
      }
    }
    merged.push(candidate);
  }
  return merged.filter(
    (candidate) => !(candidate.kind === "academic_assignment" && consumed.has(candidate.id)),
  );
}

// ---------------------------------------------------------------------------
// Ranking
// ---------------------------------------------------------------------------

/**
 * The total order for "what should I focus on right now?" -- literally
 * academic's own `compareAcademicPriorities`: score DESC, then due_at ASC
 * with nulls last, then title ASC, then id ASC, so identical inputs are
 * byte-identical (docs/ARCHITECTURE.md's rule for every read-model
 * ordering). `FocusNowCandidate` already satisfies `AcademicPriorityCandidate`
 * structurally (id/title/dueAt/score), so the comparator is reused rather
 * than copied.
 */
export const compareFocusNowCandidates = compareAcademicPriorities;

/**
 * Returns a NEW array in `compareFocusNowCandidates` order; the input is
 * never mutated. Generic over `T` so a caller can rank a richer row type
 * (e.g. a candidate paired with its originating task or priority item) as
 * long as it carries `id`/`title`/`dueAt`/`score`.
 */
export function rankFocusNowCandidates<T extends AcademicPriorityCandidate>(
  candidates: readonly T[],
): T[] {
  return rankAcademicPriorities(candidates);
}
