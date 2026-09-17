// Focus Now explainability (Checkpoint 10.6, ADR-075; memory reasons added
// by Checkpoint 10.7, ADR-077 §5): every recommendation answers "why am I
// seeing this, and what data caused it?" from the row alone -- a label the
// chip already uses, a one-sentence `why`, the SOURCE the evidence came
// from, and an auditable score equation.
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
// with its chip. The six context labels are new with 10.6; the two memory
// labels ("Matches your preference" / "Supports a goal") with 10.7.
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
//   matches_preference /    memory (ADR-077) -- a memory the owner wrote or
//   supports_goal           accepted, matched by typed link only
//
// ===========================================================================
// A MEMORY REASON'S "WHY" NAMES THE MEMORY (ADR-077 §5)
// ===========================================================================
//
// Every other `why` is static text from `FOCUS_NOW_REASON_WHY`. A memory
// reason's is the memory itself -- `You said: <statement>` -- when the
// caller supplies the matched memory (`FocusNowExplainOptions.memory`, the
// objects `matchMemoriesForRow` returned; the scorer only ever saw booleans),
// bounded to FOCUS_NOW_MEMORY_WHY_MAX_CHARS code points with an ellipsis.
// Without it the static fallback sentence in the table is used, so the
// function stays total and every pre-10.7 `why` is byte-identical.
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
// never appear in the equation; the context bonuses always do, the two
// memory bonuses as "+15 preference" / "+15 goal". When the context tier's
// cap (FOCUS_NOW_CONTEXT_POINTS_CAP, score.ts) actually bit, every term is
// still listed and one trailing ", capped to 75" says why they do not sum
// to the right-hand side:
//
//   "300 due <24h + 25 P1 + 25 linked assignment + 25 project stalled
//    + 25 course attention + 15 preference + 15 goal, capped to 75 = 400"
import { ACADEMIC_PRIORITY_POINTS, ACADEMIC_URGENCY_BASE_POINTS } from "../academic/urgency.js";
import {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_CONTEXT_POINTS_CAP,
  FOCUS_NOW_MEMORY_REASONS,
  FOCUS_NOW_TOP_PRIORITY_POINTS,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowMemoryReason,
  type FocusNowReason,
  type FocusNowSource,
} from "./reasons.js";
import type { FocusNowCandidate, FocusNowKind } from "./score.js";

export {
  FOCUS_NOW_CONTEXT_POINTS,
  FOCUS_NOW_CONTEXT_POINTS_CAP,
  FOCUS_NOW_CONTEXT_REASONS,
  FOCUS_NOW_MEMORY_POINTS,
  FOCUS_NOW_MEMORY_REASONS,
  FOCUS_NOW_REASON_ORDER,
  FOCUS_NOW_SOURCES,
  sortReasons,
  type FocusNowContextReason,
  type FocusNowMemoryReason,
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
  matches_preference: "Matches your preference",
  supports_goal: "Supports a goal",
};

/** The one deterministic sentence per reason (for a memory reason: the fallback when the memory itself is not supplied). */
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
  matches_preference: "A saved preference is linked to this item",
  supports_goal: "A saved goal is linked to this item's project",
};

/** The memory-derived `why` keeps at most this many code points of the statement. */
export const FOCUS_NOW_MEMORY_WHY_MAX_CHARS = 120;
const ELLIPSIS = "…";

/** The minimal memory shape an explanation needs: the statement it names. */
export interface FocusNowMemoryEvidenceItem {
  statement: string;
}

/** The matched memories a row's two memory reasons came from (`matchMemoriesForRow`'s result fits). */
export interface FocusNowMemoryEvidence {
  matchesPreference?: FocusNowMemoryEvidenceItem | null;
  supportsGoal?: FocusNowMemoryEvidenceItem | null;
}

export interface FocusNowExplainOptions {
  memory?: FocusNowMemoryEvidence | null;
}

/**
 * `You said: <statement>`, the statement trimmed and bounded to
 * FOCUS_NOW_MEMORY_WHY_MAX_CHARS code points (surrogate-safe) with an
 * ellipsis when cut. Deterministic; never reads anything but the statement.
 */
