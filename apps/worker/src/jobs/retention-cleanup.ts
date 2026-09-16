import {
  canvasSyncRuns,
  healthOauthStates,
  healthSyncRuns,
  mailDigests,
  mailMessages,
  mailOauthStates,
  mailSyncRuns,
  monitorChecks,
  type Db,
} from "@personal-os/db";
import { localDayWindow } from "@personal-os/core";
import { and, isNotNull, lt } from "drizzle-orm";
import { errorToken, log } from "../logger.js";
import { resolveDigestTimezone } from "../mail/digest/run.js";

// Checkpoint 8.6C: bounded, irreversible retention cleanup (ADR-024 means
// there is no backup to recover a mistake from, so every predicate here is
// explicit and every window is the owner-approved number, never invented).
//
// ===========================================================================
// ONE CENTRAL EXECUTION PATH, EIGHT INDEPENDENT TABLES.
// ===========================================================================
//
// Five age-windowed tables from Checkpoint 8.6C (D3-D6), the two OAuth
// state tables added by Checkpoint 9.0 Part D (see the section below), and
// `canvas_sync_runs` added by Checkpoint 10.1 (ADR-068 §5) on the same
// 30-day `finished_at` window as `mail_sync_runs`/`health_sync_runs`.
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
// WHY finished_at IS NOT NULL GUARDS ALL THREE SYNC-RUN TABLES.
//
// None of mail_sync_runs, health_sync_runs or canvas_sync_runs has a
// "running"/"in-progress" status value -- `openMailSyncRun`/`openSyncRun`/
// `openCanvasSyncRun` all insert a placeholder
// row with a terminal-looking status and finished_at left NULL, then
// finalize it at the end of the pass. A row that is still NULL is either
// genuinely in-flight (seconds old) or a crashed/abandoned attempt (the
// application's own health-dashboard read-model already treats a NULL
// finished_at older than ~15 minutes as "not actually running" for its
// in-flight-sync indicator). Excluding NULL rows from the age cutoff
// entirely -- rather than trusting `started_at` age alone to prove
// abandonment -- means a retention pass can never race a run that is still
// writing to its own row.
//
// ---------------------------------------------------------------------------
// WHY EXPIRED OAUTH STATES ARE SWEPT HERE, AND WHY THEY HAVE NO WINDOW.
//
// `health_oauth_states` and `mail_oauth_states` hold the single-use CSRF
// state for a consent flow: a sha256 of the state (never the raw value), the
// redirect it was bound to, and an `expires_at` stamped at mint from the
// API's own 10-minute TTL (`STATE_TTL_MS` in apps/api/src/services/
// health-connection.ts and mail-connection.ts). Consumption is an UPDATE
// that sets `consumed_at`; nothing ever deleted a row, so both tables grew
// monotonically. ADR-047 recorded the INTENT that "expired OAuth states" are
// swept as operational metadata; ADR-057 #1 recorded that the two sweep
// functions written for it in apps/api had zero production callers; ADR-061
// carried "the OAuth-state half remains open" into Phase 9. This is the
// closure. The apps/api functions are deleted rather than called, because
// apps/worker may never import from apps/api and two implementations of one
// DELETE is how one of them rots.
//
// There is NO retention window constant for these two tables, and that is
// not an omission. Every other table here is pruned by an owner-chosen age
// (D3-D6). An OAuth state carries its own eligibility in the row: past
// `expires_at` it is unusable by construction -- `consumeOAuthState` rejects
// it with "has expired" even when it is unconsumed -- so "older than N days"
// would be a second, invented number laid over a row that already says when
// it stopped mattering. The predicate is exactly the one the deleted API
// functions used, `expires_at < now`, read from the stored column; a future
// TTL change in the API flows through without touching this file.
//
// `consumed_at` is deliberately NOT a criterion. A consumed-but-unexpired row
// is already dead to the consent flow (the UPDATE ... WHERE consumed_at IS
// NULL cannot match it again), but it ages out within the same 10 minutes on
// `expires_at` alone, and one predicate that mirrors the consumer's own
// expiry rule is simpler to reason about than two. What matters for safety
// is the converse: a LIVE in-flight state -- unconsumed, minted less than 10
// minutes ago -- has `expires_at` strictly in the future relative to any
// `now` this job captures, so it cannot match. Deleting a row this job is
// allowed to delete changes only WHICH message branch a later consume of it
// throws ("is unknown, already used, or expired" instead of "has expired");
// both are the same error class, both routes map it to `400 invalid_state`,
// and nothing distinguishes the two strings.

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
/**
 * Checkpoint 10.1 (Canvas LMS integration, ADR-068 §5): `canvas_sync_runs` is
 * operational metadata, not Canvas content, exactly like `mail_sync_runs`/
 * `health_sync_runs` above -- it joins their existing 30-day `finished_at`
 * window rather than inventing a new one, per ADR-068's own instruction that
 * this table "joins the existing daily retention.cleanup job on the SAME
 * 30-day finished_at window ... no new cron, no new schedule."
 */
