import { GMAIL_QUOTA_UNITS, GMAIL_QUOTA_UNITS_PER_MINUTE_PER_USER } from "./gmail-catalog.js";
import { GmailApiError } from "./gmail-client.js";

// The shared mail rate limiter.
//
// Copied in SHAPE from packages/health-providers/src/sync/limiter.ts -- one
// serialized choke point giving a global QPS ceiling, a global cooldown and a
// global wall-clock pass budget -- and deliberately DIFFERENT in the one place
// that matters.
//
// ===========================================================================
// IT HONOURS `Retry-After`. HEALTH'S DOES NOT, AND ITS REASONING DOES NOT
// TRANSFER.
// ===========================================================================
//
// The health limiter uses BLIND full-jitter backoff, and says why: "Google's
// Health API documents no `Retry-After` header and no `X-RateLimit-*` headers
// ... so there is no server hint to honour."
//
// Gmail is not that API. It sends `Retry-After`, and so does Microsoft Graph.
// Carrying the blind-jitter reasoning across would mean ignoring a hint the
// provider is actively giving us -- slower to recover and ruder to the quota.
// ADR-053 therefore requires honouring it, and requires proving that
// DETERMINISTICALLY (injected `now`/`sleep`/`random`, exact millisecond
// assertions) rather than by provoking a real 429, because provoking one means
// deliberately abusing the quota.
//
// Full jitter remains the FALLBACK, for the case Gmail sends a 429 with no
// header at all. Both paths are exercised by tests.
//
// ---------------------------------------------------------------------------
// RETRY NESTING IS SINGLE-LAYER, for the reason health's limiter records
// verbatim: the mail sync queue is registered `retryLimit: 0`, because pg-boss
// can DROP a retry insert under `policy: "stately"` and dead-letter what was
// only a first transient failure (pg-boss/dist/manager.js:1293). So the
// `maxAttempts` here are the ONLY in-job retries, and the cron tick is the
// outer re-attempt. Nothing above this layer may reintroduce one.

/** Everything non-deterministic the limiter touches, injected. */
export interface MailLimiterDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Must return a value in [0, 1), matching `Math.random`. */
  random(): number;
}

export interface MailLimiterOptions {
  /** Requests per second across the whole pass. minSpacingMs = 1000 / qps. */
  qps: number;
  /** Total in-job attempts per request, INCLUDING the first. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * Floor for a cooldown armed from OUR OWN JITTER -- never for one armed from
   * a provider hint.
   *
   * Blind jitter is drawn from [0, exponential), so an unlucky draw is near
   * zero, which is a fine wait before a retry and a useless one after being
   * told to stop. A `Retry-After` is not a draw: it is the provider's answer,
   * and flooring it would substitute our guess for it.
   */
  cooldownFloorMs: number;
  /**
   * Ceiling on an honoured `Retry-After`.
   *
   * A hint is a hint, not an instruction: a header of 86400 -- whether from a
   * misconfigured proxy, a fronting CDN or a hostile intermediary -- would
   * otherwise park a worker slot for a day. Clamping keeps the provider in
   * charge of pacing without letting it be in charge of our scheduling.
   */
  maxRetryAfterMs: number;
  requestTimeoutMs: number;
  /** Wall-clock ceiling for the whole pass, measured from limiter creation. */
  passBudgetMs: number;
}

export interface MailLimiterStats {
  /** Attempts actually handed to `fn`, so retries are counted individually. */
  requests: number;
  retries: number;
  /** 429/RESOURCE_EXHAUSTED responses observed, whether or not a retry followed. */
  rateLimitHits: number;
  /** Times a provider-supplied `Retry-After` was used instead of jitter. */
  retryAfterHonoured: number;
  timeouts: number;
  /** Absolute deadline; 0 when no cooldown has ever been armed. */
  cooldownUntil: number;
}

export interface MailLimiter {
  /** THE only path by which a mail provider request may be issued in a pass. */
  run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Remaining pass wall-clock budget in ms; 0 once exhausted. */
  budgetRemainingMs(): number;
  readonly stats: Readonly<MailLimiterStats>;
}

/**
 * The pass ran out of wall-clock budget.
 *
 * Distinct from any provider error on purpose: it is OUR scheduling decision,
 * not an upstream fault, and classifying it as one would misattribute it.
 */
export class MailPassBudgetExhaustedError extends Error {
  constructor(message = "mail sync pass budget exhausted") {
    super(message);
    this.name = "MailPassBudgetExhaustedError";
  }
}

/**
 * Default QPS, derived from Gmail's published quota rather than picked.
 *
 * The per-user ceiling is 6,000 quota units per MINUTE. A metadata
 * `messages.get` costs 20 units, which is the dominant call in any pass (the
 * N+1 shape 7.2P confirmed), so the arithmetic ceiling is 300 requests/minute =
 * 5/s. Running at 4 leaves a fifth of the budget for the cheap calls and for a
 * second client sharing the account.
 */
