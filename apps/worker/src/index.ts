import { createCalDavClient, createGoogleCalendarClient } from "@personal-os/calendar-providers";
import { createDbClient } from "@personal-os/db";
import { PgBoss } from "pg-boss";
import {
  createCaptureParseDeadLetterHandler,
  createCaptureParseHandler,
} from "./jobs/capture-parse.js";
import {
  createCalendarPushEventDeadLetterHandler,
  createCalendarPushEventHandler,
} from "./jobs/calendar-push-event.js";
import {
  createCalendarRefreshTokenDeadLetterHandler,
  createCalendarRefreshTokenHandler,
  enqueueCalendarRefreshForAllActiveConnections,
} from "./jobs/calendar-refresh-token.js";
import {
  createCalendarSyncCalendarDeadLetterHandler,
  createCalendarSyncCalendarHandler,
  enqueueCalendarSyncForAllEnabledCalendars,
} from "./jobs/calendar-sync-calendar.js";
import { expandDueDateWindowJob } from "./jobs/expand-due-date-window.js";
import {
  createHealthSyncConnectionHandler,
  enqueueHealthSyncForAllActiveConnections,
} from "./jobs/health-sync-connection.js";
import { createGenerateLazyOccurrenceHandler } from "./jobs/generate-lazy-occurrence.js";
import { createGoogleHealthClient } from "@personal-os/health-providers";
import { createGmailClient } from "@personal-os/mail-providers";
import {
  createMailSyncConnectionHandler,
  enqueueMailSyncForAllActiveConnections,
} from "./jobs/mail-sync-connection.js";
import { createMailDigestHandler } from "./jobs/mail-digest.js";
import { createMailDigestNotifier } from "./mail/digest/notify.js";
import { createMonitorRunHandler } from "./jobs/monitor-run.js";
import { resolveDigestTimezone } from "./mail/digest/run.js";
import {
  createNotificationsDispatchDeadLetterHandler,
  createNotificationsDispatchHandler,
} from "./jobs/notifications-dispatch.js";
import {
  createPttTranscribeDeadLetterHandler,
  createPttTranscribeHandler,
} from "./jobs/ptt-transcribe.js";
import { retentionCleanupJob } from "./jobs/retention-cleanup.js";
import { sweepOrphanAudioJob } from "./jobs/sweep-orphan-audio.js";
import { env } from "./env.js";
import { recordHeartbeat } from "./heartbeat.js";
import { errorToken, log } from "./logger.js";
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
  OCCURRENCES_EXPAND_WINDOW_QUEUE,
  OCCURRENCES_GENERATE_LAZY_QUEUE,
  PTT_TRANSCRIBE_DEAD_QUEUE,
  PTT_TRANSCRIBE_QUEUE,
  QUEUE_RETRY_OPTIONS,
} from "./queue-names.js";

// Local-only trigger queues (cron targets that fan out into the shared,
// api-visible queues above) -- same convention as HEARTBEAT_QUEUE and
// SWEEP_ORPHAN_AUDIO_QUEUE below: worker-internal, never sent to by apps/api,
// so they don't need to live in the shared queue-names.ts file.
const CALENDAR_SYNC_CRON_QUEUE = "calendar.google.sync-cron";
const CALENDAR_REFRESH_CRON_QUEUE = "calendar.google.refresh-cron";

const HEALTH_SYNC_CRON_QUEUE = "health.google.sync-cron";

const MAIL_SYNC_CRON_QUEUE = "mail.gmail.sync-cron";
const MAIL_DIGEST_CRON_QUEUE = "mail.digest.cron";
const MONITOR_CRON_QUEUE = "monitor.cron";

const SWEEP_ORPHAN_AUDIO_QUEUE = "audio.sweep-orphan";
/** Checkpoint 8.6C: bounded retention cleanup, see jobs/retention-cleanup.ts. */
const RETENTION_CLEANUP_QUEUE = "retention.cleanup";

const HEARTBEAT_QUEUE = "bootstrap.heartbeat";
const RETRY_DELAY_MS = 5000;

