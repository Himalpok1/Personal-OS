// The Google Health backfill state machine (Phase 6 Checkpoint 6.3).
//
// Pure: decides the next state and the exact column values for a transition,
// with no database access. Both apps/api (which starts and cancels a backfill
// on the user's behalf) and apps/worker (which advances and completes one)
// route through here, so the two cannot drift.
//
// WHY THIS IS FUSSIER THAN IT LOOKS -- the CHECK constraint in migration 0013:
//
//   (backfill_status = 'idle'  AND target IS NULL     AND cursor IS NULL)
//   OR
//   (backfill_status <> 'idle' AND target IS NOT NULL)
//
// Two consequences that are easy to violate by omission, and that a bare
// `SET backfill_status = ...` will hit as a 23514 at runtime:
//
//   * Reaching 'complete' must KEEP backfill_target_date non-null. 'complete'
//     is a non-idle status, so nulling the target there raises. Keeping the
//     cursor equal to the target is also the honest record of where it
//     stopped, and the dashboard in 6.4 needs it.
//   * Returning to 'idle' must null BOTH date columns in the SAME statement.
//
// The cursor is the EXCLUSIVE UPPER BOUND of the next chunk, matching
// chunkRange()'s backwards walk, so a persisted cursor is always a real chunk
// boundary. It is a date, never a page token: page tokens expire between job
// attempts and a date cannot.

import { lastGloballyCompleteDateExclusive } from "./windows.js";

export type BackfillStatus = "idle" | "running" | "paused" | "cancelled" | "complete" | "failed";

/** The exact mutable column set. Every transition returns all four, so a
 *  caller cannot accidentally write a partial, CHECK-violating update. */
export interface BackfillColumns {
  backfillStatus: BackfillStatus;
  backfillTargetDate: string | null;
  backfillCursorDate: string | null;
  backfillCancelRequested: boolean;
}

export interface BackfillState {
  backfillStatus: BackfillStatus;
  backfillTargetDate: string | null;
  backfillCursorDate: string | null;
  backfillCancelRequested: boolean;
  /** Oldest civil date already verified for this stream, if any. */
  earliestVerifiedDate: string | null;
}

export class BackfillTransitionError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "BackfillTransitionError";
    this.code = code;
  }
}

/**
 * Starts (or restarts) a backfill toward `targetDate`.
 *
 * A request against a NON-IDLE stream is legal and is how a completed,
 * cancelled or failed backfill is restarted with a new target: the caller
 * clears to idle and starts again in one write, which is why this returns the
 * full column set rather than a patch. That is also the only caller
 * `clearBackfill` semantics ever needed, so no separate reset route exists.
 */
export function startBackfill(
  state: BackfillState,
  targetDate: string,
  now: Date,
): BackfillColumns {
  if (state.backfillStatus === "running") {
    throw new BackfillTransitionError("backfill_already_running", "a backfill is already running");
  }
  // The newest date we may walk back from. earliest_verified_date is the
  // honest frontier when we have one; otherwise start at the last civil date
  // that has ended in every timezone, so a still-in-flight day is never
  // treated as already covered.
  const cursor = state.earliestVerifiedDate ?? lastGloballyCompleteDateExclusive(now);
  if (targetDate >= cursor) {
    throw new BackfillTransitionError(
      "backfill_target_not_in_past",
      "target_date must be strictly older than the already-verified range",
    );
  }
  return {
    backfillStatus: "running",
    backfillTargetDate: targetDate,
    backfillCursorDate: cursor,
    // A stale cancel flag from a previous run must not immediately cancel
    // the new one.
    backfillCancelRequested: false,
  };
}

/** Records that the user asked to stop. The worker consumes this at its next
 *  chunk boundary; it deliberately does not itself change status, so a run
 *  that is mid-chunk finishes that chunk's transaction cleanly. */
export function requestBackfillCancel(state: BackfillState): BackfillColumns {
  if (state.backfillStatus !== "running") {
    throw new BackfillTransitionError(
      "backfill_not_running",
      "no backfill is running for this stream",
    );
  }
  return {
    backfillStatus: state.backfillStatus,
    backfillTargetDate: state.backfillTargetDate,
    backfillCursorDate: state.backfillCursorDate,
    backfillCancelRequested: true,
  };
}

/** Advances the cursor after a chunk commits. Written in the SAME transaction
 *  as that chunk's rows, so the database never claims a range is verified
 *  while its rows are missing. */
export function advanceBackfillCursor(
  state: BackfillState,
  chunkStartDate: string,
): BackfillColumns {
  return {
    backfillStatus: "running",
    backfillTargetDate: state.backfillTargetDate,
    backfillCursorDate: chunkStartDate,
    backfillCancelRequested: state.backfillCancelRequested,
  };
}

/** The cursor reached the target. Target is KEPT non-null -- 'complete' is a
 *  non-idle status and nulling it would raise 23514. */
export function completeBackfill(state: BackfillState): BackfillColumns {
  if (state.backfillTargetDate === null) {
    throw new BackfillTransitionError(
      "backfill_missing_target",
      "cannot complete a backfill with no target",
    );
  }
  return {
    backfillStatus: "complete",
    backfillTargetDate: state.backfillTargetDate,
    backfillCursorDate: state.backfillTargetDate,
    backfillCancelRequested: false,
  };
}

/** Terminal states that retain their dates so the run can be resumed or
 *  inspected. `failed` is only ever reached from a non-retryable fault. */
export function settleBackfill(
  state: BackfillState,
  status: "cancelled" | "failed" | "paused",
): BackfillColumns {
  if (state.backfillTargetDate === null) {
    throw new BackfillTransitionError(
      "backfill_missing_target",
      `cannot move to ${status} with no target`,
    );
  }
  return {
    backfillStatus: status,
    backfillTargetDate: state.backfillTargetDate,
    backfillCursorDate: state.backfillCursorDate,
    backfillCancelRequested: false,
  };
}

/** The ONLY transition that nulls both date columns, and it must do so in one
 *  statement -- a bare `SET backfill_status = 'idle'` is a 23514. */
export function clearBackfill(): BackfillColumns {
  return {
    backfillStatus: "idle",
    backfillTargetDate: null,
    backfillCursorDate: null,
    backfillCancelRequested: false,
  };
}

/** Cheap local restatement of the database CHECK, so a unit test can prove a
 *  transition is legal without a live connection. */
export function satisfiesBackfillInvariant(c: BackfillColumns): boolean {
  return c.backfillStatus === "idle"
    ? c.backfillTargetDate === null && c.backfillCursorDate === null
    : c.backfillTargetDate !== null;
}
