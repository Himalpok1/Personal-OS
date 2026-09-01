import { mailSyncRuns, type Db } from "@personal-os/db";
import { and, desc, eq, gt, inArray } from "drizzle-orm";

// The per-(connection, scope) circuit breaker.
//
// WHY THIS EXISTS -- the failure it is here to make impossible:
//
// The failure taxonomy deliberately does NOT throw for most faults. A
// non-retryable provider error records a failed run and returns, because
// throwing out of the handler would dead-letter a connection over one bad
// request. The cron tick is the retry.
//
// That is right, and it has one bad consequence: a PERMANENT defect becomes
// completely silent. If the grant quietly loses `gmail.metadata`, or a request
// shape is wrong, then every fifteen minutes, forever, we spend a token
// refresh, a `history.list` and a failed run, and tell nobody. The cost is real
// quota and real wall clock, and the only signal is rows in a table nobody
// reads.
//
// DERIVED FROM mail_sync_runs, WITH NO NEW COLUMN. This is health/breaker.ts's
// argument applied verbatim, and ADR-055 restates it as the rule for Phase 7:
// a `consecutive_failures` counter is a second source of truth that must be
// reset correctly on every success path -- one missed reset and a scope trips
// on five failures spread across a month. Reading the last N rows cannot drift,
// because there is nothing to keep in step.
//
// ===========================================================================
// WHERE THIS DIVERGES FROM THE HEALTH BREAKER, AND WHY IT HAD TO
// ===========================================================================
//
// The health breaker DISABLES the offending stream: it sets
// `health_metric_streams.sync_enabled = false`, and the stream is simply not
// selected next pass. Mail has no equivalent flag. `mail_sync_cursors` carries
// no `sync_enabled` column, and adding one means migration 0015 -- which
// belongs to Checkpoint 7.5, not here.
//
// So the breaker is OPEN/CLOSED STATE DERIVED ON READ rather than a durable
// disable, and it recovers by itself:
//
//   * OPEN when the last N runs that actually ran all failed with the same
//     non-retryable class. The pass then skips before spending a single
//     request.
//   * RE-PROBES once per cooldown, so a fault that fixes itself (a re-granted
//     scope, a provider-side fix) closes the breaker without anyone
//     intervening. Without this the connection would be dead until a human
//     noticed, which for a self-hosted single-user system means never.
//
// `skipped` AND `cancelled` RUNS ARE EXCLUDED FROM THE WINDOW. That exclusion
// is load-bearing rather than tidy: the skip an open breaker performs writes a
// run row, so a window that counted skips would see [skipped x N] on the next
// evaluation, find them not-failed, and CLOSE the breaker it just opened --
// flapping open/closed forever and re-probing every tick. Health's breaker
// takes the last five rows regardless of status and would have exactly this
// bug if it ever wrote a skipped row mid-episode; it does not, so it does not.

export const MAIL_BREAKER_THRESHOLD = 5;

/**
 * The failure class an open breaker's own skipped run row carries.
 *
 * Named here rather than inlined at the orchestrator because this module reads
 * it back: those rows are how "we have already announced this episode" is
 * derived. The two uses must agree, so they share one constant.
 */
export const BREAKER_SKIP_CLASS = "breaker_open";

/**
 * How long an open breaker waits before letting one probe through.
 *
 * Six hours is chosen against the cron cadence rather than picked: at a
 * 15-minute tick this turns ~96 futile passes a day into 4. Long enough that a
 * genuinely dead grant is not being hammered, short enough that a fault fixed
 * in the morning is syncing again by lunch.
 */
export const MAIL_BREAKER_COOLDOWN_MS = 6 * 60 * 60 * 1000;

/**
 * Failure classes retrying genuinely can fix, which must therefore never trip
 * the breaker.
 *
 * These come straight from `classifyMailFault`'s retryable branch, plus two
 * that are not "retryable" in the limiter's sense but are still wrong to trip
 * on:
 *
 *   `auth_rejected` -- a 401 that survived this pass's single refresh is a
 *   grant/propagation problem for the CONNECTION to resolve, and it already
 *   marks the connection `needs_reauth`, which stops the pass by a different
 *   and better route.
 *
 *   `pass_budget_exhausted` -- ours, not the provider's. Tripping a breaker
 *   because we ran out of wall clock would be absurd.
 */
const RETRYABLE_FAILURE_CLASSES: ReadonlySet<string> = new Set([
  "rate_limited",
  "rate_limited:429",
  "rate_limited:403",
  "transport",
  "transport:timeout",
  "oauth_transient",
  "auth_rejected",
  "pass_budget_exhausted",
]);

/** A `provider_unavailable:503`-style class is retryable whatever the suffix. */
function isRetryableClass(failureClass: string): boolean {
  if (RETRYABLE_FAILURE_CLASSES.has(failureClass)) return true;
  return failureClass.startsWith("provider_unavailable");
}

