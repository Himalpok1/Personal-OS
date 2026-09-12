import {
  healthSyncRuns,
  mailDigests,
  mailMessages,
  mailSyncRuns,
  monitorChecks,
  type Db,
} from "@personal-os/db";
import { and, isNotNull, lt } from "drizzle-orm";
import { errorToken, log } from "../logger.js";

// Checkpoint 8.6C: bounded, irreversible retention cleanup (ADR-024 means
// there is no backup to recover a mistake from, so every predicate here is
// explicit and every window is the owner-approved number, never invented).
//
// ===========================================================================
// ONE CENTRAL EXECUTION PATH, FIVE INDEPENDENT TABLES.
// ===========================================================================
//
// Each table gets its own single bounded DELETE, tried independently of the
// others: one table's failure must not stop the rest (a Postgres error on
// mail_sync_runs must not leave monitor_checks unpruned), and it must not be
// silently swallowed either -- the job reports per-table success/failure and
// throws at the end if anything failed, so pg-boss's own job-history table
// is the record of "did this actually finish clean", never a log line alone.
//
// Every DELETE is a single top-level statement -- Postgres commits it
// immediately, so a later table's failure never rolls back an earlier one's
// already-applied cleanup. That is what makes a partial run safe to simply
// rerun: yesterday's already-deleted rows are gone, today's newly-eligible
// rows get caught this time.
//
// ---------------------------------------------------------------------------
// WHY NO NEW INDEX AND NO BATCHING.
//
// Checkpoint 8.6C's own audit measured production volume before writing this
// file: monitor_checks accumulates on the order of 2,000-3,700 rows/day (5
// seeded targets, 60-300s intervals), so a 30-day window is roughly
// 60,000-110,000 rows -- a small table by Postgres standards. mail_messages
// (549-567 rows total as of the last recorded count), mail_sync_runs (~96
// rows/day on one connection) and health_sync_runs (dozens of rows/hour
// across ~20 streams) are smaller still. A single unbatched DELETE at this
// scale runs in single-digit milliseconds; introducing batching or a new
// index here would be unneeded infrastructure for volume that does not exist
// -- the user's own instruction is to use actual evidence, not add
// precautionary machinery. If this table ever grows enough that a full scan
// is measurably slow, that is a new, separately-justified change.
//
// ---------------------------------------------------------------------------
// WHY finished_at IS NOT NULL GUARDS BOTH SYNC-RUN TABLES.
//
// Neither mail_sync_runs nor health_sync_runs has a "running"/"in-progress"
// status value -- both `openMailSyncRun`/`openSyncRun` insert a placeholder
// row with a terminal-looking status and finished_at left NULL, then
// finalize it at the end of the pass. A row that is still NULL is either
// genuinely in-flight (seconds old) or a crashed/abandoned attempt (the
// application's own health-dashboard read-model already treats a NULL
// finished_at older than ~15 minutes as "not actually running" for its
// in-flight-sync indicator). Excluding NULL rows from the age cutoff
// entirely -- rather than trusting `started_at` age alone to prove
// abandonment -- means a retention pass can never race a run that is still
// writing to its own row.

const DAY_MS = 24 * 60 * 60 * 1000;

/** Checkpoint 8.6C, D3: service-monitoring probe history. */
const MONITOR_CHECKS_RETENTION_DAYS = 30;
/** Checkpoint 8.6C, D4: Gmail message metadata cache, keyed on Gmail's OWN timestamp. */
const MAIL_MESSAGES_RETENTION_DAYS = 45;
/**
 * Checkpoint 8.6C, D5. `mail_digests` has exactly one read path in this
 * codebase -- `GET /mail-digests/current`, which reads only the single
 * newest row (apps/api/src/routes/mail-digests.ts) -- so nothing in the
 * product ever needs a digest older than a few days. There is no history
 * browser to preserve a longer window for. Aligned to the SAME window as its
 * source data (mail_messages) rather than inventing a separate, shorter
 * number with no product requirement behind it: a digest describing mail
 * older than the mail retention window itself has already outlived the data
 * it summarized.
 */
const MAIL_DIGESTS_RETENTION_DAYS = MAIL_MESSAGES_RETENTION_DAYS;
/** Checkpoint 8.6C, D6: pure operational audit logs, cursors live elsewhere. */
const MAIL_SYNC_RUNS_RETENTION_DAYS = 30;
const HEALTH_SYNC_RUNS_RETENTION_DAYS = 30;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** UTC calendar date (YYYY-MM-DD) `days` before `now` -- for a `date` column. */
function utcDateDaysAgo(now: Date, days: number): string {
  const cutoff = daysAgo(now, days);
  return cutoff.toISOString().slice(0, 10);
}

/**
 * Wraps whatever a table's cleanup statement throws down to a queue name and
 * a SQLSTATE, never a message -- the same containment `MonitorJobError` and
 * `MailJobError` apply to their lanes, sized down to what this lane actually
 * needs. None of these five statements carry attacker-authored text (they are
 * plain timestamp comparisons), so the residual risk is lower than theirs,
 * but the shape is kept identical rather than trusting that a future Postgres
 * error can never carry a value worth not persisting into pgboss.job.output.
 */
