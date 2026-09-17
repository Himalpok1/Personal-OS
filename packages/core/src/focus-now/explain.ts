// Focus Now explainability (Checkpoint 10.6, ADR-075): every recommendation
// answers "why am I seeing this, and what data caused it?" from the row
// alone -- a label the chip already uses, a one-sentence `why`, the SOURCE
// the evidence came from, and an auditable score equation.
//
// Pure, total, no clock, no database, no Node builtin; ships to the Expo
// bundle through `./focus-now/*`. The vocabulary and its point tables live in
// reasons.ts (a leaf) and are re-exported here so a consumer of the
// explainability layer imports ONE module.
//
// ===========================================================================
// LABELS ARE THE CLIENT'S OWN WORDS
// ===========================================================================
//
// The seven pre-10.6 labels are byte-identical to `apps/mobile/src/
// components/today/focus-now-reason-chip.ts` (Overdue / Due <24h / This week
// / Missing / Late / High points / P1), so a row's explanation never disagrees
// with its chip. The six context labels are new with this checkpoint.
//
// ===========================================================================
// SOURCE DEPENDS ON THE ROW, NOT ONLY THE REASON
// ===========================================================================
//
// `overdue` on an assignment row is Canvas's due date; `overdue` on a task
// row is the owner's own. The urgency reasons therefore resolve their source
// from the candidate's kind, while every other reason has exactly one
// possible source:
//
//   urgency (overdue / due_within_24h / due_this_week)
//                           academic row → canvas_assignment; task row → task
//   marked_missing / marked_late / high_points / no_submission
//                           canvas_assignment (Canvas's own flags)
//   top_priority            task
//   linked_assignment       canvas_assignment (the link's target)
//   project_stalled         project
//   course_attention_high   course
//   reminder_set / snoozed  reminder
//
// ===========================================================================
// THE EQUATION IS RECOMPUTABLE FROM THE FROZEN TABLES -- OR HONESTLY OPAQUE
// ===========================================================================
//
//   "400 overdue + 25 P1 + 25 linked assignment = 450"
//
// A TASK's base decomposes: its urgency reason names the base
// (`ACADEMIC_PRIORITY_POINTS`, or the 100 `low` floor when it carries none)
// and `top_priority` adds 25. An ASSIGNMENT's base is the SERVER's own score
// taken verbatim (ADR-072 §4 -- never re-derived), so its base term is the
// opaque "<baseScore> Canvas priority" even when the number happens to be
// reconstructible. A merged row (a task linked to an assignment, score.ts)
// keeps the stronger base and the union of reasons; its base is decomposed
// only when the table terms actually sum to it, and is otherwise reported as
// "Canvas priority" -- the only non-decomposable source. Zero-point reasons
// never appear in the equation; the context bonuses always do.
import { ACADEMIC_PRIORITY_POINTS, ACADEMIC_URGENCY_BASE_POINTS } from "../academic/urgency.js";
import {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowReason,
  type FocusNowSource,
} from "./reasons.js";
import type { FocusNowCandidate, FocusNowKind } from "./score.js";

export {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_CONTEXT_REASONS,
  FOCUS_NOW_REASON_ORDER,
  FOCUS_NOW_SOURCES,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowReason,
  type FocusNowSource,
} from "./reasons.js";

/** One reason, explained: the chip word, a sentence, and where the evidence came from. */
export interface FocusNowExplanation {
  reason: FocusNowReason;
  label: string;
  why: string;
  source: FocusNowSource;
}

/** The chip word per reason -- the first seven pinned equal to the client's `FOCUS_NOW_REASON_CHIP`. */
export const FOCUS_NOW_REASON_LABEL: Readonly<Record<FocusNowReason, string>> = {
  overdue: "Overdue",
  due_within_24h: "Due <24h",
  due_this_week: "This week",
  marked_missing: "Missing",
  marked_late: "Late",
  high_points: "High points",
  top_priority: "P1",
  linked_assignment: "Linked assignment",
  project_stalled: "Project stalled",
  course_attention_high: "Course needs attention",
  no_submission: "Not submitted",
  reminder_set: "Reminder set",
  snoozed: "Snoozed",
};

/** The one deterministic sentence per reason. */
export const FOCUS_NOW_REASON_WHY: Readonly<Record<FocusNowReason, string>> = {
  overdue: "Past its due time",
  due_within_24h: "Due within 24 hours",
  due_this_week: "Due this week",
  marked_missing: "Canvas marked it missing",
  marked_late: "Canvas marked it late",
  high_points: "Worth 50 points or more",
  top_priority: "Marked P1",
  linked_assignment: "You linked a task to this assignment",
  project_stalled: "Its project has had no activity for 14 days",
  course_attention_high: "This course has overdue or imminent work",
  no_submission: "No submission recorded in Canvas",
  reminder_set: "A reminder is scheduled",
  snoozed: "Snoozed to a later time",
};

/** The three reasons whose source is the ROW's domain rather than a fixed one. */
const URGENCY_REASONS: ReadonlySet<FocusNowReason> = new Set([
  "overdue",
  "due_within_24h",
  "due_this_week",
]);

/** The fixed source for every non-urgency reason (see the module comment). */
const FIXED_SOURCE: Readonly<
  Record<Exclude<FocusNowReason, "overdue" | "due_within_24h" | "due_this_week">, FocusNowSource>
> = {
  marked_missing: "canvas_assignment",
  marked_late: "canvas_assignment",
  high_points: "canvas_assignment",
  no_submission: "canvas_assignment",
  top_priority: "task",
  linked_assignment: "canvas_assignment",
  project_stalled: "project",
  course_attention_high: "course",
  reminder_set: "reminder",
  snoozed: "reminder",
};