// Postgres restarting shouldn't crash-loop the worker.
async function startWithRetry(boss: PgBoss): Promise<void> {
  for (;;) {
    try {
      await boss.start();
      return;
    } catch (err) {
      // `errorToken`, never the error itself: pino-style `{ err }` logging walks
      // every enumerable property, and a `pg` DatabaseError carries `detail`.
      log.error("worker.pgboss.start_failed", {
        retryDelayMs: RETRY_DELAY_MS,
        error: errorToken(err),
      });
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
    log.error("worker.pgboss.error", { error: errorToken(err) });
  });

  await startWithRetry(boss);
  log.info("worker.pgboss.started");

  // COUNTED, NOT HARDCODED.
  //
  // The startup line used to carry literal `queues:` and `schedules:` numbers
  // that every checkpoint was expected to bump by hand. Checkpoint 7.5 found
  // both were already wrong -- it claimed 10 queues and 8 schedules against a
  // real boot that registers 25 and 9 -- so the line had been quietly lying for
  // several checkpoints, which is worse than carrying no number at all: an
  // operator comparing the log against `pgboss.queue` would have gone looking
  // for a registration failure that never happened.
  //
  // Wrapping the two methods once is a smaller and more durable fix than
  // correcting two literals that will drift again on the next checkpoint.
  let queueCount = 0;
  let scheduleCount = 0;
  const createQueue = boss.createQueue.bind(boss);
  const schedule = boss.schedule.bind(boss);
  boss.createQueue = async (...args: Parameters<typeof createQueue>) => {
    queueCount += 1;
    return await createQueue(...args);
  };
  boss.schedule = async (...args: Parameters<typeof schedule>) => {
    scheduleCount += 1;
    return await schedule(...args);
  };

  await boss.createQueue(HEARTBEAT_QUEUE);
  await boss.work(HEARTBEAT_QUEUE, async () => {
    await recordHeartbeat(db);
  });
  await boss.schedule(HEARTBEAT_QUEUE, "* * * * *");

  // Retry/backoff are queue-level defaults (set via createQueue), not
  // work() options -- pg-boss applies them to every job sent to the queue
  // unless overridden per-send. See QUEUE_RETRY_OPTIONS for why apps/api
  // must create these same two shared queues with identical options.
  // Checkpoint 8.6A: capture.parse gains a dead-letter queue. Dead queue
  // first -- queue.dead_letter is a foreign key against queue.name.
  await boss.createQueue(CAPTURE_PARSE_DEAD_QUEUE);
  await boss.createQueue(CAPTURE_PARSE_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[CAPTURE_PARSE_QUEUE],
    deadLetter: CAPTURE_PARSE_DEAD_QUEUE,
  });
  // AND THEN updateQueue, which is NOT redundant.
  //
  // pg-boss's create_queue ends in ON CONFLICT DO NOTHING, so on any database
  // where `capture.parse` already exists -- which is every deployed
  // environment, since this queue has run since Phase 1 -- the createQueue
  // above is a SILENT NO-OP and the deadLetter option is discarded. Tests run
  // against a fresh database where the INSERT does fire, so the no-op is
  // invisible to the suite: it would typecheck, pass, deploy, and change
  // nothing. That is the same failure shape as the Checkpoint 5.7 migration
  // no-op this project already has a frozen deployment order because of.
  //
  // updateQueue is pg-boss's supported UPDATE path (it sets queue.dead_letter
  // and evicts the queue cache), and it is idempotent, so running it on a
  // fresh database where createQueue already applied the option is harmless.
  await boss.updateQueue(CAPTURE_PARSE_QUEUE, { deadLetter: CAPTURE_PARSE_DEAD_QUEUE });
  await boss.work(CAPTURE_PARSE_DEAD_QUEUE, createCaptureParseDeadLetterHandler(db));
  await boss.work(CAPTURE_PARSE_QUEUE, createCaptureParseHandler(db, boss));

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

  // Dead-letter queues must exist before the primary queue that points at
  // them -- pg-boss's dead_letter column is a foreign key against
  // queue.name (verified directly against the installed pg-boss@12.27.0
  // source), not an auto-created convenience.
  await boss.createQueue(PTT_TRANSCRIBE_DEAD_QUEUE);
  await boss.work(PTT_TRANSCRIBE_DEAD_QUEUE, createPttTranscribeDeadLetterHandler(db));
  await boss.createQueue(PTT_TRANSCRIBE_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[PTT_TRANSCRIBE_QUEUE],
    deadLetter: PTT_TRANSCRIBE_DEAD_QUEUE,
  });
  await boss.work(PTT_TRANSCRIBE_QUEUE, createPttTranscribeHandler(db, boss));

  await boss.createQueue(NOTIFICATIONS_DISPATCH_DEAD_QUEUE);
  await boss.work(
    NOTIFICATIONS_DISPATCH_DEAD_QUEUE,
    createNotificationsDispatchDeadLetterHandler(db),
  );
  await boss.createQueue(NOTIFICATIONS_DISPATCH_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[NOTIFICATIONS_DISPATCH_QUEUE],
    deadLetter: NOTIFICATIONS_DISPATCH_DEAD_QUEUE,
  });
  await boss.work(NOTIFICATIONS_DISPATCH_QUEUE, createNotificationsDispatchHandler(db));

  await boss.createQueue(SWEEP_ORPHAN_AUDIO_QUEUE);
  await boss.work(SWEEP_ORPHAN_AUDIO_QUEUE, async () => {
    await sweepOrphanAudioJob(db);
  });
  // Hourly -- generous relative to the 2h orphan threshold, cheap to run.
  await boss.schedule(SWEEP_ORPHAN_AUDIO_QUEUE, "0 * * * *");

  // expireInSeconds is generous (1h, versus pg-boss's 15-minute default)
  // because every one of the five deletes is an unbatched, untimed
  // full-table scan by design (see retention-cleanup.ts) -- pg-boss's own
  // active-job expiry would otherwise redeliver this exact job into the
  // same worker process while the first pass is still genuinely running,
  // the moment any table's delete ever took longer than 15 minutes.
  // retryLimit: 0 for the same reason expand-due-date-window's neighbors
  // don't need pg-boss's own retry either: the daily cron IS the retry, and
  // a better one -- it recomputes every cutoff from the real current time
  // rather than replaying a stale one. Found by this checkpoint's own
  // adversarial review.
  await boss.createQueue(RETENTION_CLEANUP_QUEUE, { expireInSeconds: 3600, retryLimit: 0 });
  await boss.work(RETENTION_CLEANUP_QUEUE, async () => {
    await retentionCleanupJob(db);
  });
  // Daily, off-peak, after the 3am occurrences.expand-window pass. Retention
  // does not need to run every tick like a probe or a sync cron -- see
  // jobs/retention-cleanup.ts for why a daily cadence is more than enough at
  // this system's volume.
  await boss.schedule(RETENTION_CLEANUP_QUEUE, "0 4 * * *");

  // Phase 4 Checkpoint 4.5 & 4.6 (Google & CalDAV Calendar sync).
  const googleCalendarClient = createGoogleCalendarClient();
  const caldavClient = createCalDavClient();

  await boss.createQueue(CALENDAR_REFRESH_TOKEN_DEAD_QUEUE);
  await boss.work(
    CALENDAR_REFRESH_TOKEN_DEAD_QUEUE,
    createCalendarRefreshTokenDeadLetterHandler(db),
  );
  await boss.createQueue(CALENDAR_REFRESH_TOKEN_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[CALENDAR_REFRESH_TOKEN_QUEUE],
    deadLetter: CALENDAR_REFRESH_TOKEN_DEAD_QUEUE,
  });
  await boss.work(CALENDAR_REFRESH_TOKEN_QUEUE, createCalendarRefreshTokenHandler(db, boss));

  await boss.createQueue(CALENDAR_SYNC_CALENDAR_DEAD_QUEUE);
  await boss.work(
    CALENDAR_SYNC_CALENDAR_DEAD_QUEUE,
    createCalendarSyncCalendarDeadLetterHandler(db),
  );
  await boss.createQueue(CALENDAR_SYNC_CALENDAR_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[CALENDAR_SYNC_CALENDAR_QUEUE],
    deadLetter: CALENDAR_SYNC_CALENDAR_DEAD_QUEUE,
  });
  await boss.work(
    CALENDAR_SYNC_CALENDAR_QUEUE,
    createCalendarSyncCalendarHandler(db, googleCalendarClient, caldavClient),
  );

  await boss.createQueue(CALENDAR_PUSH_EVENT_DEAD_QUEUE);
  await boss.work(CALENDAR_PUSH_EVENT_DEAD_QUEUE, createCalendarPushEventDeadLetterHandler(db));
  await boss.createQueue(CALENDAR_PUSH_EVENT_QUEUE, {
    ...QUEUE_RETRY_OPTIONS[CALENDAR_PUSH_EVENT_QUEUE],
    deadLetter: CALENDAR_PUSH_EVENT_DEAD_QUEUE,
  });
  await boss.work(
    CALENDAR_PUSH_EVENT_QUEUE,
    createCalendarPushEventHandler(db, googleCalendarClient, caldavClient),
  );

  // Local trigger queues: fan out into the real per-connection/per-calendar
  // jobs above. 15-minute sync cadence per the B3 brief; refresh checks run
  // more often than the ~10-minute safety margin they enforce so a
  // near-expiry token is caught well before calendar.google.sync-calendar
  // would otherwise have to refresh it inline.
  await boss.createQueue(CALENDAR_SYNC_CRON_QUEUE);
  await boss.work(CALENDAR_SYNC_CRON_QUEUE, async () => {
    await enqueueCalendarSyncForAllEnabledCalendars(db, boss, CALENDAR_SYNC_CALENDAR_QUEUE);
  });
  await boss.schedule(CALENDAR_SYNC_CRON_QUEUE, "*/15 * * * *");

  await boss.createQueue(CALENDAR_REFRESH_CRON_QUEUE);
  await boss.work(CALENDAR_REFRESH_CRON_QUEUE, async () => {
    await enqueueCalendarRefreshForAllActiveConnections(db, boss, CALENDAR_REFRESH_TOKEN_QUEUE);
  });
  await boss.schedule(CALENDAR_REFRESH_CRON_QUEUE, "*/5 * * * *");

  // Phase 6 Checkpoint 6.3 (Google Health sync). ONE connection-level queue.
  //
  // No dead-letter queue and no pg-boss retry: QUEUE_RETRY_OPTIONS sets
  // retryLimit 0 because pg-boss's own manager.js:1293 documents that under
  // `policy: "stately"` a retry insert can be dropped by ON CONFLICT and the
  // job re-inserted as failed, straight to the dead-letter queue, skipping
  // its remaining retries. Health sync is idempotent and cron-driven, so the
  // hourly tick is the retry -- and a better one, because it re-derives the
  // window from current state rather than replaying a stale job. Provider-level
  // retries live in the limiter, bounded and full-jittered.
  const googleHealthClient = createGoogleHealthClient();
  await boss.createQueue(
    HEALTH_SYNC_CONNECTION_QUEUE,
    QUEUE_RETRY_OPTIONS[HEALTH_SYNC_CONNECTION_QUEUE],
  );
  await boss.work(
    HEALTH_SYNC_CONNECTION_QUEUE,
    createHealthSyncConnectionHandler(db, googleHealthClient, boss),
  );

  // Hourly, not every 30 minutes: the doc comment on hotWindow predates this
  // decision. Each tick fans out one job per ACTIVE connection; the effective
  // sync kind is derived from durable stream state inside the pass, never
  // trusted from the payload, so a tick that lands when a warm pass is due
  // performs the warm work.
  await boss.createQueue(HEALTH_SYNC_CRON_QUEUE);
  await boss.work(HEALTH_SYNC_CRON_QUEUE, async () => {
    await enqueueHealthSyncForAllActiveConnections(db, boss, HEALTH_SYNC_CONNECTION_QUEUE);
  });
  await boss.schedule(HEALTH_SYNC_CRON_QUEUE, "0 * * * *");

  // Phase 7 Checkpoint 7.3 (Gmail sync). ONE connection-level queue, and no
  // dead-letter queue -- QUEUE_RETRY_OPTIONS sets retryLimit 0 for the reason
  // recorded there and above for health: under `policy: "stately"` pg-boss can
  // drop a retry insert on conflict and re-insert the job as failed, straight
  // past its remaining retries. Mail sync is idempotent and cron-driven, so the
  // tick is the retry; provider-level retries live in the limiter, which unlike
  // health's honours Retry-After.
  const gmailClient = createGmailClient();
  await boss.createQueue(
    MAIL_SYNC_CONNECTION_QUEUE,
    QUEUE_RETRY_OPTIONS[MAIL_SYNC_CONNECTION_QUEUE],
  );
  await boss.work(
    MAIL_SYNC_CONNECTION_QUEUE,
    createMailSyncConnectionHandler(db, gmailClient, boss),
  );

  // Every 15 minutes, matching the calendar cadence rather than health's hourly
  // one: mail is the input to a daily digest, but a mailbox that is four hours
  // stale is visibly wrong in a way a four-hour-old step count is not. Each tick
  // fans out one job per ACTIVE connection, deduped on the connection id by the
  // queue's stately policy, so a tick landing while a pass is still running adds
  // nothing.
  //
  // A deployment with no Gmail credentials still runs this; the pass reads the
  // connection table, finds nothing active, and returns. That is deliberate --
  // the alternative is a startup-time branch that silently stops scheduling if
  // credentials arrive later.
  await boss.createQueue(MAIL_SYNC_CRON_QUEUE);
  await boss.work(MAIL_SYNC_CRON_QUEUE, async () => {
    await enqueueMailSyncForAllActiveConnections(db, boss, MAIL_SYNC_CONNECTION_QUEUE);
  });
  await boss.schedule(MAIL_SYNC_CRON_QUEUE, "*/15 * * * *");

  // Phase 7 Checkpoint 7.4 (mail digest). One queue, no dead-letter, for the
  // reason recorded in queue-names.ts.
  await boss.createQueue(
    MAIL_DIGEST_GENERATE_QUEUE,
    QUEUE_RETRY_OPTIONS[MAIL_DIGEST_GENERATE_QUEUE],
  );
  await boss.work(
    MAIL_DIGEST_GENERATE_QUEUE,
    // The notifier is injected rather than constructed inside the handler so a
    // pass can be run with no queue at all -- which is how every digest test
    // runs, and how a one-shot manual pass would run.
    createMailDigestHandler(db, { notify: createMailDigestNotifier(db, boss) }),
  );

  // Daily, at 07:00 IN THE CONFIGURED DIGEST ZONE rather than the server's.
  //
  // The zone is passed to pg-boss explicitly so "07:00" means the local morning
  // the digest is about. Without it a UTC container would generate the "today"
  // digest at whatever local hour UTC 07:00 happens to be -- which for a
  // US-Central user is 1am, describing a window that ends before the day it is
  // named after has really begun.
  //
  // ADR-053 separates generation from notification: generation always occurs on
  // schedule and always persists, and the notification is a separate, contained
  // step that cannot undo the write. Checkpoint 7.6 added that step -- and with
  // it amendment E's requirement that quiet hours DELAY the notification rather
  // than suppress it, which `createMailDigestNotifier` implements by scheduling
  // each device's job past its own quiet window instead of dropping it.
  const digestTimezone = resolveDigestTimezone();
  await boss.createQueue(MAIL_DIGEST_CRON_QUEUE);
  await boss.work(MAIL_DIGEST_CRON_QUEUE, async () => {
    // A fixed singletonKey: the digest is GLOBAL, so there is exactly one job
    // worth having in flight regardless of how many ticks or requests arrive.
    await boss.send(MAIL_DIGEST_GENERATE_QUEUE, {}, { singletonKey: "mail-digest" });
  });
  await boss.schedule(MAIL_DIGEST_CRON_QUEUE, "0 7 * * *", {}, { tz: digestTimezone });

  // Phase 7 Checkpoint 7.5 (service monitoring). ONE queue, no dead-letter, for
  // the reason recorded in queue-names.ts.
  //
  // EVERY `http` TARGET IS SWEPT HERE; the `worker_heartbeat` target is
  // deliberately NOT, and the omission is the point of ADR-055's split -- a
  // worker-hosted monitor cannot alert on its own death, so that one check runs
  // in the API process instead.
  await boss.createQueue(MONITOR_RUN_QUEUE, QUEUE_RETRY_OPTIONS[MONITOR_RUN_QUEUE]);
  await boss.work(MONITOR_RUN_QUEUE, createMonitorRunHandler(db, boss));

  // Every minute. The CRON is the upper bound on responsiveness; each target's
  // own `interval_seconds` is what actually paces it, so a one-minute tick lets
  // a 60-second target be genuinely 60-second without forcing a five-minute one
  // to be checked more often than configured.
  await boss.createQueue(MONITOR_CRON_QUEUE);
  await boss.work(MONITOR_CRON_QUEUE, async () => {
    // A fixed singletonKey: a pass is a sweep over every target, so there is
    // exactly one job worth having in flight however many ticks arrive.
    await boss.send(MONITOR_RUN_QUEUE, {}, { singletonKey: "monitor-run" });
  });
  await boss.schedule(MONITOR_CRON_QUEUE, "* * * * *");

  // Structured rather than a sentence: the old line was a single interpolated
  // string listing every queue, which is unsearchable, unparseable, and grows a
  // clause per checkpoint.
  log.info("worker.started", {
    queues: queueCount,
    schedules: scheduleCount,
    mailSyncCron: MAIL_SYNC_CRON_QUEUE,
    mailDigestCron: MAIL_DIGEST_CRON_QUEUE,
    monitorCron: MONITOR_CRON_QUEUE,
    digestTimezone,
    healthSyncCron: HEALTH_SYNC_CRON_QUEUE,
    calendarSyncCron: CALENDAR_SYNC_CRON_QUEUE,
  });
}

main().catch((err: unknown) => {
  log.error("worker.fatal", { error: errorToken(err) });
  process.exit(1);
});
