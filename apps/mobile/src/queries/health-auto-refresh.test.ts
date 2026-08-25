import type {
  HealthConnectionSummary,
  HealthFreshnessDetail,
  HealthSummaryResponse,
} from "@personal-os/schema";
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetHealthAutoRefreshForTests,
  claimHealthAutoRefresh,
  shouldAutoRefresh,
} from "./health";

// Pure tests over the app-open refresh decision. No React and no renderer:
// this app installs neither, and `claimHealthAutoRefresh` is deliberately the
// exact function the hook calls, so exercising it here exercises the shipped
// path rather than a parallel reimplementation of it.
//
// What is being pinned is a bounded-provider-call guarantee, not a UI detail.
// Every one of these cases is a way the screen could otherwise hit Google on
// its own, unattended, more than once.

const CONNECTION: HealthConnectionSummary = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "google_health",
  status: "active",
  identity_verified_at: "2026-08-20T10:00:00.000Z",
  granted_scopes: ["activity_and_fitness.readonly"],
  missing_scopes: [],
  has_partial_scope: false,
  needs_reconnect: false,
  has_sync_error: false,
  last_sync_error_at: null,
};

const FRESHNESS: HealthFreshnessDetail = {
  last_successful_sync_at: "2026-07-10T04:00:00.000Z",
  last_attempted_sync_at: "2026-07-10T04:00:00.000Z",
  last_attempt_status: "succeeded",
  verified_through_date: "2026-07-09",
  days_behind: 46,
  is_stale: true,
  staleness_threshold_days: 35,
  sync_in_progress: false,
};

function summary(
  overrides: {
    configured?: boolean;
    connection?: HealthConnectionSummary | null;
    freshness?: Partial<HealthFreshnessDetail>;
  } = {},
): HealthSummaryResponse {
  return {
    configured: overrides.configured ?? true,
    connection: overrides.connection === undefined ? CONNECTION : overrides.connection,
    timezone: "America/Chicago",
    local_date: "2026-08-25",
    freshness: { ...FRESHNESS, ...overrides.freshness },
    today: [],
    latest: [],
    latest_sleep: null,
    sleep_7d_average_seconds: null,
    latest_workout: null,
    capabilities: [],
  };
}

const NONE: ReadonlySet<string> = new Set<string>();

describe("shouldAutoRefresh", () => {
  it("fires when the connection is stale and idle", () => {
    expect(shouldAutoRefresh({ summary: summary(), alreadyRequested: NONE })).toEqual({
      connectionId: CONNECTION.id,
    });
  });

  it("does not fire while a sync is already in progress", () => {
    // The run in flight is about to re-answer the staleness question. Firing a
    // second request here is redundant work against a rate-limited provider.
    const input = summary({ freshness: { sync_in_progress: true } });
    expect(shouldAutoRefresh({ summary: input, alreadyRequested: NONE })).toBeNull();
  });

  it("does not fire when the data is not stale", () => {
    // This is a staleness remedy, not a refresh-on-open. The hourly cron owns
    // routine freshness.
    const input = summary({ freshness: { is_stale: false, days_behind: 1 } });
    expect(shouldAutoRefresh({ summary: input, alreadyRequested: NONE })).toBeNull();
  });

  it("does not fire when there is no connection", () => {
    expect(
      shouldAutoRefresh({ summary: summary({ connection: null }), alreadyRequested: NONE }),
    ).toBeNull();
  });

  it("does not fire when the connection needs reconnecting", () => {
    // A sync cannot succeed without a live grant, and firing anyway would put a
    // failed run behind a banner that already says what to do.
    const input = summary({
      connection: { ...CONNECTION, status: "needs_reauth", needs_reconnect: true },
    });
    expect(shouldAutoRefresh({ summary: input, alreadyRequested: NONE })).toBeNull();
  });

  it("does not fire when the server has no Google Health client configured", () => {
    expect(
      shouldAutoRefresh({ summary: summary({ configured: false }), alreadyRequested: NONE }),
    ).toBeNull();
  });

  it("does not fire before the summary has loaded", () => {
    expect(shouldAutoRefresh({ summary: undefined, alreadyRequested: NONE })).toBeNull();
  });

  it("does not fire for a connection id already requested", () => {
    const alreadyRequested = new Set([CONNECTION.id]);
    expect(shouldAutoRefresh({ summary: summary(), alreadyRequested })).toBeNull();
  });
});

describe("claimHealthAutoRefresh (module-level once-per-run guard)", () => {
  beforeEach(() => {
    __resetHealthAutoRefreshForTests();
  });

  it("fires exactly once for the same connection across repeated calls", () => {
    // The guard is module-level precisely so that remounting the screen -- or a
    // second component mounting the hook -- cannot fire a second request.
    const input = summary();
    expect(claimHealthAutoRefresh(input)).toEqual({ connectionId: CONNECTION.id });
    expect(claimHealthAutoRefresh(input)).toBeNull();
    expect(claimHealthAutoRefresh(input)).toBeNull();
  });

  it("claims before returning, so an in-flight request cannot be duplicated", () => {
    // No request has resolved between these two calls; the claim alone must be
    // what stops the second one.
    const input = summary();
    claimHealthAutoRefresh(input);
    expect(claimHealthAutoRefresh(input)).toBeNull();
  });

  it("fires again for a different connection id", () => {
    const other = "22222222-2222-4222-8222-222222222222";
    expect(claimHealthAutoRefresh(summary())).toEqual({ connectionId: CONNECTION.id });
    expect(claimHealthAutoRefresh(summary({ connection: { ...CONNECTION, id: other } }))).toEqual({
      connectionId: other,
    });
  });

  it("does not claim a connection it declined to fire for", () => {
    // A declined call must not burn the one allowed request: the connection was
    // mid-sync, and the next app open should still be able to act on it.
    const busy = summary({ freshness: { sync_in_progress: true } });
    expect(claimHealthAutoRefresh(busy)).toBeNull();
    expect(claimHealthAutoRefresh(summary())).toEqual({ connectionId: CONNECTION.id });
  });

  it("__resetHealthAutoRefreshForTests restores the ability to fire", () => {
    expect(claimHealthAutoRefresh(summary())).toEqual({ connectionId: CONNECTION.id });
    expect(claimHealthAutoRefresh(summary())).toBeNull();
    __resetHealthAutoRefreshForTests();
    expect(claimHealthAutoRefresh(summary())).toEqual({ connectionId: CONNECTION.id });
  });
});
