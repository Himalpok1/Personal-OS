import type { MonitorCheckStatus } from "@personal-os/schema";

// Threshold evaluation, derived from check history.
//
// ===========================================================================
// THERE IS NO COUNTER, AND THAT IS THE WHOLE DESIGN.
// ===========================================================================
//
// ADR-055 forbids a `consecutive_failures` column, and `health/breaker.ts`
// supplies the argument this file is built on: a counter is a second source of
// truth that must be reset correctly on EVERY success path, and one missed reset
// means a target opens an incident on five failures spread across a month.
// Reading the last N rows cannot drift, because there is nothing to keep in
// step.
//
// PURE, and deliberately takes an ARRAY rather than a database handle: the
// caller owns the query (and its ordering), this owns the decision. That is what
// makes flap suppression, threshold boundaries and the maintenance-exclusion
// rule testable without a fixture.

/**
 * What the check history says should happen next.
 *
 * `none` is the common case by a wide margin -- a single failure inside a
 * three-failure threshold, or a single success inside a two-success recovery.
 * Treating that as "nothing to do" rather than as a transition IS the flap
 * suppression: a service bouncing up and down never reaches N consecutive
 * anything, so it never opens and never resolves.
 */
export type IncidentTransition = "none" | "open" | "resolve";

export interface ThresholdInput {
  /**
   * Recent checks, NEWEST FIRST.
   *
   * The caller must have already excluded `skipped` rows -- see
   * `countLeading`'s comment for why that exclusion is load-bearing rather than
   * tidy.
   */
  recentStatuses: readonly MonitorCheckStatus[];
  failureThreshold: number;
  recoveryThreshold: number;
  /** Whether an unresolved incident already exists for this target. */
  hasActiveIncident: boolean;
}

/**
 * Counts how many leading entries match `status`.
 *
 * ===========================================================================
 * `skipped` MUST BE FILTERED OUT BEFORE THIS IS CALLED, NOT HANDLED HERE.
 * ===========================================================================
 *
 * If a maintenance-window skip were counted as "not down", a nightly window
 * would silently reset a failure streak that was one check away from opening an
 * incident -- so an outage that began before a maintenance window would never be
 * reported. If it were counted as "down", a maintenance window would MANUFACTURE
 * an outage.
 *
 * Neither is right, because a skip is not evidence either way. Excluding it
 * entirely means the streak spans the window: three failures before a
 * maintenance window and none after still reads as three consecutive failures,
 * which is exactly what an operator would say happened.
 *
 * The mail breaker learned the same lesson about counting its own skips, and the
 * exclusion is enforced at the query in `evaluateTarget`.
 */
function countLeading(statuses: readonly MonitorCheckStatus[], status: MonitorCheckStatus): number {
  let count = 0;
  for (const entry of statuses) {
    if (entry !== status) break;
    count += 1;
  }
  return count;
}

/**
 * Decides whether to open, resolve, or do nothing.
 *
 * Both directions require N CONSECUTIVE identical results, which is what makes
 * this flap-resistant in both directions rather than only on the way up. A
 * target that alternates up/down/up/down produces a leading run of exactly one
 * every time and therefore never transitions -- it stays in whatever state it
 * was already in, which is the honest answer for a service nobody can call
 * healthy or broken.
 *
 * `hasActiveIncident` is consulted rather than inferred, because "should this
 * open?" and "is one already open?" are different questions and the database
 * answers the second authoritatively (a partial unique index guarantees at most
 * one). Asking it here means a second outage during an unresolved incident does
 * NOT open a duplicate, and a recovery with no incident to close is a no-op
 * rather than an error.
 */
export function evaluateThreshold(input: ThresholdInput): IncidentTransition {
  const { recentStatuses, failureThreshold, recoveryThreshold, hasActiveIncident } = input;

  if (!hasActiveIncident) {
    return countLeading(recentStatuses, "down") >= failureThreshold ? "open" : "none";
  }

  return countLeading(recentStatuses, "up") >= recoveryThreshold ? "resolve" : "none";
}

/**
 * How many consecutive failures the history currently shows.
 *
 * Exported for diagnostics and for the tests, which assert the count directly
 * rather than inferring it from a transition -- a test that only ever checks the
 * decision cannot tell "two failures under a threshold of three" from "zero".
 */
export function consecutiveFailures(recentStatuses: readonly MonitorCheckStatus[]): number {
  return countLeading(recentStatuses, "down");
}

/** How many consecutive successes the history currently shows. */
export function consecutiveSuccesses(recentStatuses: readonly MonitorCheckStatus[]): number {
  return countLeading(recentStatuses, "up");
}