export class RetentionCleanupError extends Error {
  readonly failedTables: readonly string[];

  constructor(failedTables: readonly string[]) {
    super(`retention.cleanup failed for: ${failedTables.join(", ")}`);
    this.name = "RetentionCleanupError";
    this.failedTables = failedTables;
  }
}

export interface RetentionTableResult {
  table: string;
  cutoff: string;
  deleted: number;
  durationMs: number;
  ok: boolean;
}

async function deleteMonitorChecks(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoff = daysAgo(now, MONITOR_CHECKS_RETENTION_DAYS);
  const start = Date.now();
  const result = await db.delete(monitorChecks).where(lt(monitorChecks.checkedAt, cutoff));
  return {
    table: "monitor_checks",
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

async function deleteMailMessages(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoff = daysAgo(now, MAIL_MESSAGES_RETENTION_DAYS);
  const start = Date.now();
  // Applies regardless of `deleted_at` (the separate, reversible ADR-047a
  // provider-tombstone axis): a message is eligible purely by age of its own
  // authoritative `internal_date`, tombstoned or not. Keeping a single
  // predicate is the simplest defensible rule and avoids two retention
  // policies for what is, from this axis, one property (how old the mail is).
  const result = await db.delete(mailMessages).where(lt(mailMessages.internalDate, cutoff));
  return {
    table: "mail_messages",
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

async function deleteMailDigests(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoffDate = utcDateDaysAgo(now, MAIL_DIGESTS_RETENTION_DAYS);
  const start = Date.now();
  const result = await db.delete(mailDigests).where(lt(mailDigests.digestDate, cutoffDate));
  return {
    table: "mail_digests",
    cutoff: cutoffDate,
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

async function deleteMailSyncRuns(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoff = daysAgo(now, MAIL_SYNC_RUNS_RETENTION_DAYS);
  const start = Date.now();
  const result = await db
    .delete(mailSyncRuns)
    .where(and(isNotNull(mailSyncRuns.finishedAt), lt(mailSyncRuns.finishedAt, cutoff)));
  return {
    table: "mail_sync_runs",
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

async function deleteHealthSyncRuns(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoff = daysAgo(now, HEALTH_SYNC_RUNS_RETENTION_DAYS);
  const start = Date.now();
  const result = await db
    .delete(healthSyncRuns)
    .where(and(isNotNull(healthSyncRuns.finishedAt), lt(healthSyncRuns.finishedAt, cutoff)));
  return {
    table: "health_sync_runs",
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

export interface RetentionTableCleaner {
  table: string;
  clean: (db: Db, now: Date) => Promise<RetentionTableResult>;
}

/** Table name paired explicitly with its cleaner -- never derived from a function name. */
export const TABLE_CLEANERS: readonly RetentionTableCleaner[] = [
  { table: "monitor_checks", clean: deleteMonitorChecks },
  { table: "mail_messages", clean: deleteMailMessages },
  { table: "mail_digests", clean: deleteMailDigests },
  { table: "mail_sync_runs", clean: deleteMailSyncRuns },
  { table: "health_sync_runs", clean: deleteHealthSyncRuns },
];

/**
 * Runs every table's bounded cleanup independently, in a fixed order that
 * matches nothing (order has no correctness meaning here -- no table's
 * cleanup depends on another's). Idempotent and safe to rerun: a rerun
 * immediately after a clean pass finds nothing newly eligible and deletes 0
 * rows everywhere, since the cutoff is recomputed fresh from `now` each call.
 *
 * `cleaners` defaults to the real five-table list and exists as a seam for
 * the tests proving "one table's failure does not stop the others" -- the
 * alternative (revoking a real Postgres privilege mid-test) would need DDL
 * rights `posops_app` deliberately does not have, per the same least-
 * privilege model `packages/db/test/monitor-constraints.test.ts` proves the
 * runtime role is denied.
 */
export async function retentionCleanupJob(
  db: Db,
  now: Date = new Date(),
  cleaners: readonly RetentionTableCleaner[] = TABLE_CLEANERS,
): Promise<RetentionTableResult[]> {
  const results: RetentionTableResult[] = [];
  const failed: string[] = [];

  for (const { table, clean } of cleaners) {
    try {
      const result = await clean(db, now);
      results.push(result);
      log.info("retention.cleanup.table_completed", {
        table: result.table,
        cutoff: result.cutoff,
        deleted: result.deleted,
        durationMs: result.durationMs,
      });
    } catch (err) {
      results.push({ table, cutoff: "", deleted: 0, durationMs: 0, ok: false });
      failed.push(table);
      log.error("retention.cleanup.table_failed", { table, error: errorToken(err) });
    }
  }

  log.info("retention.cleanup.completed", {
    tablesOk: results.filter((r) => r.ok).length,
    tablesFailed: failed.length,
    totalDeleted: results.reduce((sum, r) => sum + r.deleted, 0),
  });

  if (failed.length > 0) {
    throw new RetentionCleanupError(failed);
  }
  return results;
}