export interface MailBreakerInput {
  connectionId: string;
  scopeKey: string;
}

export interface MailBreakerState {
  /** True when the pass must skip without spending a request. */
  open: boolean;
  /** The repeated class, when open. */
  failureClass: string | null;
  /**
   * True on the single evaluation where the streak was just completed.
   *
   * Edge-triggered on purpose. A level-triggered signal would fire again on
   * every re-probe failure -- four times a day, forever -- which is exactly the
   * alert fatigue that makes people mute a channel.
   */
  justOpened: boolean;
  /** True when the cooldown has elapsed and this pass is the probe. */
  probing: boolean;
}

const CLOSED: MailBreakerState = {
  open: false,
  failureClass: null,
  justOpened: false,
  probing: false,
};

/**
 * Evaluates the breaker for one (connection, scope) from run history alone.
 *
 * Reads N+1 rows rather than N: the extra one is what distinguishes "this run
 * completed the streak" (alert) from "the streak was already complete before
 * it" (stay quiet). Nothing is written -- the caller decides what to do with
 * the state, and the ONLY durable consequence is the skipped run row it writes,
 * which this function then excludes from its own window.
 */
export async function evaluateMailBreaker(
  db: Db,
  input: MailBreakerInput,
  now: Date = new Date(),
): Promise<MailBreakerState> {
  const recent = await db
    .select({
      status: mailSyncRuns.status,
      failureClass: mailSyncRuns.failureClass,
      finishedAt: mailSyncRuns.finishedAt,
      startedAt: mailSyncRuns.startedAt,
    })
    .from(mailSyncRuns)
    .where(
      and(
        eq(mailSyncRuns.connectionId, input.connectionId),
        eq(mailSyncRuns.scopeKey, input.scopeKey),
        // See the module comment: counting the breaker's own skips would close
        // the breaker it just opened.
        inArray(mailSyncRuns.status, ["succeeded", "failed"]),
      ),
    )
    .orderBy(desc(mailSyncRuns.startedAt), desc(mailSyncRuns.id))
    .limit(MAIL_BREAKER_THRESHOLD + 1);

  if (recent.length < MAIL_BREAKER_THRESHOLD) return { ...CLOSED };

  const newest = recent[0]!;
  const failureClass = newest.failureClass;
  if (newest.status !== "failed" || failureClass === null) return { ...CLOSED };
  if (isRetryableClass(failureClass)) return { ...CLOSED };

  // IDENTICAL, not merely "all failed". A scope alternating between two
  // different faults is flapping, which is a different problem with a different
  // answer; only a stable, reproducible, non-retryable fault is evidence that
  // the request itself -- or the grant behind it -- is wrong.
  const window = recent.slice(0, MAIL_BREAKER_THRESHOLD);
  const allIdentical = window.every(
    (row) => row.status === "failed" && row.failureClass === failureClass,
  );
  if (!allIdentical) return { ...CLOSED };

  const older = recent[MAIL_BREAKER_THRESHOLD];
  const streakIsLonger =
    older !== undefined && older.status === "failed" && older.failureClass === failureClass;

  const lastAt = newest.finishedAt ?? newest.startedAt;

  // HAVE WE ALREADY ANNOUNCED THIS EPISODE?
  //
  // `streakIsLonger` alone is not enough, and its insufficiency is a real
  // defect the tests caught rather than a subtlety. Consider a connection whose
  // FIRST five passes all fail identically: there is no sixth row, so
  // `streakIsLonger` is false -- and it stays false forever, because an open
  // breaker skips instead of writing another failed run, freezing the window at
  // exactly five. `justOpened` would then be true on every single evaluation,
  // which is precisely the alert fatigue the edge trigger exists to prevent.
  //
  // The skip rows ARE the record of having announced: opening writes one, so
  // their presence after the newest failure means a previous evaluation already
  // reached the same conclusion. Derived, like everything else here -- no
  // column, nothing to keep in step.
  const [announced] = await db
    .select({ id: mailSyncRuns.id })
    .from(mailSyncRuns)
    .where(
      and(
        eq(mailSyncRuns.connectionId, input.connectionId),
        eq(mailSyncRuns.scopeKey, input.scopeKey),
        eq(mailSyncRuns.status, "skipped"),
        eq(mailSyncRuns.failureClass, BREAKER_SKIP_CLASS),
        gt(mailSyncRuns.startedAt, newest.startedAt),
      ),
    )
    .limit(1);

  const wasAlreadyOpen = streakIsLonger || announced !== undefined;
  const probing = now.getTime() - lastAt.getTime() >= MAIL_BREAKER_COOLDOWN_MS;

  return {
    // `probing` closes the gate for exactly one pass. The breaker is still
    // conceptually open -- if the probe fails, the window still holds N
    // identical failures and the next pass is refused again.
    open: !probing,
    failureClass,
    justOpened: !wasAlreadyOpen,
    probing,
  };
}
