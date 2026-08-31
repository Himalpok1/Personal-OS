import { createCalDavClient, createGoogleCalendarClient } from "@personal-os/calendar-providers";
import { createDbClient } from "@personal-os/db";
import { PgBoss } from "pg-boss";
import { createCaptureParseHandler } from "./jobs/capture-parse.js";
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
import {
  createNotificationsDispatchDeadLetterHandler,
  createNotificationsDispatchHandler,
} from "./jobs/notifications-dispatch.js";
import {
  createPttTranscribeDeadLetterHandler,
  createPttTranscribeHandler,
} from "./jobs/ptt-transcribe.js";
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
  CAPTURE_PARSE_QUEUE,
  HEALTH_SYNC_CONNECTION_QUEUE,
  MAIL_SYNC_CONNECTION_QUEUE,
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

const SWEEP_ORPHAN_AUDIO_QUEUE = "audio.sweep-orphan";

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
  await boss.createQueue(MAIL_SYNC_CONNECTION_QUEUE, QUEUE_RETRY_OPTIONS[MAIL_SYNC_CONNECTION_QUEUE]);
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

  // Structured rather than a sentence: the old line was a single interpolated
  // string listing every queue, which is unsearchable, unparseable, and grows a
  // clause per checkpoint.
  log.info("worker.started", {
    queues: 9,
    schedules: 7,
    mailSyncCron: MAIL_SYNC_CRON_QUEUE,
    healthSyncCron: HEALTH_SYNC_CRON_QUEUE,
    calendarSyncCron: CALENDAR_SYNC_CRON_QUEUE,
  });
}

main().catch((err: unknown) => {
  log.error("worker.fatal", { error: errorToken(err) });
  process.exit(1);
});
