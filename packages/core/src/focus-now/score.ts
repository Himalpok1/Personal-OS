// "Focus Now" -- a deterministic, client-side merge of personal urgent tasks
// (Today's overdue / due-today buckets) and already-ranked academic priority
// items (the academic Today read model's `priorities` section, Checkpoint
// 10.3) into ONE ranked, capped, explainable list (Checkpoint 10.4, ADR-072).
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
// THIS MODULE NEVER RE-DERIVES AN ACADEMIC SCORE. An academic candidate's
// `score`/`reasons` are taken verbatim from the server's own
// `scoreAcademicPriority` (packages/core/src/academic/urgency.ts) -- only a
// PERSONAL TASK is scored here, on the SAME base-point table and the SAME
// urgency ladder (`deriveUrgency`, reused rather than reimplemented), so the
// two domains sit on one comparable total order.
import {
  ACADEMIC_URGENCY_BASE_POINTS,
  compareAcademicPriorities,
  deriveUrgency,
  rankAcademicPriorities,
  type AcademicPriorityCandidate,
  type AcademicPriorityReason,
  type AcademicUrgency,
} from "../academic/urgency.js";

/** What kind of thing a Focus Now row represents. */
export type FocusNowKind = "task" | "event" | "academic_assignment";

/**
 * One additive reason a PERSONAL task's score can carry, beyond its urgency
 * base. `top_priority` is this domain's own extra: Personal OS's priority
 * convention is LOWER value = HIGHER priority (docs/ARCHITECTURE.md "Today &
 * agenda read models" rule 6; P1 is the top rung), an unconstrained nullable
 * smallint historically written only by AI capture, so `priority === 1` is
 * the one value worth rewarding rather than trying to rank the whole range.
 */
export const FOCUS_NOW_TASK_REASON = "top_priority" as const;

/** The reasons vocabulary a Focus Now row can carry: academic's own, plus the one task-only reason. */
export type FocusNowReason = AcademicPriorityReason | typeof FOCUS_NOW_TASK_REASON;

/** `priority === FOCUS_NOW_TOP_PRIORITY` (P1) is what `top_priority` rewards. */
export const FOCUS_NOW_TOP_PRIORITY = 1;
/** Same additive scale as academic's own `marked_late`/`high_points` (ADR-071). */
export const FOCUS_NOW_TOP_PRIORITY_POINTS = 25;

/** At most this many rows survive `rankFocusNowCandidates(...).slice(0, FOCUS_NOW_CAP)`. */
export const FOCUS_NOW_CAP = 5;

/** One ranked "what should I focus on right now?" candidate, from either domain. */
export interface FocusNowCandidate {
  id: string;
  kind: FocusNowKind;
  title: string;
  dueAt: Date | null;
  score: number;
  /** In table order: the urgency reason first (if any), then the additive ones. */
  reasons: FocusNowReason[];
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
}

export interface FocusNowTaskScore {
  urgency: AcademicUrgency;
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
 */
export function scoreFocusNowTask(
  input: FocusNowTaskInput,
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowTaskScore {
  const urgency = deriveUrgency(input.dueAt, effectiveNow, horizonEndUtc) ?? "low";
  const reasons: FocusNowReason[] = [];
  let score = ACADEMIC_URGENCY_BASE_POINTS[urgency];
  const urgencyReason = TASK_URGENCY_REASON[urgency];
  if (urgencyReason !== null) reasons.push(urgencyReason);
  if (input.priority !== null && input.priority <= FOCUS_NOW_TOP_PRIORITY) {
    reasons.push(FOCUS_NOW_TASK_REASON);
    score += FOCUS_NOW_TOP_PRIORITY_POINTS;
  }
  return { urgency, score, reasons };
}

/** A scored personal-task candidate, ready to rank alongside an academic one. */
export function focusNowCandidateFromTask(
  input: FocusNowTaskInput,
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowCandidate {
  const { score, reasons } = scoreFocusNowTask(input, effectiveNow, horizonEndUtc);
  return { id: input.id, kind: "task", title: input.title, dueAt: input.dueAt, score, reasons };
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
}

/**
 * Wraps an already-ranked academic priority item as a Focus Now candidate.
 * `score`/`reasons` are copied verbatim, never recomputed.
 */
export function focusNowCandidateFromAcademic(input: FocusNowAcademicInput): FocusNowCandidate {
  return {
    id: input.id,
    kind: "academic_assignment",
    title: input.title,
    dueAt: input.dueAt,
    score: input.score,
    reasons: [...input.reasons],
  };
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
