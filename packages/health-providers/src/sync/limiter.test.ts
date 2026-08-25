import { describe, expect, it } from "vitest";
import { GoogleHealthApiError } from "../google-health-client.js";
import {
  createHealthLimiter,
  DEFAULT_LIMITER_OPTIONS,
  fullJitterDelayMs,
  HealthPassBudgetExhaustedError,
  type LimiterDeps,
  type LimiterOptions,
} from "./limiter.js";

// Every test here runs on a virtual clock. No real timer is ever awaited, so
// the assertions are on exact millisecond values rather than on tolerance
// windows -- which matters, because the defects this limiter exists to prevent
// (a spacing interval measured from the wrong end, a cooldown that a later
// shorter draw quietly shortens) are all off-by-one-shaped and invisible to a
// "roughly a second" assertion.

interface Harness {
  deps: LimiterDeps;
  /** Durations passed to sleep(), in call order. */
  sleeps: number[];
  now(): number;
  /** Advance the clock WITHOUT recording a sleep -- simulates request latency. */
  tick(ms: number): void;
  randomDraws(): number;
}

function harness(randomValues: readonly number[] = []): Harness {
  let clock = 0;
  const sleeps: number[] = [];
  const queue = [...randomValues];
  let draws = 0;

  const deps: LimiterDeps = {
    now: () => clock,
    sleep: (ms) => {
      sleeps.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    random: () => {
      draws += 1;
      const next = queue.shift();
      if (next === undefined) {
        // Loud rather than convenient, mirroring the provider fake's
        // throw-on-unqueued-call rule: an unexpected jitter draw means a retry
        // happened that the test did not intend, and returning a default would
        // hide exactly that.
        throw new Error(`unscripted random() draw #${draws}`);
      }
      return next;
    },
  };

  return { deps, sleeps, now: () => clock, tick: (ms) => (clock += ms), randomDraws: () => draws };
}

function apiError(status: number): GoogleHealthApiError {
  return new GoogleHealthApiError(`Google Health API ${status}`, status, undefined, []);
}

function abortLike(name: "TimeoutError" | "AbortError"): Error {
  const err = new Error(name);
  err.name = name;
  return err;
}

/** Options that switch OFF everything a given test is not measuring. */
function opts(overrides: Partial<LimiterOptions>): Partial<LimiterOptions> {
  return overrides;
}

describe("fullJitterDelayMs", () => {
  it("is a uniform draw over [0, base * 2^(attempt-1)) with a 1-based attempt", () => {
    expect(fullJitterDelayMs(1, 1_000, 30_000, () => 0.75)).toBe(750);
    expect(fullJitterDelayMs(2, 1_000, 30_000, () => 0.75)).toBe(1_500);
    expect(fullJitterDelayMs(3, 1_000, 30_000, () => 0.5)).toBe(2_000);
  });

  it("never exceeds the cap and is never negative across attempts 1..10", () => {
    const cap = 30_000;
    for (let attempt = 1; attempt <= 10; attempt += 1) {
      const low = fullJitterDelayMs(attempt, 1_000, cap, () => 0);
      const high = fullJitterDelayMs(attempt, 1_000, cap, () => 0.999_999_999);
      expect(low).toBe(0);
      expect(high).toBeGreaterThanOrEqual(0);
      expect(high).toBeLessThanOrEqual(cap);
      expect(Number.isFinite(high)).toBe(true);
    }
  });

  it("saturates at the cap rather than overflowing once 2^n runs away", () => {
    // attempt 200 makes base * 2^199 Infinity; the cap must absorb it.
    const value = fullJitterDelayMs(200, 1_000, 30_000, () => 0.999_999_999);
    expect(value).toBeLessThanOrEqual(30_000);
    expect(Number.isNaN(value)).toBe(false);
  });

  it("clamps a misbehaving random() instead of scheduling a negative sleep", () => {
    expect(fullJitterDelayMs(1, 1_000, 30_000, () => -5)).toBe(0);
    // Clamped to attempt 1's own window (1 s), not merely to the 30 s cap.
    expect(fullJitterDelayMs(1, 1_000, 30_000, () => 5)).toBe(1_000);
    expect(fullJitterDelayMs(9, 1_000, 30_000, () => 5)).toBe(30_000);
  });
});

describe("createHealthLimiter backoff", () => {
  it("sleeps exactly fullJitterDelayMs for a scripted random()", async () => {
    const h = harness([0.75, 0.9]);
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 3, baseDelayMs: 1_000, maxDelayMs: 30_000 }),
    );

    await expect(limiter.run(() => Promise.reject(apiError(500)))).rejects.toBeInstanceOf(
      GoogleHealthApiError,
    );

    // Both draws land above the 500 ms spacing interval, so the gate contributes
    // no sleep of its own and the recorded list is purely backoff.
    expect(h.sleeps).toEqual([
      fullJitterDelayMs(1, 1_000, 30_000, () => 0.75),
      fullJitterDelayMs(2, 1_000, 30_000, () => 0.9),
    ]);
    expect(h.sleeps).toEqual([750, 1_800]);
  });
});

