import type { Db } from "@personal-os/db";
import type { CanvasClient } from "@personal-os/canvas-providers";
import type { Job, PgBoss } from "pg-boss";
import {
  enqueueCanvasSyncForAllActiveConnections,
  runCanvasConnectionSync,
  type CanvasSyncDeps,
  type CanvasSyncJobData,
} from "../canvas/orchestrate.js";
import { withCanvasJobErrorContainment } from "../canvas/job-error.js";
import { CANVAS_SYNC_CONNECTION_QUEUE } from "../queue-names.js";

// The `canvas.sync-connection` pg-boss handler.
//
// Deliberately thin, mirroring apps/worker/src/jobs/mail-sync-connection.ts
// exactly: every decision lives in ../canvas/orchestrate.ts, which exports a
// bare `runCanvasConnectionSync(deps, data)` the tests call directly. A
// handler that owned logic would only be testable by constructing pg-boss
// `Job` objects, which buys nothing and makes every test carry queue
// plumbing it does not care about.
//
// THERE IS NO DEAD-LETTER HANDLER AND NO DEAD-LETTER QUEUE for this job, for
// the same documented reason as mail and health (see ../queue-names.ts): the
// queue is registered `retryLimit: 0` under `policy: "stately"`, so pg-boss
// can never drop a retry insert into the dead-letter path in the first
// place -- removing retries removes the interaction entirely. The hourly
// cron tick is the retry, and a better one: it re-derives every course from
// current provider state rather than replaying a stale payload.

export type { CanvasSyncJobData };

export function createCanvasSyncConnectionHandler(
  db: Db,
  client: CanvasClient,
  boss?: PgBoss | null,
): (jobs: Job<CanvasSyncJobData>[]) => Promise<void> {
  const handler = async (jobs: Job<CanvasSyncJobData>[]): Promise<void> => {
    for (const job of jobs) {
      // Sequential, never Promise.all -- two jobs for DIFFERENT connections
      // (different institutions, potentially) running concurrently would
      // share no per-account rate ceiling with each other's requests, which
      // is exactly the fan-out a serial loop prevents. Mirrors
      // createMailSyncConnectionHandler's identical reasoning.
      await runCanvasConnectionSync(
        {
          db,
          client,
          boss: boss ?? null,
        } satisfies CanvasSyncDeps,
        job.data,
      );
    }
  };

  // NOTHING RAW CROSSES THIS BOUNDARY. Same containment ADR-053 requires for
  // every mail handler, applied here per ADR-068 §5; see ../canvas/job-error.ts
  // for what pg-boss would otherwise persist.
  return withCanvasJobErrorContainment(CANVAS_SYNC_CONNECTION_QUEUE, handler);
}

export { enqueueCanvasSyncForAllActiveConnections };
