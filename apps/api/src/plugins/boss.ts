import type { FastifyInstance } from "fastify";
import { PgBoss } from "pg-boss";
import { env } from "../env.js";
import {
  CALENDAR_PUSH_EVENT_DEAD_QUEUE,
  CALENDAR_PUSH_EVENT_QUEUE,
  CALENDAR_REFRESH_TOKEN_DEAD_QUEUE,
  CALENDAR_REFRESH_TOKEN_QUEUE,
  CALENDAR_SYNC_CALENDAR_DEAD_QUEUE,
  CALENDAR_SYNC_CALENDAR_QUEUE,
  CAPTURE_PARSE_DEAD_QUEUE,
  CAPTURE_PARSE_QUEUE,
  HEALTH_SYNC_CONNECTION_QUEUE,
  MAIL_DIGEST_GENERATE_QUEUE,
  MAIL_SYNC_CONNECTION_QUEUE,
  MONITOR_RUN_QUEUE,
  NOTIFICATIONS_DISPATCH_DEAD_QUEUE,
  NOTIFICATIONS_DISPATCH_QUEUE,
  OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
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
    // Checkpoint 8.6A. Dead queue first (queue.dead_letter is a FK against
    // queue.name), then createQueue for a fresh database, then updateQueue --
    // which is what actually attaches the dead-letter on every EXISTING
    // deployment, because create_queue ends in ON CONFLICT DO NOTHING and so
    // silently discards the option on a queue that already exists. Both
    // processes do this identically; whichever starts first wins, and either
    // order produces the same end state.
    await boss.createQueue(CAPTURE_PARSE_DEAD_QUEUE);
    await boss.createQueue(CAPTURE_PARSE_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[CAPTURE_PARSE_QUEUE],
      deadLetter: CAPTURE_PARSE_DEAD_QUEUE,
    });
    await boss.updateQueue(CAPTURE_PARSE_QUEUE, { deadLetter: CAPTURE_PARSE_DEAD_QUEUE });
    // Checkpoint 9.0: the same three steps for occurrences.generate-lazy, which
    // this process sends to from the occurrence complete/skip routes. The
    // handler for the dead queue lives in the worker
    // (jobs/occurrences-dead-letter.ts); this process only guarantees the
    // queue exists and is attached whichever process boots first. The
    // expand-window queue is worker-only and is not created here.
    await boss.createQueue(OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE);
    await boss.createQueue(OCCURRENCES_GENERATE_LAZY_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[OCCURRENCES_GENERATE_LAZY_QUEUE],
      deadLetter: OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
    });
    await boss.updateQueue(OCCURRENCES_GENERATE_LAZY_QUEUE, {
      deadLetter: OCCURRENCES_GENERATE_LAZY_DEAD_QUEUE,
    });
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
    // Phase 4 Checkpoint 4.5 Stage B -- apps/api only ever sends to these
    // (POST /calendar-connections/:id/sync-now sends CALENDAR_SYNC_CALENDAR_QUEUE
    // jobs directly; the others are worker-internal but must still be
    // created identically here since whichever process starts first wins
    // the queue's options).
    await boss.createQueue(CALENDAR_REFRESH_TOKEN_DEAD_QUEUE);
    await boss.createQueue(CALENDAR_REFRESH_TOKEN_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[CALENDAR_REFRESH_TOKEN_QUEUE],
      deadLetter: CALENDAR_REFRESH_TOKEN_DEAD_QUEUE,
    });
    await boss.createQueue(CALENDAR_SYNC_CALENDAR_DEAD_QUEUE);
    await boss.createQueue(CALENDAR_SYNC_CALENDAR_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[CALENDAR_SYNC_CALENDAR_QUEUE],
      deadLetter: CALENDAR_SYNC_CALENDAR_DEAD_QUEUE,
    });
    await boss.createQueue(CALENDAR_PUSH_EVENT_DEAD_QUEUE);
    await boss.createQueue(CALENDAR_PUSH_EVENT_QUEUE, {
      ...QUEUE_RETRY_OPTIONS[CALENDAR_PUSH_EVENT_QUEUE],
      deadLetter: CALENDAR_PUSH_EVENT_DEAD_QUEUE,
    });
    // Checkpoint 9.5: the third step, for the same reason as capture.parse and
    // occurrences.generate-lazy above. This process sends to push-event from
    // POST/PATCH /events and the archive route; the queue has existed in
    // production since Phase 4 WITHOUT a dead letter, so the createQueue
    // above is a silent no-op there and only this UPDATE attaches it.
    await boss.updateQueue(CALENDAR_PUSH_EVENT_QUEUE, {
      deadLetter: CALENDAR_PUSH_EVENT_DEAD_QUEUE,
    });
    // Phase 6 Checkpoint 6.3. apps/api sends to this queue from
    // POST /health-connections/:id/sync and the backfill routes; the worker
    // owns the handler. Created identically in both processes because
    // create_queue is INSERT ... ON CONFLICT DO NOTHING and whichever
    // process starts first wins the options -- if the API created it without
    // `policy: "stately"`, the worker's option would be silently discarded
    // and the per-connection depth bound would be lost.
    //
    // Deliberately NO dead-letter queue: retryLimit is 0, so no job can ever
    // exhaust retries. See the long comment in queue-names.ts.
    await boss.createQueue(
      HEALTH_SYNC_CONNECTION_QUEUE,
      QUEUE_RETRY_OPTIONS[HEALTH_SYNC_CONNECTION_QUEUE],
    );
    // Phase 7 Checkpoint 7.3. apps/api does NOT yet send to this queue -- the
    // manual "sync now" route is Checkpoint 7.6's -- but it must still create it
    // identically, because create_queue is INSERT ... ON CONFLICT DO NOTHING and
    // WHICHEVER PROCESS STARTS FIRST WINS THE OPTIONS. An API-first boot that
    // created it without `policy: "stately"` and `retryLimit: 0` would silently
    // discard the worker's, losing the per-connection depth bound and
    // re-introducing the stately retry-drop interaction those options exist to
    // remove. queue-parity.test.ts asserts the two declarations agree.
    //
    // Deliberately NO dead-letter queue: retryLimit is 0, so no job can ever
    // exhaust retries. See the long comment in queue-names.ts.
    await boss.createQueue(
      MAIL_SYNC_CONNECTION_QUEUE,
      QUEUE_RETRY_OPTIONS[MAIL_SYNC_CONNECTION_QUEUE],
    );
    // Phase 7 Checkpoint 7.4. apps/api does not send to this queue either --
    // an on-demand "generate now" route is Checkpoint 7.6's -- but it must be
    // created identically here for the same first-writer-wins reason.
    await boss.createQueue(
      MAIL_DIGEST_GENERATE_QUEUE,
      QUEUE_RETRY_OPTIONS[MAIL_DIGEST_GENERATE_QUEUE],
    );
    // Phase 7 Checkpoint 7.5. apps/api does not send to this queue -- the sweep
    // is worker-owned, and the API's own monitoring work (the heartbeat
    // watchdog) runs on an interval rather than through a queue. It is created
    // identically here for the same first-writer-wins reason as every other
    // shared queue: create_queue is INSERT ... ON CONFLICT DO NOTHING.
    await boss.createQueue(MONITOR_RUN_QUEUE, QUEUE_RETRY_OPTIONS[MONITOR_RUN_QUEUE]);
  } else {
    app.log.error(
      "pg-boss did not start after retries; capture/occurrence/transcription/notification jobs will not be enqueued",
    );
  }

  app.addHook("onClose", async () => {
    if (app.bossReady) await boss.stop();
  });
}
