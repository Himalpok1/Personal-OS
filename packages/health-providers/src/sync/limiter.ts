import { GoogleHealthApiError } from "../google-health-client.js";

// The shared Google Health rate limiter.
//
// Nothing of this kind exists elsewhere in the repository. The calendar sync
// engine's Google pagination loop has no page cap and no 429 handling at all --
// it simply follows nextPageToken until Google stops returning one, and a 429
// there surfaces as an ordinary job failure. That is survivable for a handful of
// calendars. It is not survivable for Health, where one pass fans out across
// eighteen enabled streams and a 35-day trailing window, and where a 429 earned
// by one stream is a signal that EVERY stream must slow down.
//
// Hence a single choke point. `run` is the only path by which a Google Health
// request may be issued during a sync pass, which is what makes three otherwise
// independent guarantees enforceable at once:
//
//   * a global QPS ceiling, because every request passes through one serialized
//     gate rather than through eighteen independent per-stream limiters;
//   * a global cooldown, because a 429 seen on one stream arms a deadline the
//     gate applies to all of them; and
//   * a global wall-clock pass budget, so a pass that is being throttled into
//     uselessness stops rather than occupying a worker slot for an hour.
//
// ---------------------------------------------------------------------------
// Backoff is BLIND full jitter, deliberately.
//
// Google's Health API documents no `Retry-After` header and no `X-RateLimit-*`
// headers -- google-health-client.ts records this on `isRateLimited` -- so there
// is no server hint to honour. Full jitter (a uniform draw over [0, capped
// exponential)) rather than exponential-with-jitter because the failure mode we
// actually care about is eighteen streams retrying in lockstep after a shared
// cooldown expires; full jitter is what spreads that thundering herd, and its
// cost (occasionally retrying sooner than a decorrelated scheme would) is
// irrelevant against a QPS gate that is already serializing us.
//
// ---------------------------------------------------------------------------
// RETRY NESTING IS SINGLE-LAYER. This is a correctness requirement, not a
// preference.
//
// The health sync queue is registered with `retryLimit: 0`. That is not
// timidity about retrying: pg-boss's `stately` retry policy inserts the retry
// row and can DROP that insert on conflict, which dead-letters what was only a
// first transient failure (see pg-boss/dist/manager.js:1293). A queue-level
// retry is therefore not a reliable second chance -- it is a coin flip that can
// turn a recoverable blip into a dead-lettered job.
//
// So the `maxAttempts` here are the ONLY retries in the system, and the hourly
// cron is the outer re-attempt. The worst case for a single request is exactly
// `maxAttempts` calls to Google -- there is no multiplication by a queue retry
// count, and nothing above this layer may reintroduce one.
// ---------------------------------------------------------------------------

/**
 * Everything non-deterministic the limiter touches, injected.
 *
 * The limiter reads the clock, sleeps, and draws jitter. All three are supplied
 * by the caller so the tests can drive a virtual clock and scripted randomness
 * and assert on exact millisecond values, rather than sleeping for real and
 * asserting on ranges. A limiter whose own backoff is only tested "within a
 * plausible window" is a limiter whose off-by-one you find in production.
 */
export interface LimiterDeps {
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Must return a value in [0, 1), matching `Math.random`. */
  random(): number;
}

export interface LimiterOptions {
  /** Requests per second across the whole pass. minSpacingMs = 1000 / qps. */
  qps: number;
  /** Total in-job attempts per request, INCLUDING the first. See the note above. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /**
   * A 429 arms a cooldown of at least this long, even when the computed jitter
   * is shorter. Jitter is drawn from [0, exponential), so an unlucky draw can be
   * near zero -- which is a fine amount of time to wait before a *retry* but a
   * useless amount to wait after Google has explicitly told us to slow down.
   */
  cooldownFloorMs: number;
  requestTimeoutMs: number;
  /** Wall-clock ceiling for the whole pass, measured from limiter creation. */
  passBudgetMs: number;
}

export interface LimiterStats {
  /** Attempts actually handed to `fn`, so retries are counted individually. */
  requests: number;
  retries: number;
  /** 429 responses observed, whether or not a retry followed. */
  rateLimitHits: number;
  timeouts: number;
  /** Absolute deadline; 0 when no cooldown has ever been armed. */
  cooldownUntil: number;
}

export interface HealthLimiter {
  /** THE only path by which a Google Health request may be issued. */
  run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T>;
  /** Remaining pass wall-clock budget in ms; 0 once exhausted. */
  budgetRemainingMs(): number;
  readonly stats: Readonly<LimiterStats>;
}

