import { describe, expect, it } from "vitest";
import {
  createMailLimiter,
  DEFAULT_MAIL_LIMITER_OPTIONS,
  fullJitterDelayMs,
  GMAIL_SAFE_QPS,
  MailPassBudgetExhaustedError,
  type MailLimiterDeps,
} from "./limiter.js";
import { GmailApiError } from "./gmail-client.js";

// A VIRTUAL CLOCK, not a real one.
//
// ADR-053 requires `Retry-After` behaviour to be proven deterministically --
// injected responses against injected now/sleep/random, asserting EXACT
// millisecond values -- precisely because a real Gmail 429 is not obtainable
// without deliberately abusing the quota. Sleeping for real and asserting on a
// tolerance window would be the weaker test the ADR is written against.
function harness(randoms: number[] = []) {
  let clock = 1_000_000;
  const sleeps: number[] = [];
  let draw = 0;
  const deps: MailLimiterDeps = {
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    random: () => randoms[draw++] ?? 0,
  };
  return {
    deps,
    sleeps,
    advance: (ms: number) => {
      clock += ms;
    },
    get clock() {
      return clock;
    },
  };
}

function apiError(
  status: number,
  opts: { retryAfterSeconds?: number | null; gmailStatus?: string } = {},
): GmailApiError {
  const err = new GmailApiError(status, opts.gmailStatus, [], opts.retryAfterSeconds ?? null);
  return err;
}

describe("GMAIL_SAFE_QPS", () => {
  it("is derived from the published quota rather than picked", () => {
    // 6000 units/minute / 20 units per metadata get / 60s = 5/s, minus one for
    // headroom. Asserted so a future change to the catalog constants cannot
    // silently move the ceiling.
    expect(GMAIL_SAFE_QPS).toBe(4);
    expect(DEFAULT_MAIL_LIMITER_OPTIONS.qps).toBe(4);
  });

  it("keeps the pass budget strictly below the queue's expireInSeconds", () => {
    // 900s is the mail sync queue's expireInSeconds. If the budget met or
    // exceeded it, pg-boss would un-`active` a job whose handler still holds
    // its per-connection advisory lock, and every later pass would skip.
    expect(DEFAULT_MAIL_LIMITER_OPTIONS.passBudgetMs).toBeLessThan(900_000);
  });
});

describe("fullJitterDelayMs", () => {
  it("draws from [0, base) on the first retry and doubles thereafter", () => {
    expect(fullJitterDelayMs(1, 1000, 30_000, () => 0.5)).toBe(500);
    expect(fullJitterDelayMs(2, 1000, 30_000, () => 0.5)).toBe(1000);
    expect(fullJitterDelayMs(3, 1000, 30_000, () => 0.5)).toBe(2000);
  });

  it("clamps to the cap and never exceeds it", () => {
    expect(fullJitterDelayMs(20, 1000, 30_000, () => 0.999)).toBeLessThanOrEqual(30_000);
  });

  it("survives a misbehaving random source", () => {
    expect(fullJitterDelayMs(1, 1000, 30_000, () => 5)).toBe(1000);
    expect(fullJitterDelayMs(1, 1000, 30_000, () => -1)).toBe(0);
  });
});

