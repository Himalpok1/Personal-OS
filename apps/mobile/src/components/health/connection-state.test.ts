import { describe, expect, it } from "vitest";
import type { HealthConnectionSummary, HealthFreshnessDetail } from "@personal-os/schema";
import {
  canRequestSync,
  describeFreshness,
  resolveHealthConnectionState,
  type HealthConnectionDisplayState,
} from "./connection-state";

const TODAY = "2026-08-24";

function connection(over: Partial<HealthConnectionSummary> = {}): HealthConnectionSummary {
  return {
    id: "0f0e6b7a-6d5e-4a0b-9c1f-2b3c4d5e6f70",
    provider: "google_health",
    status: "active",
    identity_verified_at: "2026-08-24T00:00:00Z",
    granted_scopes: ["activity", "sleep", "metrics"],
    missing_scopes: [],
    has_partial_scope: false,
    needs_reconnect: false,
    has_sync_error: false,
    last_sync_error_at: null,
    ...over,
  };
}

function freshness(over: Partial<HealthFreshnessDetail> = {}): HealthFreshnessDetail {
  return {
    last_successful_sync_at: "2026-08-24T10:00:00Z",
    last_attempted_sync_at: "2026-08-24T10:00:00Z",
    last_attempt_status: "succeeded",
    verified_through_date: TODAY,
    days_behind: 0,
    is_stale: false,
    staleness_threshold_days: 35,
    sync_in_progress: false,
    ...over,
  };
}

describe("resolveHealthConnectionState precedence", () => {
  it("says nothing about the connection when the API could not be read", () => {
    // The dangerous alternative is "not connected", which invites the user to
    // mint a fresh OAuth grant to fix what is actually a network problem.
    expect(
      resolveHealthConnectionState({
        configured: false,
        connection: null,
        freshness: freshness(),
        isLoadError: true,
      }),
    ).toBe("unavailable");

    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ needs_reconnect: true }),
        freshness: freshness({ is_stale: true }),
        isOffline: true,
      }),
    ).toBe("unavailable");
  });

  it("distinguishes an unconfigured server from an unconnected account", () => {
    expect(
      resolveHealthConnectionState({
        configured: false,
        connection: null,
        freshness: freshness(),
      }),
    ).toBe("not_configured");

    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: null,
        freshness: freshness(),
      }),
    ).toBe("not_connected");
  });

  it("puts needs_reconnect ahead of a sync in progress", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ needs_reconnect: true, status: "needs_reauth" }),
        freshness: freshness({ sync_in_progress: true, is_stale: true }),
      }),
    ).toBe("needs_reconnect");
  });

  it("puts a sync in progress ahead of partial scope, staleness and errors", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_partial_scope: true, has_sync_error: true }),
        freshness: freshness({ sync_in_progress: true, is_stale: true }),
      }),
    ).toBe("syncing");
  });

  it("names a missing scope rather than the staleness it causes", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_partial_scope: true, missing_scopes: ["sleep"] }),
        freshness: freshness({ is_stale: true }),
      }),
    ).toBe("partial_scope");
  });

  it("puts staleness ahead of a sync error", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_sync_error: true }),
        freshness: freshness({ is_stale: true, days_behind: 40 }),
      }),
    ).toBe("stale");
  });

  it("reports an error only on a live, fresh connection", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_sync_error: true }),
        freshness: freshness(),
      }),
    ).toBe("error");
  });

  it("is current when everything is healthy", () => {
    expect(
      resolveHealthConnectionState({
        configured: true,
        connection: connection(),
        freshness: freshness(),
      }),
    ).toBe("current");
  });
});