/**
 * The pass ran out of wall-clock budget.
 *
 * Distinct from any Google error on purpose: it is not a failure of the upstream
 * API and must not be classified as one. The caller records a partial pass and
 * lets the hourly cron pick up the remainder; treating it as a provider fault
 * would misattribute our own scheduling decision to Google.
 */
export class HealthPassBudgetExhaustedError extends Error {
  constructor(message = "Google Health sync pass budget exhausted") {
    super(message);
    this.name = "HealthPassBudgetExhaustedError";
  }
}

export const DEFAULT_LIMITER_OPTIONS: LimiterOptions = {
  qps: 2,
  maxAttempts: 3,
  baseDelayMs: 1_000,
  maxDelayMs: 30_000,
  cooldownFloorMs: 30_000,
  requestTimeoutMs: 20_000,
  passBudgetMs: 600_000,
};

/**
 * Full-jitter backoff: a uniform draw over [0, min(cap, base * 2^(attempt-1))).
 *
 * `attempt` is 1-BASED, so the first retry (after attempt 1 failed) draws from
 * [0, base). Exported because it is the one piece of arithmetic worth asserting
 * against directly; the alternative is inferring it from recorded sleeps, which
 * conflates it with the QPS gate's own waits.
 */
export function fullJitterDelayMs(
  attempt: number,
  baseMs: number,
  capMs: number,
  random: () => number,
): number {
  // 2 ** (attempt - 1) overflows to Infinity for a large enough attempt; Math.min
  // against the cap absorbs that rather than producing NaN downstream.
  const exponential = baseMs * 2 ** (Math.max(1, attempt) - 1);
  const bound = Math.min(capMs, exponential);
  if (!(bound > 0)) return 0;
  const drawn = Math.floor(random() * bound);
  // Clamp to `bound`, not to `capMs`. A [0,1) draw can never reach `bound`
  // anyway, so this only bites when `random` misbehaves -- and then the tighter
  // of the two limits is the right one: a caller returning 5 must not be handed
  // a delay that belongs to a much later attempt. `bound <= capMs` by
  // construction, so the documented "never exceeds cap" still holds.
  return Math.min(bound, Math.max(0, drawn));
}

type FailureKind = "fatal" | "timeout" | "retryable";

/**
 * A request that was aborted, by our own timeout or otherwise.
 *
 * `AbortSignal.timeout` rejects with a DOMException named "TimeoutError"; an
 * externally-triggered abort produces "AbortError". Both mean the same thing
 * here -- we gave up on this attempt, Google may well have been fine -- so both
 * are retryable and both are counted as timeouts.
 */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

function classify(err: unknown): FailureKind {
  if (err instanceof GoogleHealthApiError) {
    // Deliberately checked before the abort test: a GoogleHealthApiError is a
    // real HTTP response, so its status is the authoritative signal.
    if (err.httpStatus === 429 || err.httpStatus >= 500) return "retryable";
    // Everything else Google answered with -- 400, 401, 403, 404, and any other
    // 4xx -- is a defect in the request or the grant. Retrying it cannot change
    // the outcome, and doing so would burn pass budget and QPS allowance that a
    // recoverable stream needs. `httpStatus` is read directly rather than
    // through the named getters because those are in flux this checkpoint.
    return "fatal";
  }
  if (isAbortLike(err)) return "timeout";
  // Anything that is not a GoogleHealthApiError never reached a response: a DNS
  // failure, a socket reset, a TLS error. Those are exactly the transport
  // hiccups retrying exists for.
  return "retryable";
}

