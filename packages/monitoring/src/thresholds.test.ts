import type { MonitorCheckStatus } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { consecutiveFailures, consecutiveSuccesses, evaluateThreshold } from "./thresholds.js";

/** Newest first, matching what the caller's query returns. */
function history(...statuses: MonitorCheckStatus[]): MonitorCheckStatus[] {
  return statuses;
}

function evaluate(
  statuses: MonitorCheckStatus[],
  opts: { failure?: number; recovery?: number; active?: boolean } = {},
) {
  return evaluateThreshold({
    recentStatuses: statuses,
    failureThreshold: opts.failure ?? 3,
    recoveryThreshold: opts.recovery ?? 2,
    hasActiveIncident: opts.active ?? false,
  });
}

describe("opening an incident", () => {
  it("does nothing below the failure threshold", () => {
    expect(evaluate(history("down"))).toBe("none");
    expect(evaluate(history("down", "down"))).toBe("none");
  });

  it("opens at exactly the threshold", () => {
    expect(evaluate(history("down", "down", "down"))).toBe("open");
  });

  it("opens past the threshold too", () => {
    expect(evaluate(history("down", "down", "down", "down", "down"))).toBe("open");
  });

  it("requires the failures to be CONSECUTIVE and most recent", () => {
    // Three failures exist, but the newest check succeeded -- the service is
    // currently working, and opening an incident for it would be wrong.
    expect(evaluate(history("up", "down", "down", "down"))).toBe("none");
  });

  it("does not open a SECOND incident while one is active", () => {
    // The database's partial unique index is the real guarantee; this is the
    // decision that stops us attempting the insert at all.
    expect(evaluate(history("down", "down", "down"), { active: true })).toBe("none");
  });

  it("respects a per-target threshold", () => {
    expect(evaluate(history("down"), { failure: 1 })).toBe("open");
    expect(evaluate(history("down", "down", "down", "down"), { failure: 5 })).toBe("none");
  });
});

describe("resolving an incident", () => {
  it("does nothing below the recovery threshold", () => {
    expect(evaluate(history("up"), { active: true })).toBe("none");
  });

  it("resolves at exactly the recovery threshold", () => {
    expect(evaluate(history("up", "up"), { active: true })).toBe("resolve");
  });

  it("requires the successes to be CONSECUTIVE and most recent", () => {
    expect(evaluate(history("down", "up", "up"), { active: true })).toBe("none");
  });

  it("never resolves when there is nothing open", () => {
    expect(evaluate(history("up", "up", "up"), { active: false })).toBe("none");
  });
});

describe("flap suppression", () => {
  it("neither opens nor resolves for a service alternating every check", () => {
    // The property that makes both thresholds worth having. A flapping target
    // produces a leading run of exactly one in either direction, so it stays in
    // whatever state it was already in -- which is the honest answer for a
    // service nobody can call healthy or broken.
    const flapping = history("down", "up", "down", "up", "down", "up");
    expect(evaluate(flapping, { active: false })).toBe("none");
    expect(evaluate(flapping, { active: true })).toBe("none");

    const flappingUp = history("up", "down", "up", "down", "up", "down");
    expect(evaluate(flappingUp, { active: false })).toBe("none");
    expect(evaluate(flappingUp, { active: true })).toBe("none");
  });

  it("a single blip inside an otherwise-healthy run changes nothing", () => {
    expect(evaluate(history("down", "up", "up", "up", "up"))).toBe("none");
  });

  it("a single success does not resolve an incident that needs two", () => {
    expect(evaluate(history("up", "down", "down", "down"), { active: true })).toBe("none");
  });
});

describe("degenerate histories", () => {
  it("does nothing with no history at all", () => {
    expect(evaluate(history())).toBe("none");
    expect(evaluate(history(), { active: true })).toBe("none");
  });

  it("does nothing with fewer checks than the threshold", () => {
    expect(evaluate(history("down"), { failure: 3 })).toBe("none");
  });

  it("never sees `skipped`, because the caller's query excludes it", () => {
    // Documented here as an assertion rather than a comment: if a skip ever
    // reached this function it would break a leading run, which is the exact
    // outcome the query-level exclusion exists to prevent. A nightly maintenance
    // window would silently reset a failure streak one check from opening.
    const withSkip = ["down", "skipped", "down", "down"] as MonitorCheckStatus[];
    expect(evaluate(withSkip)).toBe("none");
    // Whereas the same history with skips excluded -- which is what the caller
    // actually passes -- does open.
    expect(evaluate(history("down", "down", "down"))).toBe("open");
  });
});

describe("counting helpers", () => {
  it("counts leading failures and successes", () => {
    expect(consecutiveFailures(history("down", "down", "up", "down"))).toBe(2);
    expect(consecutiveSuccesses(history("up", "up", "up", "down"))).toBe(3);
  });

  it("distinguishes zero from under-threshold, which a transition cannot", () => {
    // A test asserting only the decision cannot tell "two failures under a
    // threshold of three" from "no failures at all". Both are "none".
    expect(consecutiveFailures(history("up"))).toBe(0);
    expect(consecutiveFailures(history("down", "down"))).toBe(2);
    expect(evaluate(history("up"))).toBe(evaluate(history("down", "down")));
  });
});
