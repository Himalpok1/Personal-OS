import type { Db } from "@personal-os/db";
import type { GoogleHealthClient } from "@personal-os/health-providers";
import type { Job, PgBoss } from "pg-boss";
import {
  enqueueHealthSyncForAllActiveConnections,
  runHealthConnectionSync,
  type HealthSyncConnectionJobData,
  type HealthSyncDeps,
} from "../health/orchestrate.js";

// The `health.google.sync-connection` pg-boss handler.
//
// Deliberately thin. Every decision lives in ../health/orchestrate.ts, which
// exports a bare `runHealthConnectionSync(deps, data)` the tests call directly
// -- the same split calendar-sync-calendar.ts uses (`runCalendarSync` plus a
// `create...Handler` factory). A handler that owned logic would only be
// testable by constructing pg-boss `Job` objects, which buys nothing and makes
// every test carry queue plumbing it does not care about.

export type { HealthSyncConnectionJobData };

/**
 * There is NO dead-letter handler and NO dead-letter queue for this job.
 *
 * The queue is registered `retryLimit: 0` (see queue-names.ts): under
 * `policy: "stately"` pg-boss can DROP a retry insert on conflict and push a
 * merely-transient first failure straight to a dead-letter queue, skipping the
 * remaining retries. Removing retries removes the interaction entirely.
 *
 * The hourly cron is the retry, and a better one: it re-derives the window from
 * current state rather than replaying a stale job payload. Provider-level
 * retries live in the limiter, bounded and full-jittered.
 */
export function createHealthSyncConnectionHandler(
  db: Db,
  client: GoogleHealthClient,
  boss?: PgBoss | null,
  limiterFactory?: HealthSyncDeps["limiterFactory"],
): (jobs: Job<HealthSyncConnectionJobData>[]) => Promise<void> {
  return async function handleHealthSyncConnection(jobs) {
    for (const job of jobs) {
      // Sequential, never Promise.all. Two jobs in one batch for the SAME
      // connection would both find the advisory lock and one would skip -- but
      // two jobs for two different connections running concurrently would share
      // neither a limiter nor a QPS ceiling, which is exactly the fan-out the
      // limiter exists to prevent.
      await runHealthConnectionSync(
        {
          db,
          client,
          boss: boss ?? null,
          ...(limiterFactory ? { limiterFactory } : {}),
        },
        job.data,
      );
    }
  };
}

export { enqueueHealthSyncForAllActiveConnections };
