import { createDbClient } from "@personal-os/db";
import { PgBoss } from "pg-boss";
import { createCaptureParseHandler } from "./jobs/capture-parse.js";
import { expandDueDateWindowJob } from "./jobs/expand-due-date-window.js";
import { createGenerateLazyOccurrenceHandler } from "./jobs/generate-lazy-occurrence.js";
import { env } from "./env.js";
import { recordHeartbeat } from "./heartbeat.js";
import {
  CAPTURE_PARSE_QUEUE,
  OCCURRENCES_EXPAND_WINDOW_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "./queue-names.js";

const HEARTBEAT_QUEUE = "bootstrap.heartbeat";
const RETRY_DELAY_MS = 5000;

// Postgres restarting shouldn't crash-loop the worker.
async function startWithRetry(boss: PgBoss): Promise<void> {
  for (;;) {
    try {
      await boss.start();
      return;
    } catch (err) {
      console.error(`pg-boss failed to start, retrying in ${RETRY_DELAY_MS}ms`, err);
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
    }
  }
}

async function main(): Promise<void> {
  const db = createDbClient(env.DATABASE_URL);

  // pg-boss's own schema is pre-created once by the migrator role (see
  // `pg-boss migrate` in docs/STATUS.md); the worker always runs with
  // migrate/createSchema off and connects with the least-privilege app role.
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
  });

  boss.on("error", (err: Error) => {
    console.error("pg-boss error", err);
  });

  await startWithRetry(boss);
  console.log("pg-boss started");

  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.work(HEARTBEAT_QUEUE, async () => {
    await recordHeartbeat(db);
  });
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *");

  // Retry/backoff are queue-level defaults (set via createQueue), not
  // work() options -- pg-boss applies them to every job sent to the queue
  // unless overridden per-send. See QUEUE_RETRY_OPTIONS for why apps/api
  // must create these same two shared queues with identical options.
  await boss.createQueue(CAPTURE_PARSE_QUEUE, QUEUE_RETRY_OPTIONS[CAPTURE_PARSE_QUEUE]);
  await boss.work(CAPTURE_PARSE_QUEUE, createCaptureParseHandler(db));

  await boss.createQueue(
    OCCURRENCES_EXPAND_WINDOW_QUEUE,
    QUEUE_RETRY_OPTIONS[OCCURRENCES_EXPAND_WINDOW_QUEUE],
  );
  await boss.work(OCCURRENCES_EXPAND_WINDOW_QUEUE, async () => {
    await expandDueDateWindowJob(db);
  });
  // 3am server-local trigger time; the *content* of the expansion (each
  // occurrence's instant) is governed by each rule's own recurrence_timezone,
  // which matters far more than the cron trigger's timezone.
  await boss.schedule(OCCURRENCES_EXPAND_WINDOW_QUEUE, "0 3 * * *");

  await boss.createQueue(
    OCCURRENCES_GENERATE_LAZY_QUEUE,
    QUEUE_RETRY_OPTIONS[OCCURRENCES_GENERATE_LAZY_QUEUE],
  );
  await boss.work(OCCURRENCES_GENERATE_LAZY_QUEUE, createGenerateLazyOccurrenceHandler(db));

  console.log(
    `worker started: ${HEARTBEAT_QUEUE} scheduled every minute, ${OCCURRENCES_EXPAND_WINDOW_QUEUE} scheduled nightly, ${CAPTURE_PARSE_QUEUE}/${OCCURRENCES_GENERATE_LAZY_QUEUE} listening`,
  );
}

main().catch((err: unknown) => {
  console.error("worker fatal error", err);
  process.exit(1);
});