export function createHealthLimiter(
  deps: LimiterDeps,
  options?: Partial<LimiterOptions>,
): HealthLimiter {
  // Resolved field by field rather than by object spread so that a caller
  // passing an explicit `undefined` gets the default instead of a hole, which is
  // what `exactOptionalPropertyTypes` would otherwise make ambiguous.
  const qps = options?.qps ?? DEFAULT_LIMITER_OPTIONS.qps;
  const maxAttempts = options?.maxAttempts ?? DEFAULT_LIMITER_OPTIONS.maxAttempts;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_LIMITER_OPTIONS.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_LIMITER_OPTIONS.maxDelayMs;
  const cooldownFloorMs = options?.cooldownFloorMs ?? DEFAULT_LIMITER_OPTIONS.cooldownFloorMs;
  const requestTimeoutMs = options?.requestTimeoutMs ?? DEFAULT_LIMITER_OPTIONS.requestTimeoutMs;
  const passBudgetMs = options?.passBudgetMs ?? DEFAULT_LIMITER_OPTIONS.passBudgetMs;

  const minSpacingMs = qps > 0 ? 1000 / qps : 0;

  // The budget clock starts at construction, not at the first request. A pass
  // that spends four minutes resolving credentials before its first call has
  // genuinely spent four minutes of the worker slot it is holding.
  const createdAt = deps.now();

  const stats: LimiterStats = {
    requests: 0,
    retries: 0,
    rateLimitHits: 0,
    timeouts: 0,
    cooldownUntil: 0,
  };

  // NEGATIVE_INFINITY so the very first request is never made to wait for a
  // spacing interval that no prior request established.
  let lastStartAt = Number.NEGATIVE_INFINITY;
  let cooldownUntil = 0;

  // The serialization chain. Every `run` -- including all of its retries and
  // backoff sleeps -- is appended here, so at most one request is ever in flight
  // and two concurrent callers cannot both slip past the gate. Serializing the
  // whole call rather than just the gate is what makes the QPS ceiling real: if
  // only the gate were serialized, N callers could clear it in sequence and then
  // overlap in flight.
  //
  // `.then(task, task)` rather than `.then(task)` because a rejected predecessor
  // must not poison every subsequent request. The chain is a queue, not a
  // dependency.
  let chain: Promise<unknown> = Promise.resolve();

  function enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = chain.then(task, task);
    // The chain itself must never hold a rejection, or the next `.then(task,
    // task)` would still run `task` but leave an unhandled rejection behind.
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
   * Wait until this attempt is allowed to start.
   *
   * Two independent deadlines, whichever is later: the QPS spacing since the
   * last request START (not its completion -- spacing measured from completion
   * would make the effective rate depend on Google's latency), and any armed
   * global cooldown.
   */
  async function gate(): Promise<void> {
    const target = Math.max(lastStartAt + minSpacingMs, cooldownUntil);
    const wait = target - deps.now();
    if (wait > 0) await deps.sleep(wait);
    lastStartAt = deps.now();
  }

  function armCooldown(untilMs: number): void {
    // Never shorten an existing cooldown. A later, unluckier-but-shorter draw
    // must not undo a longer backoff another stream already earned.
    cooldownUntil = Math.max(cooldownUntil, untilMs);
    stats.cooldownUntil = cooldownUntil;
  }

  async function attemptLoop<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
    let attempt = 1;
    for (;;) {
      await gate();

      // Checked after the gate, so a request that waits out a cooldown only to
      // find the budget gone is refused rather than issued. `fn` is provably not
      // called on this path.
      if (budgetRemainingMs() <= 0) {
        throw new HealthPassBudgetExhaustedError();
      }

      stats.requests += 1;
      try {
        return await fn(AbortSignal.timeout(requestTimeoutMs));
      } catch (err) {
        const kind = classify(err);
        if (kind === "fatal") throw err;
        if (kind === "timeout") stats.timeouts += 1;

        const rateLimited = err instanceof GoogleHealthApiError && err.httpStatus === 429;
        if (rateLimited) stats.rateLimitHits += 1;

        if (attempt >= maxAttempts) {
          // DEVIATION, deliberate: a 429 on the FINAL attempt still arms the
          // shared cooldown. The point of the cooldown is not to pace this
          // request -- this request is over -- it is to stop the other seventeen
          // streams from firing into a server that has just told us to stop. No
          // jitter is drawn here because nothing is going to sleep on it; the
          // floor is the whole value.
          if (rateLimited) armCooldown(deps.now() + cooldownFloorMs);
          throw err;
        }

        // Wrapped rather than passed as a bare `deps.random` reference so the
        // draw is always made as a method call on `deps`, keeping `this` intact
        // for a caller whose random() is a real method rather than a closure.
        const delay = fullJitterDelayMs(attempt, baseDelayMs, maxDelayMs, () => deps.random());
        if (rateLimited) armCooldown(deps.now() + Math.max(delay, cooldownFloorMs));
        stats.retries += 1;
        await deps.sleep(delay);
        attempt += 1;
      }
    }
  }

  return {
    run<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
      return enqueue(() => attemptLoop(fn));
    },
    budgetRemainingMs,
    get stats(): Readonly<LimiterStats> {
      // A snapshot, not the live object. Handing out the internal record would
      // let a caller cast the readonly away and rewrite the limiter's own
      // bookkeeping -- and would make an assertion captured before an await
      // silently mutate under the test.
      return { ...stats };
    },
  };
}