/** The source a row's own urgency comes from: Canvas's due date for an assignment, the owner's for anything else. */
function kindSource(kind: FocusNowKind): FocusNowSource {
  return kind === "academic_assignment" ? "canvas_assignment" : "task";
}

function isUrgencyReason(
  reason: FocusNowReason,
): reason is "overdue" | "due_within_24h" | "due_this_week" {
  return URGENCY_REASONS.has(reason);
}

/** Explains one reason on a row of the given kind (the kind decides the urgency reasons' source). */
export function explainFocusNowReason(
  reason: FocusNowReason,
  kind: FocusNowKind,
): FocusNowExplanation {
  return {
    reason,
    label: FOCUS_NOW_REASON_LABEL[reason],
    why: FOCUS_NOW_REASON_WHY[reason],
    source: isUrgencyReason(reason) ? kindSource(kind) : FIXED_SOURCE[reason],
  };
}

// ---------------------------------------------------------------------------
// The equation
// ---------------------------------------------------------------------------

/** The word each POINT-CARRYING reason contributes to the equation line. Zero-point reasons have no term. */
export const FOCUS_NOW_EQUATION_TERM: Readonly<Record<FocusNowReason, string | null>> = {
  overdue: "overdue",
  due_within_24h: "due <24h",
  due_this_week: "this week",
  marked_missing: "missing",
  marked_late: "late",
  high_points: "high points",
  top_priority: "P1",
  linked_assignment: "linked assignment",
  project_stalled: "project stalled",
  course_attention_high: "course attention",
  no_submission: null,
  reminder_set: null,
  snoozed: null,
};

/** The term for a base that carries no urgency reason: the `low` floor. */
export const FOCUS_NOW_EQUATION_BASE_FLOOR_TERM = "base";
/** The term for a base that is the server's verbatim academic score. */
export const FOCUS_NOW_EQUATION_ACADEMIC_TERM = "Canvas priority";

const CONTEXT_REASONS: ReadonlySet<FocusNowReason> = new Set<FocusNowReason>(
  Object.keys(FOCUS_NOW_CONTEXT_POINTS) as FocusNowContextReason[],
);

function isContextReason(reason: FocusNowReason): reason is FocusNowContextReason {
  return CONTEXT_REASONS.has(reason);
}

/** Points the frozen tables assign a BASE reason (urgency, academic additive, top_priority). */
function basePointsFor(reason: Exclude<FocusNowReason, FocusNowContextReason>): number {
  return reason === "top_priority"
    ? FOCUS_NOW_TOP_PRIORITY_POINTS
    : ACADEMIC_PRIORITY_POINTS[reason];
}

/**
 * The decomposed base terms for a candidate's base reasons, or null when
 * the table terms do not sum to `baseScore` (a verbatim academic base, or a
 * merged row whose stronger base came from the academic side).
 */
function decomposeBase(candidate: FocusNowCandidate): string[] | null {
  const baseReasons = candidate.reasons.filter(
    (reason): reason is Exclude<FocusNowReason, FocusNowContextReason> => !isContextReason(reason),
  );
  const terms: string[] = [];
  let sum = 0;
  if (!baseReasons.some(isUrgencyReason)) {
    sum += ACADEMIC_URGENCY_BASE_POINTS.low;
    terms.push(`${ACADEMIC_URGENCY_BASE_POINTS.low} ${FOCUS_NOW_EQUATION_BASE_FLOOR_TERM}`);
  }
  for (const reason of baseReasons) {
    const points = basePointsFor(reason);
    sum += points;
    terms.push(`${points} ${FOCUS_NOW_EQUATION_TERM[reason] ?? reason}`);
  }
  return sum === candidate.baseScore ? terms : null;
}

/**
 * The auditable score line, e.g. `"400 overdue + 25 P1 + 25 linked
 * assignment = 450"`. The right-hand side is always the candidate's own
 * `score`; the left-hand side is the base (decomposed for a task when the
 * frozen tables reproduce it, otherwise "<baseScore> Canvas priority") plus
 * one term per point-carrying context reason.
 */
export function focusNowEquation(candidate: FocusNowCandidate): string {
  const baseTerms = candidate.kind === "academic_assignment" ? null : decomposeBase(candidate);
  const terms = baseTerms ?? [`${candidate.baseScore} ${FOCUS_NOW_EQUATION_ACADEMIC_TERM}`];
  for (const reason of candidate.reasons) {
    if (!isContextReason(reason)) continue;
    const points = FOCUS_NOW_CONTEXT_POINTS[reason];
    if (points === 0) continue;
    terms.push(`${points} ${FOCUS_NOW_EQUATION_TERM[reason] ?? reason}`);
  }
  return `${terms.join(" + ")} = ${candidate.score}`;
}

export interface FocusNowCandidateExplanation {
  /** The first reason in vocabulary order (the urgency, when there is one), or null for a row with no reason at all. */
  primary: FocusNowExplanation | null;
  /** Every reason the row carries, in `FOCUS_NOW_REASON_ORDER`. */
  explanations: FocusNowExplanation[];
  /** `focusNowEquation(candidate)`. */
  equation: string;
}

/**
 * Explains a whole candidate. `reasons` is re-sorted defensively so the
 * output is byte-identical regardless of the order a caller assembled the
 * row in. `primary` is null only for a row carrying no reason (an undated,
 * unflagged `low` task -- unreachable from Today's buckets, but the function
 * stays total rather than inventing a reason).
 */
export function explainFocusNowCandidate(
  candidate: FocusNowCandidate,
): FocusNowCandidateExplanation {
  const explanations = sortReasons(candidate.reasons).map((reason) =>
    explainFocusNowReason(reason, candidate.kind),
  );
  return {
    primary: explanations[0] ?? null,
    explanations,
    equation: focusNowEquation(candidate),
  };
}
