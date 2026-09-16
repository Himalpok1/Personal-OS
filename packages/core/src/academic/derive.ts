// Academic Intelligence Layer -- pure derivations over synced LMS rows
// (Checkpoint 10.2, ADR-068a / ADR-070).
//
// Every function here is a total function of its arguments: no clock, no
// database, no provider client. They exist so that `open`, a grade's
// percentage, a course's lifecycle and the normalized submission/read states
// are computed in exactly ONE place -- apps/api's academic read model calls
// them, the schema package documents them, and a client never re-derives any
// of them from a provider string.
//
// The string-literal unions below mirror the closed Zod enums in
// packages/schema/src/academic.ts member-for-member. They are restated rather
// than imported because packages/schema already depends on
// @personal-os/core/timezone, so core cannot import schema without a cycle;
// apps/api's read model parses every projected row through the Zod schemas,
// which is what pins the two vocabularies to each other.
//
// This module is deliberately NOT re-exported from packages/core's barrel
// (which pulls in `node:crypto` via device-auth). It is reached through the
// `./academic/*` subpath, like `./canvas/*` and `./health/*`, and imports no
// Node builtin, so it is safe for the Expo bundle.

/**
 * Canvas `submission_state`, normalized to a closed vocabulary. `unknown` is
 * honest, not a defect: Canvas owns that vocabulary and may grow it
 * (ADR-050), and a member this layer has never heard of must degrade to "we
 * don't know" -- which `isOpenAssignment` then treats as still open, the
 * direction that never hides work.
 */
export type AcademicSubmissionStatus =
  "unsubmitted" | "submitted" | "graded" | "pending_review" | "unknown";

/** Derived from the submission status alone -- see `deriveGradingStatus`. */
export type AcademicGradingStatus = "not_graded" | "pending_review" | "graded";

/** A course's lifecycle as Personal OS sees it -- see `deriveCourseStatus`. */
export type AcademicCourseStatus = "active" | "completed" | "archived";

const KNOWN_SUBMISSION_STATUSES: ReadonlySet<string> = new Set([
  "unsubmitted",
  "submitted",
  "graded",
  "pending_review",
]);

/**
 * `unsubmitted | submitted | graded | pending_review` map to themselves;
 * null, undefined and every other string become `unknown`. The comparison is
 * exact -- no trimming or case-folding -- because Canvas emits these as
 * fixed lowercase tokens and a near-miss is precisely the case `unknown` is
 * for.
 */
export function normalizeSubmissionStatus(
  raw: string | null | undefined,
): AcademicSubmissionStatus {
  if (raw !== null && raw !== undefined && KNOWN_SUBMISSION_STATUSES.has(raw)) {
    return raw as AcademicSubmissionStatus;
  }
  return "unknown";
}

/**
 * THE rule every Today bucket and course count is built on:
 * `open ⟺ status ∈ {unsubmitted, unknown}`. Submitted, graded and
 * pending-review assignments need nothing from the owner and are never
 * bucketed, whatever their due instant.
 */
export function isOpenAssignment(status: AcademicSubmissionStatus): boolean {
  return status === "unsubmitted" || status === "unknown";
}

/**
 * `graded` ↔ `graded`, `pending_review` ↔ `pending_review`, everything else
 * `not_graded`. Deliberately a function of the status only: a `graded`
 * submission with a null score (excused, complete/incomplete) is still
 * graded.
 */
export function deriveGradingStatus(status: AcademicSubmissionStatus): AcademicGradingStatus {
  if (status === "graded") return "graded";
  if (status === "pending_review") return "pending_review";
  return "not_graded";
}

/**
 * `score / points_possible * 100`, rounded to ONE decimal, only when both
 * are present and `points_possible > 0`; otherwise null. Never clamped --
 * extra credit legitimately exceeds 100 -- and never stored (ADR-068a), so
 * it can never disagree with the two columns it is derived from.
 *
 * The multiplication happens before the division so that a ratio like
 * 29/100 does not pick up a binary-fraction error (`0.29 * 100` is
 * 28.999999999999996 in IEEE 754; `29 * 100 / 100` is exactly 29).
 */
export function derivePercentage(
  score: number | null | undefined,
  pointsPossible: number | null | undefined,
): number | null {
  if (score === null || score === undefined || pointsPossible === null) return null;
  if (pointsPossible === undefined || !(pointsPossible > 0)) return null;
  if (!Number.isFinite(score) || !Number.isFinite(pointsPossible)) return null;
  const rounded = Math.round(((score * 100) / pointsPossible) * 10) / 10;
  // `Math.round(-0.04 * 10) / 10` is -0; JSON carries it as 0 anyway, but a
  // deterministic wire value should not depend on the serializer.
  return rounded === 0 ? 0 : rounded;
}

/**
 * Precedence, exactly as `AcademicCourseStatusSchema` documents it:
 *   archived  -- `archived_at` is set (the sync tombstoned it);
 *   completed -- Canvas `enrollment_state` or `workflow_state` is `completed`;
 *   active    -- everything else.
 * Term dates deliberately do NOT participate, so this is a pure function of
 * the row and never of the clock.
 */
export function deriveCourseStatus(
  archivedAt: Date | string | null | undefined,
  enrollmentState: string | null | undefined,
  workflowState: string | null | undefined,
): AcademicCourseStatus {
  if (archivedAt !== null && archivedAt !== undefined) return "archived";
  if (enrollmentState === "completed" || workflowState === "completed") return "completed";
  return "active";
}

/** Canvas `read_state`: `read` → true, `unread` → false, anything else → null. */
export function normalizeReadState(raw: string | null | undefined): boolean | null {
  if (raw === "read") return true;
  if (raw === "unread") return false;
  return null;
}