describe("createHealthLimiter QPS gate", () => {
  it("spaces two sequential runs by at least minSpacingMs", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2 }));
    const starts: number[] = [];

    await limiter.run(() => {
      starts.push(h.now());
      return Promise.resolve("a");
    });
    await limiter.run(() => {
      starts.push(h.now());
      return Promise.resolve("b");
    });

    expect(starts).toHaveLength(2);
    expect(starts[1]! - starts[0]!).toBeGreaterThanOrEqual(1000 / 2);
    expect(h.sleeps).toEqual([500]);
  });

  it("serializes two CONCURRENT runs -- no overlap, still spaced", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2 }));
    const spans: Array<[number, number]> = [];
    let inFlight = 0;
    let maxInFlight = 0;

    const work = async (): Promise<void> => {
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const start = h.now();
      h.tick(10); // simulated request latency
      spans.push([start, h.now()]);
      inFlight -= 1;
      return Promise.resolve();
    };

    await Promise.all([limiter.run(work), limiter.run(work)]);

    expect(maxInFlight).toBe(1);
    expect(spans).toHaveLength(2);
    const [first, second] = spans as [[number, number], [number, number]];
    expect(second[0]).toBeGreaterThanOrEqual(first[1]); // no overlap
    expect(second[0] - first[0]).toBeGreaterThanOrEqual(500); // still spaced
  });

  it("measures spacing from request START, not completion", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2 }));
    const starts: number[] = [];

    // A slow first request already covers the whole spacing interval, so the
    // second must not be made to wait a further 500 ms on top of it.
    await limiter.run(() => {
      starts.push(h.now());
      h.tick(900);
      return Promise.resolve();
    });
    await limiter.run(() => {
      starts.push(h.now());
      return Promise.resolve();
    });

    expect(starts).toEqual([0, 900]);
    expect(h.sleeps).toEqual([]);
  });
});

describe("createHealthLimiter 429 cooldown", () => {
  it("arms a global cooldown that delays a LATER run, even with no retry left", async () => {
    const h = harness(); // zero scripted draws: a terminal 429 must draw no jitter
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 1, cooldownFloorMs: 30_000 }),
    );

    await expect(limiter.run(() => Promise.reject(apiError(429)))).rejects.toBeInstanceOf(
      GoogleHealthApiError,
    );

    expect(h.randomDraws()).toBe(0);
    expect(limiter.stats.rateLimitHits).toBe(1);
    expect(limiter.stats.cooldownUntil - h.now()).toBeGreaterThanOrEqual(30_000);

    let secondStart = -1;
    await limiter.run(() => {
      secondStart = h.now();
      return Promise.resolve();
    });

    // The cooldown, not the 500 ms spacing interval, is what governs.
    expect(secondStart).toBe(30_000);
  });

  it("floors the cooldown at cooldownFloorMs when the jitter draw is shorter", async () => {
    const h = harness([0.001]); // ~1 ms of jitter, far under the floor
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 2, baseDelayMs: 1_000, cooldownFloorMs: 30_000 }),
    );

    await expect(limiter.run(() => Promise.reject(apiError(429)))).rejects.toBeInstanceOf(
      GoogleHealthApiError,
    );

    expect(limiter.stats.rateLimitHits).toBe(2);
    // Attempt 2 could only have run after the floor elapsed, not after ~1 ms.
    expect(h.now()).toBeGreaterThanOrEqual(30_000);
  });

  it("never shortens an already-armed cooldown", async () => {
    const h = harness();
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 1, cooldownFloorMs: 30_000 }),
    );

    await expect(limiter.run(() => Promise.reject(apiError(429)))).rejects.toThrow();
    const armed = limiter.stats.cooldownUntil;
    expect(armed).toBe(30_000);

    // A success does not clear it, and the next 429 can only push it later.
    await limiter.run(() => Promise.resolve());
    expect(limiter.stats.cooldownUntil).toBe(armed);

    await expect(limiter.run(() => Promise.reject(apiError(429)))).rejects.toThrow();
    expect(limiter.stats.cooldownUntil).toBeGreaterThan(armed);
  });
});