export const GMAIL_SAFE_QPS =
  Math.floor(GMAIL_QUOTA_UNITS_PER_MINUTE_PER_USER / GMAIL_QUOTA_UNITS.messagesGet / 60) - 1;

export const DEFAULT_MAIL_LIMITER_OPTIONS: MailLimiterOptions = {
  qps: GMAIL_SAFE_QPS,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  cooldownFloorMs: 30_000,
  maxRetryAfterMs: 120_000,
  requestTimeoutMs: 20_000,
  // Half the health pass budget: a mail pass is one connection's bounded
  // message set, not eighteen streams over a 35-day window. Must stay strictly
  // below the queue's expireInSeconds (900s) or pg-boss would un-`active` a job
  // whose handler still holds its advisory lock.
  passBudgetMs: 300_000,
};

/**
 * Full-jitter backoff: a uniform draw over [0, min(cap, base * 2^(attempt-1))).
 *
 * `attempt` is 1-BASED, so the first retry draws from [0, base). Exported
 * because it is the one piece of arithmetic worth asserting directly rather
 * than inferring from recorded sleeps, which would conflate it with the QPS
 * gate's own waits.
 */
export function fullJitterDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number,
): number {
  const exponential = baseMs * 2 ** (Math.max(1, attempt) - 1);
  const bound = Math.min(capMs, exponential);
  if (!(bound > 0)) return 0;
  const drawn = Math.floor(random() * bound);
  return Math.min(bound, Math.max(0, drawn));
}

type FailureKind = "fatal" | "timeout" | "retryable";

function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Whether the provider is telling us to slow down.
 *
 * 429 is the obvious case. A 403 carrying `RESOURCE_EXHAUSTED` is the same fact
 * wearing a different status -- Gmail overloads 403 for throttling -- and
 * treating it as a plain permission failure would mean hammering a throttled
 * account instead of backing off. The status token is available even though
 * `details` is empty (Checkpoint 7.2P).
 */
function isRateLimit(err: unknown): boolean {
  if (!(err instanceof GmailApiError)) return false;
  // Not a type predicate: `classify` calls it inside a branch where `err` is
  // already known to be a GmailApiError, and a predicate there would narrow the
  // negative branch to `never`.
  return (
    err.httpStatus === 429 || (err.httpStatus === 403 && err.gmailStatus === "RESOURCE_EXHAUSTED")
  );
}

function classify(err: unknown): FailureKind {
  if (err instanceof GmailApiError) {
    // Checked before the abort test: a GmailApiError is a real HTTP response,
    // so its status is authoritative.
    if (isRateLimit(err)) return "retryable";
    if (err.httpStatus >= 500) return "retryable";
    // Every other 4xx -- 400, 401, 403, 404 -- is a defect in the request or
    // the grant. Retrying cannot change the outcome and would burn pass budget
    // a recoverable request needs. A `history.list` 404 in particular must
    // reach the caller UNRETRIED so it can escalate to a full resync.
    return "fatal";
  }
  if (isAbortLike(err)) return "timeout";
  return "retryable";
}