const CANVAS_SYNC_RUNS_RETENTION_DAYS = 30;

function daysAgo(now: Date, days: number): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/**
 * The calendar date `days` before `now`, IN THE DIGEST'S OWN TIMEZONE -- for
 * comparison against `mail_digests.digest_date`.
 *
 * `digest_date` is written as `localDayWindow(resolveDigestTimezone(), at)
 * .localDate` (apps/worker/src/mail/digest/run.ts), a civil date in whatever
 * zone MAIL_DIGEST_TIMEZONE names (defaulting to UTC only when unset). A
 * cutoff taken from `now`'s bare UTC date instead would compare two civil
 * dates anchored to different clocks -- in a zone behind UTC (e.g.
 * America/Chicago) that silently deletes a digest up to one zone-offset
 * before the policy's own 45-day boundary, found by this checkpoint's own
 * adversarial review. Deriving the cutoff the SAME way the row itself was
 * written is what keeps both sides of the comparison in one reference frame.
 */
function digestCutoffLocalDate(now: Date, days: number): string {
  return localDayWindow(resolveDigestTimezone(), daysAgo(now, days)).localDate;
}

/**
 * Wraps whatever a table's cleanup statement throws down to a queue name and
 * a SQLSTATE, never a message -- the same containment `MonitorJobError` and
 * `MailJobError` apply to their lanes, sized down to what this lane actually
 * needs. None of these seven statements carry attacker-authored text (they are
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
  const cutoffDate = digestCutoffLocalDate(now, MAIL_DIGESTS_RETENTION_DAYS);
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

/**
 * Checkpoint 10.1 (ADR-068 §5). Same `finished_at IS NOT NULL` guard as the
 * two sync-run tables above, for the identical reason: `openCanvasSyncRun`
 * inserts a placeholder row with a terminal-looking `failed` status and
 * `finished_at` left NULL, then finalizes it at the end of the pass -- a row
 * still NULL is either genuinely in-flight or a crashed/abandoned attempt,
 * and excluding it from the age cutoff entirely means this pass can never
 * race a run that is still writing to its own row.
 */
async function deleteCanvasSyncRuns(db: Db, now: Date): Promise<RetentionTableResult> {
  const cutoff = daysAgo(now, CANVAS_SYNC_RUNS_RETENTION_DAYS);
  const start = Date.now();
  const result = await db
    .delete(canvasSyncRuns)
    .where(and(isNotNull(canvasSyncRuns.finishedAt), lt(canvasSyncRuns.finishedAt, cutoff)));
  return {
    table: "canvas_sync_runs",
    cutoff: cutoff.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

/**
 * Checkpoint 9.0 Part D. The row's own `expires_at` is the whole predicate
 * -- see the module comment for why there is no window constant and why
 * `consumed_at` is not consulted. `cutoff` is reported as the pass's captured
 * `now` so the log line reads the same way as every other table's: "rows
 * whose axis column is strictly before this instant were deleted".
 */
async function deleteHealthOauthStates(db: Db, now: Date): Promise<RetentionTableResult> {
  const start = Date.now();
  const result = await db.delete(healthOauthStates).where(lt(healthOauthStates.expiresAt, now));
  return {
    table: "health_oauth_states",
    cutoff: now.toISOString(),
    deleted: result.rowCount ?? 0,
    durationMs: Date.now() - start,
    ok: true,
  };
}

async function deleteMailOauthStates(db: Db, now: Date): Promise<RetentionTableResult> {
  const start = Date.now();
  const result = await db.delete(mailOauthStates).where(lt(mailOauthStates.expiresAt, now));
  return {
    table: "mail_oauth_states",
    cutoff: now.toISOString(),
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
  { table: "health_oauth_states", clean: deleteHealthOauthStates },
  { table: "mail_oauth_states", clean: deleteMailOauthStates },
  { table: "canvas_sync_runs", clean: deleteCanvasSyncRuns },
];

/**
 * Runs every table's bounded cleanup independently, in a fixed order that
 * matches nothing (order has no correctness meaning here -- no table's
 * cleanup depends on another's). Idempotent and safe to rerun: a rerun
 * immediately after a clean pass finds nothing newly eligible and deletes 0
 * rows everywhere, since the cutoff is recomputed fresh from `now` each call.
 *
 * `cleaners` defaults to the real seven-table list and exists as a seam for
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
