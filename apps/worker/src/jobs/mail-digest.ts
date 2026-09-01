import type { Db } from "@personal-os/db";
import type { Job } from "pg-boss";
import { runMailDigest, type MailDigestDeps } from "../mail/digest/run.js";
import { MAIL_DIGEST_GENERATE_QUEUE } from "../queue-names.js";
import { withMailJobErrorContainment } from "./mail-job-error.js";

// The `mail.digest.generate` pg-boss handler.
//
// Deliberately thin, matching `mail-sync-connection.ts` and
// `health-sync-connection.ts`: every decision lives in ../mail/digest/run.ts,
// which exports a bare `runMailDigest(deps)` the tests call directly. A handler
// that owned logic would only be testable by constructing pg-boss `Job` objects,
// which buys nothing.
//
// THERE IS NO DEAD-LETTER HANDLER AND NO DEAD-LETTER QUEUE. The queue is
// registered `retryLimit: 0` (see queue-names.ts): under `policy: "stately"`
// pg-boss can drop a retry insert on conflict and push a merely-transient first
// failure straight to a dead-letter handler meant for terminal cleanup. The
// daily cron is the retry, and a better one -- it re-collects from current state.

/** The job carries no payload: the digest is global and its key comes from config. */
export type MailDigestJobData = Record<string, never>;

export function createMailDigestHandler(
  db: Db,
  overrides: Omit<MailDigestDeps, "db"> = {},
): (jobs: Job<MailDigestJobData>[]) => Promise<void> {
  const handler = async (jobs: Job<MailDigestJobData>[]): Promise<void> => {
    // ONE PASS PER BATCH, not one per job. The queue's `stately` policy plus a
    // fixed singletonKey already collapses concurrent requests onto one slot, so
    // several jobs arriving together are several requests for the SAME digest.
    // Running the pass once per job would pay a provider call per duplicate and
    // race two upserts against one row for no benefit.
    if (jobs.length === 0) return;
    await runMailDigest({ db, ...overrides });
  };

  // NOTHING RAW CROSSES THIS BOUNDARY. Required by ADR-053 for every mail
  // handler, and load-bearing here specifically: this pass holds attacker-
  // authored subject lines in memory, and pg-boss serializes whatever a handler
  // throws into `pgboss.job.output`, a durable table.
  return withMailJobErrorContainment(MAIL_DIGEST_GENERATE_QUEUE, handler);
}

export { runMailDigest };
