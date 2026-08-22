// Pure review-lifecycle invariants for Phase 5 Checkpoint 5.3
// (ADR-040 durable reviews model). No DB imports: apps/api and the mobile UI
// cannot disagree about when a review may complete or skip. Idempotency of
// completed→complete and skipped→skip is an API-layer concern; this module
// owns only strict transition legality from in_progress.

export const REVIEW_STATUSES = ["in_progress", "completed", "skipped"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** FROZEN: a review completes only while it is in flight. */
export const canCompleteReview = (status: string): boolean => status === "in_progress";

/** FROZEN: a review skips only while it is in flight. */
export const canSkipReview = (status: string): boolean => status === "in_progress";

/** Status transitions only. completed/skipped are terminal here; re-running a
 * terminal action is idempotent at the API layer, not a legal transition. */
export const REVIEW_TRANSITIONS: Record<ReviewStatus, readonly ReviewStatus[]> = {
  in_progress: ["completed", "skipped"],
  completed: [],
  skipped: [],
};
