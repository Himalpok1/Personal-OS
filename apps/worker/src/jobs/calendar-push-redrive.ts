import { eventExternalLinks, type Db } from "@personal-os/db";
import { and, eq, lt, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";

// Pending-push redrive (Checkpoint 9.5, contract §4/§8).
//
// Every local mutation of a linked local event sets
// `event_external_links.sync_status = 'pending_push'` INSIDE its own
// transaction and enqueues `calendar.google.push-event` AFTER commit. The row
// is the durable intent; the job is the delivery. If `boss.send` fails after
// the commit (pg-boss down at the API, a dropped connection between the two
// statements), the intent is recorded and nothing carries it -- so this sweep
// re-enqueues every link that has been `pending_push` for longer than the
// push job could plausibly still be in flight.
//
// Five minutes: the push queue retries 5x with 15s exponential backoff
// (15+30+60+120+240 s ~ 8 min end to end), so a link younger than five minutes
// may legitimately still be mid-retry. Re-sending for those is harmless but
// pointless, and a tighter window would turn every ordinary retry chain into
// a duplicate send. A link older than that with no live job is exactly the
// lost-enqueue case.
//
// `singletonKey` DOES NOT collapse anything here (fixer review, MINOR-7): the
// push queue runs under pg-boss's default `standard` policy, where the key is
// inert -- a second send lands as a second job. It is passed for parity with
// the API's enqueue and would become meaningful only under a `stately`/
// `singleton` policy, which this queue must not adopt (see queue-names.ts on
// the retry-drop hazard). The design tolerates duplicate pushes because the
// push handler is idempotent by construction (link-derived Google id / CalDAV
// href, 409 / 412 -> adopt), so a redundant redrive costs one no-op write.
//
// Called from the existing calendar refresh cron handler (every five minutes)
// rather than from a schedule of its own: one fewer pg-boss row to keep in
// parity between the two processes, and the cadence is already right.

/** How long a link may sit `pending_push` before it is assumed to have lost its job. */
export const REDRIVE_STALE_AFTER_MS = 5 * 60_000;

export async function redrivePendingCalendarPushes(
  db: Db,
  boss: PgBoss,
  now: Date = new Date(),
): Promise<{ scanned: number; sent: number; failed: number }> {
  const cutoff = new Date(now.getTime() - REDRIVE_STALE_AFTER_MS);
  const stale = await db
    .select({ eventId: eventExternalLinks.eventId })
    .from(eventExternalLinks)
    .where(
      and(
        eq(eventExternalLinks.syncStatus, "pending_push"),
        lt(eventExternalLinks.updatedAt, sql`${cutoff.toISOString()}::timestamptz`),
      ),
    );

  let sent = 0;
  let failed = 0;
  for (const row of stale) {
    try {
      // `singletonKey` alone -- never `singletonSeconds` (contract §8): pg-boss
      // keeps a COMPLETED job in the seconds slot and silently drops the next
      // send, which is the opposite of what a redrive is for. Under the
      // queue's `standard` policy the bare key dedupes nothing (see above).
      const jobId = await boss.send(
        CALENDAR_PUSH_EVENT_QUEUE,
        { eventId: row.eventId },
        { singletonKey: row.eventId },
      );
      if (jobId !== null) sent += 1;
    } catch (err) {
      failed += 1;
      log.warn("calendar.push_redrive.send_failed", {
        eventId: row.eventId,
        error: errorToken(err),
      });
    }
  }

  log.info("calendar.push_redrive.completed", {
    scanned: stale.length,
    sent,
    failed,
    staleAfterMs: REDRIVE_STALE_AFTER_MS,
  });
  return { scanned: stale.length, sent, failed };
}
