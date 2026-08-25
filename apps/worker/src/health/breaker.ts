import { healthMetricStreams, healthSyncRuns, type Db } from "@personal-os/db";
import { HealthCapabilityStatusSchema } from "@personal-os/schema";
import { and, desc, eq } from "drizzle-orm";

// The per-stream circuit breaker.
//
// WHY THIS EXISTS -- the failure it is here to make impossible:
//
// The failure taxonomy deliberately does NOT throw for most faults. A
// non-retryable provider error records a failed run and returns, because
// throwing out of the handler would make pg-boss dead-letter a connection over
// one stream's bad request. The hourly cron is the retry.
//
// That is right, and it has one bad consequence: a PERMANENT defect becomes
// completely silent. If a value spec is wrong for a metric -- say
// `daily-vo2-max` really returns its number on a field we did not declare
// (fourteen of the eighteen specs are documented-but-unverified, and
// value-spec.ts says so plainly) -- then every hour, forever, we re-fetch a
// 35-day window, reject every record, write a failed run, and tell nobody. The
// cost is real quota and real wall clock, and the signal that something is
// wrong exists only as rows in a table nobody reads.
//
// So: five consecutive runs failing IDENTICALLY on a class that retrying cannot
// fix is treated as evidence, the stream is disabled, and exactly one alert is
// raised.
//
// DERIVED FROM health_sync_runs, WITH NO NEW COLUMN. A `consecutive_failures`
// counter would be a second source of truth for something the run table already
// records exactly, and it would need resetting correctly on every success path
// -- one missed reset and a stream trips on five failures spread across a
// month. Reading the last five rows cannot drift, because there is nothing to
// keep in step.

export const BREAKER_THRESHOLD = 5;

/**
 * Failure classes retrying genuinely can fix, which must therefore never trip
 * the breaker.
 *
 * `rate_limited`, `transport` and `provider_unavailable` come straight from
 * sync/capability.ts's retryable branch. `auth_unresolved` is included even
 * though it is not "retryable" in the limiter's sense: it means a 401 survived
 * this pass's single refresh, which is a grant/propagation problem for the
 * CONNECTION to resolve, and disabling eighteen streams one at a time is the
 * wrong response to it.
 *
 * `pass_budget_exhausted` is ours, not Google's -- a scheduling decision, and
 * disabling a stream because we ran out of wall clock would be absurd.
 */
const RETRYABLE_FAILURE_CLASSES: ReadonlySet<string> = new Set([
  "rate_limited",
  "transport",
  "provider_unavailable",
  "auth_unresolved",
  "pass_budget_exhausted",
]);

export interface BreakerInput {
  connectionId: string;
  streamId: string;
  metric: string;
}

export interface BreakerResult {
  tripped: boolean;
  /** The repeated class, when tripped. */
  failureClass: string | null;
}

/**
 * Evaluates the breaker for one stream and, if it trips, disables the stream.
 *
 * Returns `tripped: true` at most once per fault episode in practice: the same
 * call that trips also sets `sync_enabled = false`, so the stream is not
 * selected on the next pass and produces no sixth failing run. Re-enabling it
 * (a deliberate user action through `PATCH /streams`) starts the window again
 * from whatever runs follow.
 */
export async function evaluateStreamBreaker(
  db: Db,
  input: BreakerInput,
  now: Date = new Date(),
): Promise<BreakerResult> {
  const recent = await db
    .select({ status: healthSyncRuns.status, failureClass: healthSyncRuns.failureClass })
    .from(healthSyncRuns)
    .where(
      and(
        eq(healthSyncRuns.connectionId, input.connectionId),
        eq(healthSyncRuns.streamId, input.streamId),
      ),
    )
    .orderBy(desc(healthSyncRuns.startedAt), desc(healthSyncRuns.id))
    .limit(BREAKER_THRESHOLD);

  if (recent.length < BREAKER_THRESHOLD) return { tripped: false, failureClass: null };

  const first = recent[0]!;
  const failureClass = first.failureClass;
  if (first.status !== "failed" || failureClass === null) {
    return { tripped: false, failureClass: null };
  }
  if (RETRYABLE_FAILURE_CLASSES.has(failureClass)) return { tripped: false, failureClass: null };

  // IDENTICAL, not merely "all failed". A stream alternating between two
  // different faults is flapping, which is a different problem with a different
  // answer; only a stable, reproducible, non-retryable fault is evidence that
  // the request itself is wrong.
  const allIdentical = recent.every(
    (r) => r.status === "failed" && r.failureClass === failureClass,
  );
  if (!allIdentical) return { tripped: false, failureClass: null };

  await db
    .update(healthMetricStreams)
    .set({
      // Parsed through the Zod enum on WRITE, not just on read. The column is
      // unconstrained `text` by ADR-050 (so adding a metric never needs a DROP
      // CONSTRAINT migration), which makes this enum the only gate that exists.
      //
      // `provider_error` rather than `not_supported`: a repeated non-retryable
      // fault is exactly as consistent with a defect in OUR request as with a
      // capability Google lacks -- that is the whole 6.2P lesson, where two of
      // our own request-shape bugs were reported as eight unsupported metrics.
      // `not_supported` is reserved for an evidenced provider reason token and
      // is never reached by inference.
      capabilityStatus: HealthCapabilityStatusSchema.parse("provider_error"),
      capabilityCheckedAt: now,
      syncEnabled: false,
      lastSyncError: failureClass,
      updatedAt: now,
    })
    .where(eq(healthMetricStreams.id, input.streamId));

  return { tripped: true, failureClass };
}
