import type { Db } from "@personal-os/db";
import type { Job, PgBoss } from "pg-boss";
import { runMonitorPass, type MonitorRunDeps } from "../monitor/run.js";
import { MONITOR_RUN_QUEUE } from "../queue-names.js";
import { withMonitorJobErrorContainment } from "./monitor-job-error.js";

// The `monitor.run` pg-boss handler.
//
// Deliberately thin, matching every other job in this process: the decisions
// live in ../monitor/run.ts, which exports a bare `runMonitorPass(deps)` the
// tests call directly. A handler that owned logic would only be testable by
// constructing pg-boss `Job` objects, which buys nothing.
//
// NO DEAD-LETTER QUEUE AND NO RETRY, for the reason recorded in queue-names.ts:
// under `policy: "stately"` pg-boss can drop a retry insert on conflict and push
// a merely-transient first failure straight to a handler meant for terminal
// cleanup. The cron tick is the retry, and a better one -- it re-reads targets
// and check history from current state rather than replaying a stale payload.

export type MonitorRunJobData = Record<string, never>;

export function createMonitorRunHandler(
  db: Db,
  boss?: PgBoss | null,
  overrides: Omit<MonitorRunDeps, "db" | "boss"> = {},
): (jobs: Job<MonitorRunJobData>[]) => Promise<void> {
  const handler = async (jobs: Job<MonitorRunJobData>[]): Promise<void> => {
    // ONE PASS PER BATCH, not one per job. The queue's `stately` policy plus a
    // fixed singletonKey already collapses concurrent requests onto one slot, so
    // several jobs arriving together are several requests for the SAME sweep.
    // Running it once per job would probe every target twice and write duplicate
    // checks, which would corrupt the very history the thresholds are derived
    // from.
    if (jobs.length === 0) return;
    await runMonitorPass({ db, boss: boss ?? null, ...overrides });
  };

  return withMonitorJobErrorContainment(MONITOR_RUN_QUEUE, handler);
}

export { runMonitorPass };
