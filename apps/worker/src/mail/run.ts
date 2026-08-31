import { mailSyncRuns, type Db } from "@personal-os/db";
import { type MailFault } from "@personal-os/mail-providers";
import { eq } from "drizzle-orm";

// mail_sync_runs bookkeeping.
//
// A run row is written for EVERY attempt, including a no-op and including a
// failure. That is the counterpart to a design choice made in migration 0014:
// there is no per-row "we checked this" timestamp on mail_messages, precisely
// so that two identical consecutive syncs write ZERO mail rows. "We checked"
// has to be recorded somewhere, and this table plus
// mail_sync_cursors.last_successful_sync_at is where.
//
// ============================================================================
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
//   failure_class AND error_message MAY ONLY EVER RECEIVE SANITIZED TOKENS.
//   NEVER err.message.
// ============================================================================
//
// This is health/run.ts's rule, and mail needs it MORE, not less. Gmail's
// INVALID_ARGUMENT prose echoes the offending request back -- a bad
// `startHistoryId` returns with the value in it, a header filter returns with
// the header names -- and our requests carry message ids and label ids. Worse,
// this column is operational metadata that ADR-054 permits pruning but never
// promises to prune promptly, and a message written here is durable.
//
// GmailApiError already destroys the provider's message at construction and
// `classifyMailFault` only ever emits enum members and lowercase tokens. This
// module re-validates anyway: defence in depth costs one regex, and the
// alternative is trusting that no future caller passes a string from elsewhere.

/**
 * The token shape `mail_sync_runs.failure_class` accepts.
 *
 * Kept in step with `MailSyncFailureClassSchema` in packages/schema by
 * `run.test.ts`, which parses every value this module writes through that
 * schema -- so the two cannot drift without a test failing.
 */
const FAILURE_CLASS = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;

export type MailSyncRunKind = "incremental" | "full" | "backfill" | "manual";
export type MailSyncRunStatus = "succeeded" | "failed" | "skipped" | "cancelled";

export interface OpenMailSyncRunParams {
  connectionId: string;
  cursorId: string | null;
  scopeKey: string;
  kind: MailSyncRunKind;
  /** Both bounds are optional: an incremental pass has a cursor, not a range. */
  rangeStartAt?: Date | null;
  rangeEndAt?: Date | null;
  startedAt?: Date;
}

/**
 * Opens a run row before the first request goes out.
 *
 * Opened first rather than written at the end so that a pass killed mid-flight
 * -- OOM, SIGKILL, a container eviction -- still leaves evidence that an attempt
 * was made, as a row with a null finished_at. A run table that only records
 * completed runs cannot distinguish "never attempted" from "died trying", which
 * is exactly the distinction you need at 3am. It is also what makes the
 * breaker's window meaningful: a pass that dies repeatedly leaves five failed
 * rows rather than none.
 */
export async function openMailSyncRun(db: Db, params: OpenMailSyncRunParams): Promise<string> {
  const [row] = await db
    .insert(mailSyncRuns)
    .values({
      connectionId: params.connectionId,
      cursorId: params.cursorId,
      scopeKey: params.scopeKey,
      kind: params.kind,
      rangeStartAt: params.rangeStartAt ?? null,
      rangeEndAt: params.rangeEndAt ?? null,
      // A run is `failed` until it proves otherwise. If the process dies before
      // closeMailSyncRun, the row that survives says "failed", not "succeeded".
      status: "failed",
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
    })
    .returning({ id: mailSyncRuns.id });
  return row!.id;
}

export interface CloseMailSyncRunParams {
  status: MailSyncRunStatus;
  failureClass?: string | null;
  httpStatus?: number | null;
  requestCount?: number;
  pageCount?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  rowsUnchanged?: number;
  rowsTombstoned?: number;
  rowsRejected?: number;
  /**
   * Records that this run hit the documented `history.list` 404 and escalated
   * to a bounded full resync.
   *
   * A dedicated column rather than an inference from `failure_class`, because
   * ADR-053 makes cursor expiry a FIRST-CLASS state transition and an audit
   * trail you have to pattern-match strings against is not one.
   */
  cursorExpired?: boolean;
  finishedAt?: Date;
}

/** Reduces a classified fault to what a run row may store. */
export function faultRunFields(fault: MailFault): {
  failureClass: string;
  httpStatus: number | null;
  cursorExpired: boolean;
} {
  return {
    failureClass: fault.failureClass,
    httpStatus: fault.httpStatus,
    cursorExpired: fault.cursorExpired,
  };
}

/**
 * Validates a failure class on the way in.
 *
 * A value that is not token-shaped is PROSE, and prose here means someone
 * reached for `err.message`. It is dropped rather than truncated or escaped:
 * truncating prose leaves a shorter piece of prose, and the point is that no
 * amount of it is acceptable.
 */
function safeFailureClass(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return FAILURE_CLASS.test(raw) ? raw : "provider_error";
}

export async function closeMailSyncRun(
  db: Db,
  runId: string,
  params: CloseMailSyncRunParams,
): Promise<void> {
  const failureClass = safeFailureClass(params.failureClass);
  await db
    .update(mailSyncRuns)
    .set({
      status: params.status,
      failureClass,
      httpStatus: params.httpStatus ?? null,
      requestCount: params.requestCount ?? 0,
      pageCount: params.pageCount ?? 0,
      rowsInserted: params.rowsInserted ?? 0,
      rowsUpdated: params.rowsUpdated ?? 0,
      rowsUnchanged: params.rowsUnchanged ?? 0,
      rowsTombstoned: params.rowsTombstoned ?? 0,
      rowsRejected: params.rowsRejected ?? 0,
      cursorExpired: params.cursorExpired ?? false,
      // error_message deliberately carries the SAME sanitized token as
      // failure_class and nothing more. The column exists because
      // health_sync_runs has one and the shapes are kept parallel; it is not a
      // second, laxer channel. If a future need wants richer diagnostics they
      // must arrive as more tokens, not as a message.
      errorMessage: failureClass,
      finishedAt: params.finishedAt ?? new Date(),
    })
    .where(eq(mailSyncRuns.id, runId));
}
