import { canvasSyncRuns, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";

// canvas_sync_runs bookkeeping (ADR-068 §5).
//
// A run row is written for EVERY attempt, including a no-op and including a
// failure -- the mail_sync_runs pattern, copied verbatim: there is no
// per-row "we checked this" timestamp on canvas_courses/canvas_assignments/
// canvas_announcements/canvas_events (their `updated_at` is gated by
// content-hash-equivalent `setWhere` comparison, see ../canvas/persist.ts),
// so "we checked" has to be recorded somewhere, and this table is where.
//
// ============================================================================
// THE ONE RULE THIS MODULE EXISTS TO ENFORCE:
//   failure_class AND error_message MAY ONLY EVER RECEIVE SANITIZED TOKENS.
//   NEVER err.message.
// ============================================================================
//
// This is apps/worker/src/mail/run.ts's rule, copied verbatim, and Canvas
// needs it for the identical reason: Canvas's error bodies can echo the
// offending request back, and pg-boss serializes a thrown error into
// `pgboss.job.output` -- a durable Postgres table -- by copying every own-
// enumerable property. `CanvasApiError` already destroys the provider's
// message at construction and `classifyCanvasFault` only ever emits members
// of the closed `CanvasFailureClass` vocabulary, but this module re-validates
// anyway: defence in depth costs one regex, and the alternative is trusting
// that no future caller ever passes a string from elsewhere.

/**
 * The token shape `canvas_sync_runs.failure_class`/`error_message` accepts.
 *
 * Copied VERBATIM from apps/worker/src/mail/run.ts's `FAILURE_CLASS` --
 * kept in step with `CanvasSyncTokenSchema` in packages/schema (the identical
 * pattern) by run.test.ts, which parses every value this module writes
 * through that schema, so the two cannot drift without a test failing.
 */
const FAILURE_CLASS = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;

export type CanvasSyncRunKind = "manual" | "cron";
export type CanvasSyncRunStatus = "succeeded" | "failed" | "skipped";

export interface OpenCanvasSyncRunParams {
  connectionId: string;
  kind: CanvasSyncRunKind;
  startedAt?: Date;
}

/**
 * Opens a run row before the first request goes out.
 *
 * Opened first rather than written at the end so that a pass killed
 * mid-flight still leaves evidence that an attempt was made, as a row with a
 * null `finished_at` and a `failed` status it has not yet earned. Mirrors
 * `openMailSyncRun`'s doc comment exactly -- see there for the full
 * "died trying" vs. "never attempted" reasoning.
 */
export async function openCanvasSyncRun(db: Db, params: OpenCanvasSyncRunParams): Promise<string> {
  const [row] = await db
    .insert(canvasSyncRuns)
    .values({
      connectionId: params.connectionId,
      kind: params.kind,
      // A run is `failed` until it proves otherwise. If the process dies
      // before closeCanvasSyncRun, the row that survives says "failed", not
      // "succeeded".
      status: "failed",
      ...(params.startedAt ? { startedAt: params.startedAt } : {}),
    })
    .returning({ id: canvasSyncRuns.id });
  return row!.id;
}

export interface CloseCanvasSyncRunParams {
  status: CanvasSyncRunStatus;
  coursesSynced?: number | null;
  assignmentsSynced?: number | null;
  announcementsSynced?: number | null;
  eventsSynced?: number | null;
  failureClass?: string | null;
  errorMessage?: string | null;
  finishedAt?: Date;
}

/**
 * Validates a token on the way in.
 *
 * A value that is not token-shaped is PROSE, and prose here means someone
 * reached for `err.message` (or a provider's own error body) instead of a
 * classification. It is coerced to the generic `provider_error` token rather
 * than truncated or escaped: truncating prose leaves a shorter piece of
 * prose, and the point is that no amount of it is acceptable.
 */
function safeToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return FAILURE_CLASS.test(raw) ? raw : "provider_error";
}

export async function closeCanvasSyncRun(
  db: Db,
  runId: string,
  params: CloseCanvasSyncRunParams,
): Promise<void> {
  await db
    .update(canvasSyncRuns)
    .set({
      status: params.status,
      coursesSynced: params.coursesSynced ?? null,
      assignmentsSynced: params.assignmentsSynced ?? null,
      announcementsSynced: params.announcementsSynced ?? null,
      eventsSynced: params.eventsSynced ?? null,
      failureClass: safeToken(params.failureClass),
      errorMessage: safeToken(params.errorMessage),
      finishedAt: params.finishedAt ?? new Date(),
    })
    .where(eq(canvasSyncRuns.id, runId));
}