describe("canRequestSync", () => {
  /**
   * The decision for EVERY display state, written out rather than derived.
   *
   * `canRequestSync` is an exhaustive switch over a closed union, so asserting
   * only that it returns a boolean is a tautology -- it cannot return anything
   * else, and a case wrongly flipped from false to true would still be a
   * boolean. The table below is the only form that can actually fail: it names
   * the expected answer per state, so flipping any single case breaks exactly
   * one entry.
   */
  const EXPECTED: Record<HealthConnectionDisplayState, boolean> = {
    // Blocked: a sync could not do anything useful, or would duplicate one
    // already in flight.
    unavailable: false,
    not_configured: false,
    not_connected: false,
    needs_reconnect: false,
    syncing: false,
    // Allowed: exactly the states a manual retry is for. `stale` and `error`
    // are deliberately in this half -- refusing to retry the states that most
    // need retrying is the failure mode worth pinning.
    partial_scope: true,
    stale: true,
    error: true,
    current: true,
  };

  it.each(Object.entries(EXPECTED) as [HealthConnectionDisplayState, boolean][])(
    "%s -> %s",
    (state, expected) => {
      expect(canRequestSync(state)).toBe(expected);
    },
  );

  it("has a decision for every state the resolver can actually produce", () => {
    // Ties the two functions together instead of restating the union a second
    // time (the Record annotation above already fails typecheck on a missing
    // or extra key). Each input below is a real reachable configuration, so
    // this also proves the nine states are not merely declared but emittable.
    const reachable = [
      resolveHealthConnectionState({
        configured: true,
        connection: connection(),
        freshness: freshness(),
        isLoadError: true,
      }),
      resolveHealthConnectionState({ configured: false, connection: null, freshness: freshness() }),
      resolveHealthConnectionState({ configured: true, connection: null, freshness: freshness() }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ needs_reconnect: true }),
        freshness: freshness(),
      }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection(),
        freshness: freshness({ sync_in_progress: true }),
      }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_partial_scope: true }),
        freshness: freshness(),
      }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection(),
        freshness: freshness({ is_stale: true }),
      }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection({ has_sync_error: true }),
        freshness: freshness(),
      }),
      resolveHealthConnectionState({
        configured: true,
        connection: connection(),
        freshness: freshness(),
      }),
    ];

    expect(new Set(reachable).size).toBe(9);
    expect([...new Set(reachable)].sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("blocks strictly more states than it allows the moment a sync is in flight", () => {
    // A second, independent statement of the one rule most likely to be
    // relaxed by accident: whatever else changes, `syncing` must stay blocked.
    expect(canRequestSync("syncing")).toBe(false);
  });
});

describe("describeFreshness", () => {
  it("reports nothing verified as never_verified, never as zero days behind", () => {
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: null, days_behind: null }),
        todayLocalDate: TODAY,
      }),
    ).toEqual({ key: "never_verified", daysBehind: null, verifiedThroughDate: null });
  });

  it("is current when the verified date is today", () => {
    expect(describeFreshness({ freshness: freshness(), todayLocalDate: TODAY })).toEqual({
      key: "current",
      daysBehind: 0,
      verifiedThroughDate: TODAY,
    });
  });

  it("reports a lag as behind, with the day count for the caller to render", () => {
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: "2026-08-23", days_behind: 1 }),
        todayLocalDate: TODAY,
      }),
    ).toEqual({ key: "behind", daysBehind: 1, verifiedThroughDate: "2026-08-23" });
  });

  it("prefers the server's day count over recomputing it", () => {
    // The server computed it against the same requested timezone's local date;
    // a second answer here is how two screens end up a day apart.
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: "2026-08-20", days_behind: 4 }),
        todayLocalDate: TODAY,
      }).daysBehind,
    ).toBe(4);
  });

  it("computes the day count locally when the server sent none", () => {
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: "2026-07-31", days_behind: null }),
        todayLocalDate: TODAY,
      }),
    ).toEqual({ key: "behind", daysBehind: 24, verifiedThroughDate: "2026-07-31" });
  });

  it("crosses a month and a year boundary without drift", () => {
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: "2025-12-30", days_behind: null }),
        todayLocalDate: "2026-01-02",
      }).daysBehind,
    ).toBe(3);
  });

  it("clamps an impossible future verified date to zero rather than showing a negative", () => {
    expect(
      describeFreshness({
        freshness: freshness({ verified_through_date: "2026-08-30", days_behind: null }),
        todayLocalDate: TODAY,
      }),
    ).toEqual({ key: "current", daysBehind: 0, verifiedThroughDate: "2026-08-30" });
  });

  it("reports stale even while the day count is small, since the server owns that verdict", () => {
    expect(
      describeFreshness({
        freshness: freshness({
          verified_through_date: "2026-07-01",
          days_behind: 54,
          is_stale: true,
        }),
        todayLocalDate: TODAY,
      }),
    ).toEqual({ key: "stale", daysBehind: 54, verifiedThroughDate: "2026-07-01" });
  });
});