describe("createMailLimiter Retry-After handling", () => {
  it("sleeps for EXACTLY the provider's hint rather than its own jitter", async () => {
    // The draw is scripted to 0.9, which would give 900ms of jitter. The
    // provider says 7 seconds. 7000 is what must be slept.
    const h = harness([0.9]);
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 2 });

    let call = 0;
    const result = await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429, { retryAfterSeconds: 7 }));
      return Promise.resolve("ok");
    });

    expect(result).toBe("ok");
    expect(h.sleeps).toEqual([7000]);
    expect(limiter.stats.retryAfterHonoured).toBe(1);
    expect(limiter.stats.rateLimitHits).toBe(1);
  });

  it("falls back to full jitter when the provider sends no hint", async () => {
    // cooldownFloorMs 0 so this test isolates the JITTER arithmetic. The floor's
    // interaction with it has its own test below.
    const h = harness([0.25]);
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 2,
      baseDelayMs: 1000,
      cooldownFloorMs: 0,
    });

    let call = 0;
    await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429));
      return Promise.resolve("ok");
    });

    // 0.25 * 1000 = 250, exactly.
    expect(h.sleeps).toEqual([250]);
    expect(limiter.stats.retryAfterHonoured).toBe(0);
  });

  it("honours a hint of zero seconds without inflating it to the cooldown floor", async () => {
    // "Retry now" must mean retry now. Flooring the SLEEP at 30s would
    // substitute our guess for the provider's answer; only the shared cooldown
    // is floored.
    const h = harness([0.9]);
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 2,
      cooldownFloorMs: 30_000,
    });

    let call = 0;
    await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429, { retryAfterSeconds: 0 }));
      return Promise.resolve("ok");
    });

    expect(h.sleeps).toEqual([0]);
  });

  it("clamps an absurd hint to maxRetryAfterMs", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 2,
      maxRetryAfterMs: 120_000,
    });

    let call = 0;
    await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429, { retryAfterSeconds: 86_400 }));
      return Promise.resolve("ok");
    });

    expect(h.sleeps).toEqual([120_000]);
  });

  it("treats a 403 RESOURCE_EXHAUSTED as a rate limit, not a permission failure", async () => {
    // Gmail overloads 403 for throttling. Classifying it as a plain permission
    // failure would mean hammering a throttled account instead of backing off.
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 2 });

    let call = 0;
    const result = await limiter.run(() => {
      call += 1;
      if (call === 1) {
        return Promise.reject(
          apiError(403, { gmailStatus: "RESOURCE_EXHAUSTED", retryAfterSeconds: 3 }),
        );
      }
      return Promise.resolve("ok");
    });

    expect(result).toBe("ok");
    expect(h.sleeps).toEqual([3000]);
    expect(limiter.stats.rateLimitHits).toBe(1);
  });

  it("arms a shared cooldown that a LATER request must wait out", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 1,
      cooldownFloorMs: 30_000,
    });

    await expect(
      limiter.run(() => Promise.reject(apiError(429, { retryAfterSeconds: 45 }))),
    ).rejects.toBeInstanceOf(GmailApiError);
    // maxAttempts 1: no retry sleep happened, but the cooldown is still armed
    // from the FINAL attempt -- the point is to stop every later request in the
    // pass firing into a provider that just said stop.
    expect(h.sleeps).toEqual([]);
    expect(limiter.stats.cooldownUntil).toBe(h.clock + 45_000);

    await limiter.run(() => Promise.resolve("later"));
    expect(h.sleeps).toEqual([45_000]);
  });

  it("never shortens an already-armed cooldown", async () => {
    // A FROZEN clock, so the two arms happen at the same instant and the
    // Math.max is the only thing that can decide the outcome. With the normal
    // harness the clock advances during the first cooldown's wait, so the
    // second deadline is later anyway and the test would pass without the
    // guard ever being exercised.
    const clock = 1_000_000;
    const limiter = createMailLimiter(
      { now: () => clock, sleep: () => Promise.resolve(), random: () => 0 },
      { qps: 0, maxAttempts: 1, cooldownFloorMs: 1000 },
    );

    await expect(
      limiter.run(() => Promise.reject(apiError(429, { retryAfterSeconds: 60 }))),
    ).rejects.toBeInstanceOf(GmailApiError);
    expect(limiter.stats.cooldownUntil).toBe(clock + 60_000);

    await expect(
      limiter.run(() => Promise.reject(apiError(429, { retryAfterSeconds: 1 }))),
    ).rejects.toBeInstanceOf(GmailApiError);

    // The second, shorter hint must not undo the longer backoff already earned.
    expect(limiter.stats.cooldownUntil).toBe(clock + 60_000);
  });

  it("arms the cooldown from the HINT, not from max(hint, floor)", async () => {
    // The regression this pair of tests exists for: arming max(7s, 30s) would
    // make the retry sleep 7s and then sit at the gate for 23s more, which is
    // overriding the provider's answer with our own default.
    const h = harness([0.9]);
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 2,
      cooldownFloorMs: 30_000,
    });

    let call = 0;
    await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429, { retryAfterSeconds: 7 }));
      return Promise.resolve("ok");
    });

    expect(h.sleeps).toEqual([7000]);
  });

  it("still floors a cooldown armed from OUR OWN jitter", async () => {
    // With no hint there is nothing to honour, so an unlucky near-zero draw
    // must not leave the pass free to fire straight back into a throttled
    // provider. Jitter 0 -> the floor is the whole cooldown.
    const h = harness([0]);
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 2,
      cooldownFloorMs: 30_000,
    });

    let call = 0;
    await limiter.run(() => {
      call += 1;
      if (call === 1) return Promise.reject(apiError(429));
      return Promise.resolve("ok");
    });

    // 0ms of jitter slept, then the gate holds the retry for the full floor.
    expect(h.sleeps).toEqual([0, 30_000]);
  });
});