describe("createHealthLimiter failure classification", () => {
  for (const status of [400, 401, 403, 404]) {
    it(`treats HTTP ${status} as fatal -- one call, zero sleeps`, async () => {
      const h = harness(); // any jitter draw would throw
      const limiter = createHealthLimiter(h.deps, opts({ qps: 2, maxAttempts: 3 }));
      let calls = 0;

      await expect(
        limiter.run(() => {
          calls += 1;
          return Promise.reject(apiError(status));
        }),
      ).rejects.toMatchObject({ httpStatus: status });

      expect(calls).toBe(1);
      expect(h.sleeps).toEqual([]);
      expect(limiter.stats.requests).toBe(1);
      expect(limiter.stats.retries).toBe(0);
      expect(limiter.stats.rateLimitHits).toBe(0);
      expect(h.randomDraws()).toBe(0);
    });
  }

  it("retries a 500 up to maxAttempts and then rethrows the last error", async () => {
    const h = harness([0.1, 0.2]);
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 3, baseDelayMs: 1_000 }),
    );
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(apiError(500));
      }),
    ).rejects.toMatchObject({ httpStatus: 500 });

    expect(calls).toBe(3);
    expect(limiter.stats.requests).toBe(3);
    expect(limiter.stats.retries).toBe(3 - 1);
    expect(limiter.stats.rateLimitHits).toBe(0);
  });

  it("treats a TimeoutError as retryable and counts it", async () => {
    const h = harness([0.3]);
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 2, baseDelayMs: 1_000 }),
    );
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(abortLike("TimeoutError"));
      }),
    ).rejects.toThrow(/TimeoutError/);

    expect(calls).toBe(2);
    expect(limiter.stats.timeouts).toBe(2);
    expect(limiter.stats.retries).toBe(1);
  });

  it("treats an AbortError the same way as a TimeoutError", async () => {
    const h = harness([0.3]);
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2, maxAttempts: 2 }));

    await expect(limiter.run(() => Promise.reject(abortLike("AbortError")))).rejects.toThrow();
    expect(limiter.stats.timeouts).toBe(2);
  });

  it("retries a plain transport rejection that never reached a response", async () => {
    const h = harness([0.4]);
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2, maxAttempts: 2 }));
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(new Error("ECONNRESET"));
      }),
    ).rejects.toThrow(/ECONNRESET/);

    expect(calls).toBe(2);
    expect(limiter.stats.timeouts).toBe(0);
    expect(limiter.stats.retries).toBe(1);
  });

  it("recovers on a retry rather than only ever failing", async () => {
    const h = harness([0.5]);
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2, maxAttempts: 3 }));
    let calls = 0;

    const value = await limiter.run(() => {
      calls += 1;
      return calls === 1 ? Promise.reject(apiError(503)) : Promise.resolve("ok");
    });

    expect(value).toBe("ok");
    expect(calls).toBe(2);
    expect(limiter.stats.requests).toBe(2);
    expect(limiter.stats.retries).toBe(1);
  });
});

