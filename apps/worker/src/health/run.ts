import { healthSyncRuns, type Db } from "@personal-os/db";
import type { ProviderFault } from "@personal-os/health-providers";
import { eq } from "drizzle-orm";

// health_sync_runs bookkeeping.
//
// A run row is written for EVERY attempt, including a no-op and including a
// failure. That is deliberate and is the counterpart to a design choice made in
// migration 0013: there is no per-row "we checked this" timestamp on
// health_daily_metrics or health_sessions, precisely so that two identical
// consecutive syncs write ZERO health-data rows. "We checked" has to be
// recorded somewhere, and this table plus
// health_metric_streams.last_successful_sync_at is where.
//
// ============================================================================
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
//   error_message MAY ONLY EVER RECEIVE THE SAME SANITIZED TOKEN SET AS
//   failure_class. NEVER err.message.
// ============================================================================
//
// Google's INVALID_ARGUMENT prose echoes the offending request back verbatim --
// 6.2P saw `Unknown name "startTime" at 'range': Cannot find field` returned as
// the message -- so the message is a caller-controlled channel out of the
// request body. Our request bodies carry filter expressions containing civil
// timestamps today and could carry values tomorrow. This column is durable and
// is rendered in the 6.4 dashboard, so a message written here is a health fact
// leaked into an operational table forever.
//
// google-health-client.ts already refuses to retain Google's message on the
// error object at all, and sanitizeApiError only ever emits SCREAMING_SNAKE
// tokens. This module re-validates anyway: defence in depth costs one regex,
// and the alternative is trusting that no future caller ever passes a string
// from somewhere else.

/** Enumerable-token shape, matching sanitizeApiError's own filter. */
const TOKEN = /^[A-Z][A-Z0-9_]*$/;
/**
 * A failure class: lowercase snake, optionally `prefix:TOKEN`
 * (`client_request_defect:ACCESS_TOKEN_SCOPE_INSUFFICIENT`) or `prefix:123`
 * (`provider_error:404`). Both halves are already token-validated upstream.
 */
const FAILURE_CLASS = /^[a-z][a-z0-9_]*(?::[A-Za-z0-9_]+)?$/;

export type HealthSyncRunKind = "hot" | "warm" | "backfill" | "manual";
export type HealthSyncRunStatus = "succeeded" | "failed" | "skipped" | "cancelled";

export interface OpenSyncRunParams {
  connectionId: string;
  streamId: string | null;
  metric: string;
  kind: HealthSyncRunKind;
  rangeStartDate: string;
  rangeEndDate: string;
  sourceFamily?: string | null;
  startedAt?: Date;
}

/**
 * Opens a run row before the first request goes out.
 *
 * Opened first rather than written at the end so that a pass killed mid-flight
 * -- OOM, SIGKILL, a pod eviction -- still leaves evidence that an attempt was
 * made, as a row with a null finished_at. A run table that only records
 * completed runs cannot distinguish "never attempted" from "died trying",
 * which is exactly the distinction you need at 3am.
 */
export async function openSyncRun(db: Db, params: OpenSyncRunParams): Promise<string> {
  const [row] = await db
    .insert(healthSyncRuns)
    .values({
      connectionId: params.connectionId,
      streamId: params.streamId,
      metric: params.metric,
      kind: params.kind,
      rangeStartDate: params.rangeStartDate,
      rangeEndDate: params.rangeEndDate,
      // A run is `failed` until it proves otherwise. If the process dies before
      // closeSyncRun, the row that survives says "failed", not "succeeded".
      status: "failed",
      sourceFamily: params.sourceFamily ?? null,
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
    })
    .returning({ id: healthSyncRuns.id });
  return row!.id;
}

export interface CloseSyncRunParams {
  status: HealthSyncRunStatus;
  failureClass?: string | null;
  /** ProviderFault.httpStatus, or null when no HTTP response was involved. */
  httpStatus?: number | null;
  requestCount?: number;
  pageCount?: number;
  rowsInserted?: number;
  rowsUpdated?: number;
  rowsUnchanged?: number;
  rowsTombstoned?: number;
  rowsRejected?: number;
  rowsCollapsed?: number;
  expectedBucketCount?: number | null;
  receivedBucketCount?: number | null;
  /**
   * Already-sanitized tokens ONLY -- typically `[fault.googleStatus,
   * ...fault.reasons]`. Anything failing the TOKEN test is dropped, not
   * truncated or escaped, because a string that is not a token is prose.
   */
  errorTokens?: readonly string[];
  finishedAt?: Date;
}

/** Reduces a ProviderFault to the token list `closeSyncRun` accepts. */
export function faultTokens(fault: ProviderFault | null): string[] {
  if (!fault) return [];
  const tokens = fault.googleStatus === null ? [] : [fault.googleStatus];
  return [...tokens, ...fault.reasons];
}

function buildErrorMessage(
  failureClass: string | null | undefined,
  tokens: readonly string[] | undefined,
): string | null {
  const parts: string[] = [];
  if (typeof failureClass === "string" && FAILURE_CLASS.test(failureClass))
    parts.push(failureClass);
  for (const token of tokens ?? []) {
    if (TOKEN.test(token) && !parts.includes(token)) parts.push(token);
  }
  if (parts.length === 0) return null;
  return parts.join(" ");
}

export async function closeSyncRun(
  db: Db,
  runId: string,
  params: CloseSyncRunParams,
): Promise<void> {
  await db
    .update(healthSyncRuns)
    .set({
      status: params.status,
      failureClass: params.failureClass ?? null,
      httpStatus: params.httpStatus ?? null,
      requestCount: params.requestCount ?? 0,
      pageCount: params.pageCount ?? 0,
      rowsInserted: params.rowsInserted ?? 0,
      rowsUpdated: params.rowsUpdated ?? 0,
      rowsUnchanged: params.rowsUnchanged ?? 0,
      rowsTombstoned: params.rowsTombstoned ?? 0,
      rowsRejected: params.rowsRejected ?? 0,
      rowsCollapsed: params.rowsCollapsed ?? 0,
      expectedBucketCount: params.expectedBucketCount ?? null,
      receivedBucketCount: params.receivedBucketCount ?? null,
      errorMessage: buildErrorMessage(params.failureClass, params.errorTokens),
      finishedAt: params.finishedAt ?? new Date(),
    })
    .where(eq(healthSyncRuns.id, runId));
}
