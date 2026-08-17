import type { FastifyInstance } from "fastify";
import { PgBoss } from "pg-boss";
import { env } from "../env.js";
import {
  CAPTURE_PARSE_QUEUE,
  NOTIFICATIONS_DISPATCH_DEAD_QUEUE,
  NOTIFICATIONS_DISPATCH_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  PTT_TRANSCRIBE_DEAD_QUEUE,
  PTT_TRANSCRIBE_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "../queue-names.js";

declare module "fastify" {
  interface FastifyInstance {
    boss: PgBoss;
    /** False if pg-boss failed to start -- routes must degrade gracefully
     * (capture is still written to inbox_items; only the enqueue step is
     * skipped) rather than 500. */
    bossReady: boolean;
  }
}

const START_RETRY_ATTEMPTS = 5;
const START_RETRY_DELAY_MS = 1000;

// The API only ever enqueues (boss.send); it never calls boss.work -- job
// processing is the worker's job. Unlike the worker's infinite start retry
// (it has nothing else to do), the API must still come up and serve
// /health even if pg-boss/Postgres is down at boot, so this retry is short
// and bounded.
export async function registerBoss(app: FastifyInstance): Promise<void> {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    migrate: false,
    createSchema: false,
  });
  boss.on("error", (err: Error) => {
    app.log.error({ err }, "pg-boss error");
  });

  app.decorate("boss", boss);
  app.decorate("bossReady", false);

  for (let attempt = 1; attempt <= START_RETRY_ATTEMPTS; attempt++) {
    try {
      await boss.start();
      app.bossReady = true;
      break;
    } catch (err) {
      app.log.warn({ err, attempt }, "pg-boss failed to start");
      if (attempt < START_RETRY_ATTEMPTS) {
        await new Promise((resolve) => setTimeout(resolve, START_RETRY_DELAY_MS));
      }
    }
  }

  if (app.bossReady) {
    // Idempotent -- safe regardless of whether the worker (which owns job
    // handler registration) has started yet or already created these. Must
    // pass the same retry options the worker uses (see QUEUE_RETRY_OPTIONS)
    // since whichever process creates the queue first wins.
    await boss.createQueue(CAPTURE_PARSE_QUEUE, QUEUE_RETRY_OPTIONS[CAPTURE_PARSE_QUEUE]);
    await boss.createQueue(
      OCCURRENCES_GENERATE_LAZY_QUEUE,
      QUEUE_RETRY_OPTIONS[OCCURRENCES_GENERATE_LAZY_QUEUE],
    );
    // The dead-letter queue must exist before its primary queue because
    // pg-boss enforces a foreign key from queue.dead_letter to queue.name.
    // API and worker both create these identically so startup order cannot
    // silently remove terminal-failure handling.
    await boss.createQueue(PTT_TRANSCRIBE_DEAD_QUEUE);
    await boss.createQueue(PTT_TRANSCRIBE_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[PTT_TRANSCRIBE_QUEUE],
      deadLetter: PTT_TRANSCRIBE_DEAD_QUEUE,
    });
    await boss.createQueue(NOTIFICATIONS_DISPATCH_DEAD_QUEUE);
    await boss.createQueue(NOTIFICATIONS_DISPATCH_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[NOTIFICATIONS_DISPATCH_QUEUE],
      deadLetter: NOTIFICATIONS_DISPATCH_DEAD_QUEUE,
    });
  } else {
    app.log.error(
      "pg-boss did not start after retries; capture/occurrence/transcription/notification jobs will not be enqueued",
    );
  }

  app.addHook("onClose", async () => {
    if (app.bossReady) await boss.stop();
  });
}