export function memoryWhy(statement: string): string {
  const points = Array.from(statement.trim());
  const bounded =
    points.length > FOCUS_NOW_MEMORY_WHY_MAX_CHARS
      ? points.slice(0, FOCUS_NOW_MEMORY_WHY_MAX_CHARS - 1).join("") + ELLIPSIS
      : points.join("");
  return `You said: ${bounded}`;
}

const MEMORY_EVIDENCE_KEY: Readonly<Record<FocusNowMemoryReason, keyof FocusNowMemoryEvidence>> = {
  matches_preference: "matchesPreference",
  supports_goal: "supportsGoal",
};

const MEMORY_REASONS: ReadonlySet<FocusNowReason> = new Set<FocusNowReason>(
  FOCUS_NOW_MEMORY_REASONS,
);

function isMemoryReason(reason: FocusNowReason): reason is FocusNowMemoryReason {
  return MEMORY_REASONS.has(reason);
}

/** The `why` for a reason: the named memory when supplied, otherwise the static table sentence. */
function whyFor(reason: FocusNowReason, options: FocusNowExplainOptions | undefined): string {
  if (isMemoryReason(reason)) {
    const evidence = options?.memory?.[MEMORY_EVIDENCE_KEY[reason]];
    if (evidence !== undefined && evidence !== null && evidence.statement.trim() !== "") {
      return memoryWhy(evidence.statement);
    }
  }
  return FOCUS_NOW_REASON_WHY[reason];
}

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
  matches_preference: "memory",
  supports_goal: "memory",
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

/**
 * Explains one reason on a row of the given kind (the kind decides the
 * urgency reasons' source). `options.memory` lets a memory reason name the
 * memory it came from (see the module comment); every other reason ignores it.
 */
export function explainFocusNowReason(
  reason: FocusNowReason,
  kind: FocusNowKind,
  options?: FocusNowExplainOptions,
): FocusNowExplanation {
  return {
    reason,
    label: FOCUS_NOW_REASON_LABEL[reason],
    why: whyFor(reason, options),
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
  matches_preference: "preference",
  supports_goal: "goal",
};

/** The term for a base that carries no urgency reason: the `low` floor. */
export const FOCUS_NOW_EQUATION_BASE_FLOOR_TERM = "base";
/** The term for a base that is the server's verbatim academic score. */
export const FOCUS_NOW_EQUATION_ACADEMIC_TERM = "Canvas priority";
/** Appended (after a comma) only when the context tier's cap actually reduced the row's context points. */
export const FOCUS_NOW_EQUATION_CAP_TERM = `capped to ${FOCUS_NOW_CONTEXT_POINTS_CAP}`;

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
 * assignment = 450"` or `"400 overdue + 15 preference = 415"`. The
 * right-hand side is always the candidate's own `score`; the left-hand side
 * is the base (decomposed for a task when the frozen tables reproduce it,
 * otherwise "<baseScore> Canvas priority") plus one term per point-carrying
 * context reason, memory reasons last.
 */
export function focusNowEquation(candidate: FocusNowCandidate): string {
  const baseTerms = candidate.kind === "academic_assignment" ? null : decomposeBase(candidate);
  const terms = baseTerms ?? [`${candidate.baseScore} ${FOCUS_NOW_EQUATION_ACADEMIC_TERM}`];
  let uncappedContext = 0;
  for (const reason of candidate.reasons) {
    if (!isContextReason(reason)) continue;
    const points = FOCUS_NOW_CONTEXT_POINTS[reason];
    uncappedContext += points;
    if (points === 0) continue;
    terms.push(`${points} ${FOCUS_NOW_EQUATION_TERM[reason] ?? reason}`);
  }
  const cap =
    uncappedContext > FOCUS_NOW_CONTEXT_POINTS_CAP ? `, ${FOCUS_NOW_EQUATION_CAP_TERM}` : "";
  return `${terms.join(" + ")}${cap} = ${candidate.score}`;
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
 * stays total rather than inventing a reason). `options.memory` carries the
 * matched memories so the two memory reasons can name them.
 */
export function explainFocusNowCandidate(
  candidate: FocusNowCandidate,
  options?: FocusNowExplainOptions,
): FocusNowCandidateExplanation {
  const explanations = sortReasons(candidate.reasons).map((reason) =>
    explainFocusNowReason(reason, candidate.kind, options),
  );
  return {
    primary: explanations[0] ?? null,
    explanations,
    equation: focusNowEquation(candidate),
  };
}
