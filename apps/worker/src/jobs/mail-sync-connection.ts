import type { Db } from "@personal-os/db";
import type { MailClient } from "@personal-os/mail-providers";
import type { Job, PgBoss } from "pg-boss";
import {
  enqueueMailSyncForAllActiveConnections,
  runMailConnectionSync,
  type MailSyncDeps,
  type MailSyncJobData,
} from "../mail/orchestrate.js";
import { MAIL_SYNC_CONNECTION_QUEUE } from "../queue-names.js";
import { withMailJobErrorContainment } from "./mail-job-error.js";

// The `mail.gmail.sync-connection` pg-boss handler.
//
// Deliberately thin. Every decision lives in ../mail/orchestrate.ts, which
// exports a bare `runMailConnectionSync(deps, data)` the tests call directly --
// the same split health-sync-connection.ts and calendar-sync-calendar.ts both
// use. A handler that owned logic would only be testable by constructing
// pg-boss `Job` objects, which buys nothing and makes every test carry queue
// plumbing it does not care about.
//
// THERE IS NO DEAD-LETTER HANDLER AND NO DEAD-LETTER QUEUE for this job. The
// queue is registered `retryLimit: 0` (see queue-names.ts): under
// `policy: "stately"` pg-boss can DROP a retry insert on conflict and push a
// merely-transient first failure straight to a dead-letter queue, skipping the
// remaining retries. Removing retries removes the interaction entirely. The
// cron tick is the retry, and a better one -- it re-derives the cursor from
// current state rather than replaying a stale payload.

export type { MailSyncJobData };

export function createMailSyncConnectionHandler(
  db: Db,
  client: MailClient,
  boss?: PgBoss | null,
  limiterFactory?: MailSyncDeps["limiterFactory"],
): (jobs: Job<MailSyncJobData>[]) => Promise<void> {
  const handler = async (jobs: Job<MailSyncJobData>[]): Promise<void> => {
    for (const job of jobs) {
      // Sequential, never Promise.all. Two jobs for the SAME connection would
      // both meet the advisory lock and one would skip -- but two jobs for two
      // DIFFERENT connections running concurrently would share neither a
      // limiter nor a QPS ceiling, which is exactly the fan-out the limiter
      // exists to prevent. Gmail's quota is per user, so two mailboxes on one
      // Google account would compete for the same 6,000 units a minute.
      await runMailConnectionSync(
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

  // NOTHING RAW CROSSES THIS BOUNDARY. Required by ADR-053 for every mail
  // handler; see mail-job-error.ts for what pg-boss would otherwise persist.
  return withMailJobErrorContainment(MAIL_SYNC_CONNECTION_QUEUE, handler);
}

export { enqueueMailSyncForAllActiveConnections };