describe("createHealthLimiter abort signal", () => {
  it("hands fn a live, not-yet-aborted signal", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ requestTimeoutMs: 20_000 }));
    let seen: AbortSignal | undefined;

    await limiter.run((signal) => {
      seen = signal;
      return Promise.resolve();
    });

    expect(seen).toBeDefined();
    expect(seen?.aborted).toBe(false);
    expect(typeof seen?.addEventListener).toBe("function");
  });

  it("gives each attempt its own fresh signal", async () => {
    const h = harness([0.2]);
    const limiter = createHealthLimiter(h.deps, opts({ qps: 2, maxAttempts: 2 }));
    const signals: AbortSignal[] = [];

    await expect(
      limiter.run((signal) => {
        signals.push(signal);
        return Promise.reject(apiError(500));
      }),
    ).rejects.toThrow();

    expect(signals).toHaveLength(2);
    expect(signals[0]).not.toBe(signals[1]);
  });
});

describe("createHealthLimiter pass budget", () => {
  it("reports the remaining budget from creation, not from first use", () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ passBudgetMs: 10_000 }));
    expect(limiter.budgetRemainingMs()).toBe(10_000);
    h.tick(4_000);
    expect(limiter.budgetRemainingMs()).toBe(6_000);
  });

  it("throws HealthPassBudgetExhaustedError without calling fn once spent", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ passBudgetMs: 1_000 }));
    h.tick(1_000);

    expect(limiter.budgetRemainingMs()).toBe(0);

    let calls = 0;
    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.resolve();
      }),
    ).rejects.toBeInstanceOf(HealthPassBudgetExhaustedError);

    expect(calls).toBe(0);
    expect(limiter.stats.requests).toBe(0);
  });

  it("stays exhausted for every subsequent run", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ passBudgetMs: 500, qps: 1_000 }));
    h.tick(600);

    await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(
      HealthPassBudgetExhaustedError,
    );
    await expect(limiter.run(() => Promise.resolve())).rejects.toBeInstanceOf(
      HealthPassBudgetExhaustedError,
    );
  });

  it("stops mid-retry when backoff sleeps consume the remaining budget", async () => {
    const h = harness([0.9, 0.9]);
    const limiter = createHealthLimiter(
      h.deps,
      opts({ qps: 2, maxAttempts: 5, baseDelayMs: 1_000, passBudgetMs: 2_000 }),
    );
    let calls = 0;

    await expect(
      limiter.run(() => {
        calls += 1;
        return Promise.reject(apiError(500));
      }),
    ).rejects.toBeInstanceOf(HealthPassBudgetExhaustedError);

    // 900 ms then 1800 ms of backoff exceeds the 2 s budget before attempt 3.
    expect(calls).toBe(2);
  });
});

describe("createHealthLimiter bookkeeping", () => {
  it("exposes defaults that match the documented contract", () => {
    expect(DEFAULT_LIMITER_OPTIONS).toEqual({
      qps: 2,
      maxAttempts: 3,
      baseDelayMs: 1_000,
      maxDelayMs: 30_000,
      cooldownFloorMs: 30_000,
      requestTimeoutMs: 20_000,
      passBudgetMs: 600_000,
    });
    expect(1000 / DEFAULT_LIMITER_OPTIONS.qps).toBe(500);
  });

  it("returns a stats snapshot that cannot be used to rewrite bookkeeping", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ qps: 1_000 }));
    const before = limiter.stats;
    (before as { requests: number }).requests = 99;

    await limiter.run(() => Promise.resolve());
    expect(limiter.stats.requests).toBe(1);
  });

  it("does not poison the queue after a rejected run", async () => {
    const h = harness();
    const limiter = createHealthLimiter(h.deps, opts({ qps: 1_000, maxAttempts: 1 }));

    await expect(limiter.run(() => Promise.reject(apiError(400)))).rejects.toThrow();
    await expect(limiter.run(() => Promise.resolve("still works"))).resolves.toBe("still works");
  });
});