describe("createMailLimiter retry classification", () => {
  it("does NOT retry a history.list 404 -- it must reach the caller to escalate", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 3 });
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(apiError(404, { gmailStatus: "NOT_FOUND" }));
      }),
    ).rejects.toBeInstanceOf(GmailApiError);

    // One attempt only. Retrying an expired cursor would burn quota on a
    // request that can never succeed, and would delay the resync that fixes it.
    expect(calls).toBe(1);
    expect(h.sleeps).toEqual([]);
  });

  it("does not retry 400, 401 or a plain 403", async () => {
    for (const status of [400, 401, 403]) {
      const h = harness();
      const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 3 });
      let calls = 0;
      await expect(
        limiter.run(() => {
          calls += 1;
          return Promise.reject(apiError(status));
        }),
      ).rejects.toBeInstanceOf(GmailApiError);
      expect(calls).toBe(1);
    }
  });

  it("retries a 5xx up to maxAttempts and then rethrows", async () => {
    const h = harness([0, 0]);
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 3 });
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(apiError(503));
      }),
    ).rejects.toBeInstanceOf(GmailApiError);

    expect(calls).toBe(3);
    expect(limiter.stats.retries).toBe(2);
  });

  it("retries a transport failure that never reached a response", async () => {
    const h = harness([0]);
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 2 });
    let calls = 0;

    const result = await limiter.run(() => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("ECONNRESET"));
      return Promise.resolve("ok");
    });

    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("counts an abort as a timeout and retries it", async () => {
    const h = harness([0]);
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 2 });
    let calls = 0;

    await limiter.run(() => {
      calls += 1;
      if (calls === 1) {
        const err = new Error("aborted");
        err.name = "TimeoutError";
        return Promise.reject(err);
      }
      return Promise.resolve("ok");
    });

    expect(limiter.stats.timeouts).toBe(1);
  });
});

describe("createMailLimiter pacing and budget", () => {
  it("spaces requests by 1000/qps measured from the previous START", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 4 });

    await limiter.run(() => Promise.resolve(1));
    await limiter.run(() => Promise.resolve(2));
    await limiter.run(() => Promise.resolve(3));

    // 4 qps -> 250ms spacing. The first request waits for nothing.
    expect(h.sleeps).toEqual([250, 250]);
  });

  it("serializes concurrent callers so the N+1 fan-out cannot overlap", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0 });
    let inFlight = 0;
    let maxInFlight = 0;

    const task = () =>
      limiter.run(async () => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        inFlight -= 1;
        return null;
      });

    await Promise.all([task(), task(), task(), task()]);
    expect(maxInFlight).toBe(1);
  });

  it("a rejected request does not poison the queue behind it", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0, maxAttempts: 1 });

    const failing = limiter.run(() => Promise.reject(apiError(400)));
    const following = limiter.run(() => Promise.resolve("still works"));

    await expect(failing).rejects.toBeInstanceOf(GmailApiError);
    await expect(following).resolves.toBe("still works");
  });

  it("refuses a request once the pass budget is spent, without calling fn", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0, passBudgetMs: 1000 });
    h.advance(2000);

    let called = false;
    await expect(
      limiter.run(() => {
        called = true;
        return Promise.resolve(null);
      }),
    ).rejects.toBeInstanceOf(MailPassBudgetExhaustedError);

    expect(called).toBe(false);
    expect(limiter.budgetRemainingMs()).toBe(0);
  });

  it("checks the budget AFTER the cooldown wait, not before", async () => {
    // A request that waits out a long cooldown only to find the budget gone
    // must be refused rather than issued.
    const h = harness();
    const limiter = createMailLimiter(h.deps, {
      qps: 0,
      maxAttempts: 1,
      passBudgetMs: 10_000,
      cooldownFloorMs: 60_000,
    });

    await expect(
      limiter.run(() => Promise.reject(apiError(429, { retryAfterSeconds: 60 }))),
    ).rejects.toBeInstanceOf(GmailApiError);

    let called = false;
    await expect(
      limiter.run(() => {
        called = true;
        return Promise.resolve(null);
      }),
    ).rejects.toBeInstanceOf(MailPassBudgetExhaustedError);
    expect(called).toBe(false);
  });

  it("hands out a stats snapshot rather than the live record", async () => {
    const h = harness();
    const limiter = createMailLimiter(h.deps, { qps: 0 });
    const before = limiter.stats;
    await limiter.run(() => Promise.resolve(null));
    expect(before.requests).toBe(0);
    expect(limiter.stats.requests).toBe(1);
  });
});