export function createMailLimiter(
  deps: MailLimiterDeps,
  options?: Partial<MailLimiterOptions>,
): MailLimiter {
  // Field by field rather than by spread, so a caller passing an explicit
  // `undefined` gets the default instead of a hole under
  // `exactOptionalPropertyTypes`.
  const qps = options?.qps ?? DEFAULT_MAIL_LIMITER_OPTIONS.qps;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_MAIL_LIMITER_OPTIONS.maxAttempts;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.maxDelayMs;
  const cooldownFloorMs = options?.cooldownFloorMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.cooldownFloorMs;
  const maxRetryAfterMs = options?.maxRetryAfterMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.maxRetryAfterMs;
  const requestTimeoutMs =
    options?.requestTimeoutMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.requestTimeoutMs;
  const passBudgetMs = options?.passBudgetMs ?? DEFAULT_MAIL_LIMITER_OPTIONS.passBudgetMs;

  const minSpacingMs = qps > 0 ? 1000 / qps : 0;

  // The budget clock starts at construction, not at the first request: a pass
  // that spends two minutes resolving credentials has genuinely spent two
  // minutes of the worker slot it is holding.
  const createdAt = deps.now();

  const stats: MailLimiterStats = {
    requests: 0,
    retries: 0,
    rateLimitHits: 0,
    retryAfterHonoured: 0,
    timeouts: 0,
    cooldownUntil: 0,
  };

  // NEGATIVE_INFINITY so the first request never waits for a spacing interval
  // no prior request established.
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let cooldownUntil = 0;

  // The serialization chain. Every `run` -- including its retries and backoff
  // sleeps -- is appended here, so at most one request is ever in flight. This
  // is also what bounds the N+1 metadata fan-out to concurrency 1 without any
  // separate batching machinery.
  //
  // `.then(task, task)` rather than `.then(task)` because a rejected
  // predecessor must not poison every subsequent request: the chain is a queue,
  // not a dependency.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task, task);
    chain = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  function budgetRemainingMs(): number {
    return Math.max(0, passBudgetMs - (deps.now() - createdAt));
  }

  /**
   * Wait until this attempt is allowed to start: whichever is later of the QPS
   * spacing since the last request START (measured from start, not completion,
   * or the effective rate would depend on the provider's latency) and any armed
   * global cooldown.
   */
  async function gate(): Promise<void> {
    const target = Math.max(lastStartAt + minSpacingMs, cooldownUntil);
    const wait = target - deps.now();
    if (wait > 0) await deps.sleep(wait);
    lastStartAt = deps.now();
  }

  function armCooldown(untilMs: number): void {
    // Never shorten an existing cooldown: a later, unluckier-but-shorter draw
    // must not undo a longer backoff already earned.
    cooldownUntil = Math.max(cooldownUntil, untilMs);
    stats.cooldownUntil = cooldownUntil;
  }

  /**
   * How long to wait before the next attempt, and whether the provider said so.
   *
   * The provider's hint WINS when present -- clamped to `maxRetryAfterMs`, and
   * floored by `cooldownFloorMs` only for the cooldown, never for the hint
   * itself: if Gmail says one second, one second is what it means, and
   * inflating it to thirty would be substituting our guess for its answer.
   */
  function nextDelayMs(err: unknown, attempt: number): { delayMs: number; honoured: boolean } {
    if (err instanceof GmailApiError && err.retryAfterSeconds !== null) {
      const hinted = Math.min(err.retryAfterSeconds * 1000, maxRetryAfterMs);
      return { delayMs: Math.max(0, hinted), honoured: true };
    }
    return {
      // Wrapped rather than passed as a bare `deps.random` reference, so the
      // draw is always a method call on `deps` and `this` survives for a caller
      // whose random() is a real method.
      delayMs: fullJitterDelayMs(attempt, baseDelayMs, maxDelayMs, () => deps.random()),
      honoured: false,
    };
  }

  async function attemptLoop<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let attempt = 1;
    for (;;) {
      await gate();

      // Checked AFTER the gate, so a request that waits out a cooldown only to
      // find the budget gone is refused rather than issued. `fn` is provably
      // not called on this path.
      if (budgetRemainingMs() <= 0) throw new MailPassBudgetExhaustedError();

      stats.requests += 1;
      try {
        return await fn(AbortSignal.timeout(requestTimeoutMs));
      } catch (err) {
        const kind = classify(err);
        if (kind === "fatal") throw err;
        if (kind === "timeout") stats.timeouts += 1;

        const rateLimited = isRateLimit(err);
        if (rateLimited) stats.rateLimitHits += 1;

        const { delayMs, honoured } = nextDelayMs(err, attempt);

        // THE HINT GOVERNS THE COOLDOWN TOO, not just this request's sleep.
        //
        // Arming `max(hint, floor)` would mean a provider that said "7 seconds"
        // gated the pass for 30 -- the retry would sleep its 7s and then sit at
        // the gate for the remaining 23. That is not honouring the hint; it is
        // overriding it with the default we only ever wanted as a floor under
        // OUR OWN blind jitter. Found by these tests rather than by review.
        const cooldownMs = honoured ? delayMs : Math.max(delayMs, cooldownFloorMs);

        if (attempt >= maxAttempts) {
          // DELIBERATE: a rate limit on the FINAL attempt still arms the shared
          // cooldown. The point is not to pace this request -- this request is
          // over -- it is to stop every LATER request in the pass firing into a
          // provider that has just told us to stop. With no hint there is no
          // jitter to lean on either (nothing is going to sleep on it), so the
          // floor is the whole value.
          if (rateLimited) {
            if (honoured) stats.retryAfterHonoured += 1;
            armCooldown(deps.now() + (honoured ? delayMs : cooldownFloorMs));
          }
          throw err;
        }

        if (rateLimited) {
          if (honoured) stats.retryAfterHonoured += 1;
          armCooldown(deps.now() + cooldownMs);
        }
        stats.retries += 1;
        await deps.sleep(delayMs);
        attempt += 1;
      }
    }
  }

  return {
    run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return enqueue(() => attemptLoop(fn));
    },
    budgetRemainingMs,
    get stats(): Readonly<MailLimiterStats> {
      // A snapshot, not the live object: handing out the internal record would
      // let a caller cast the readonly away, and would make an assertion
      // captured before an await mutate under the test.
      return { ...stats };
    },
  };
}
