import { readFileSync } from "node:fs";
import { addCalendarDays, localDayWindow } from "@personal-os/core";
import {
  healthConnections,
  healthDailyMetrics,
  healthMetricStreams,
  healthSessions,
  healthSyncRuns,
} from "@personal-os/db";
import { PHASE_6A_SCOPES } from "@personal-os/health-providers";
import type {
  HealthMetricSeriesResponse,
  HealthSleepListResponse,
  HealthSummaryResponse,
  HealthWorkoutListResponse,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { DAILY_METRICS, READABLE_METRICS } from "../read-models/health-dashboard.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";
const ALL_SCOPES = PHASE_6A_SCOPES.join(" ");

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
  // Asserted rather than conditionally registered here. A self-registering
  // fallback would let this whole suite pass green against routes server.ts had
  // stopped wiring -- which is precisely the regression it should catch.
  if (!app.hasRoute({ method: "GET", url: "/health-summary" })) {
    throw new Error("health-data routes are not registered in server.ts");
  }
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables(app);
});

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function today(): string {
  return localDayWindow(TZ).localDate;
}

async function seedConnection(
  over: Partial<typeof healthConnections.$inferInsert> = {},
): Promise<string> {
  const [row] = await app.db
    .insert(healthConnections)
    .values({
      provider: "google_health",
      healthUserId: `hu-${Math.random().toString(36).slice(2, 10)}`,
      grantedScope: ALL_SCOPES,
      status: "active",
      ...over,
    })
    .returning();
  return row!.id;
}

async function seedStream(
  connectionId: string,
  metric: string,
  over: Partial<typeof healthMetricStreams.$inferInsert> = {},
): Promise<void> {
  await app.db
    .insert(healthMetricStreams)
    .values({ connectionId, metric, syncEnabled: true, ...over });
}

async function seedDaily(
  connectionId: string,
  metric: string,
  localDate: string,
  over: Partial<typeof healthDailyMetrics.$inferInsert> = {},
): Promise<void> {
  await app.db.insert(healthDailyMetrics).values({
    connectionId,
    metric,
    localDate,
    hasData: true,
    contentHash: `h-${metric}-${localDate}`,
    ...over,
  });
}

/** A session, seeded exactly as the 6.3 sync engine would write one. */
async function seedSession(
  connectionId: string,
  metric: string,
  opts: {
    attributedLocalDate: string;
    startAt: Date;
    endAt: Date;
    deletedAt?: Date;
    detail?: unknown;
    key?: string;
  },
): Promise<string> {
  const durationSeconds = Math.round((opts.endAt.getTime() - opts.startAt.getTime()) / 1000);
  const [row] = await app.db
    .insert(healthSessions)
    .values({
      connectionId,
      metric,
      externalKey: opts.key ?? `k-${metric}-${opts.attributedLocalDate}-${opts.startAt.getTime()}`,
      externalKeySource: "data_point_name",
      attributedLocalDate: opts.attributedLocalDate,
      civilStartLocal: opts.startAt,
      civilEndLocal: opts.endAt,
      startAt: opts.startAt,
      endAt: opts.endAt,
      startUtcOffsetSeconds: -18000,
      endUtcOffsetSeconds: -18000,
      durationSeconds,
      detail: opts.detail ?? {
        source: {
          recordingMethod: "AUTOMATICALLY_RECORDED",
          deviceFormFactor: "PHONE",
          applicationPlatform: "ANDROID",
        },
        sessionType: "SLEEP",
        sessionSubtype: null,
      },
      contentHash: `h-${opts.key ?? opts.startAt.getTime()}`,
      ...(opts.deletedAt ? { deletedAt: opts.deletedAt } : {}),
    })
    .returning();
  return row!.id;
}

async function getSummary(tz: string | null = TZ) {
  const query = tz === null ? "" : `?tz=${encodeURIComponent(tz)}`;
  return app.inject({ method: "GET", url: `/health-summary${query}` });
}

async function getSeries(params: Record<string, string>) {
  const query = new URLSearchParams(params).toString();
  return app.inject({ method: "GET", url: `/health-metrics?${query}` });
}

function tile(summary: HealthSummaryResponse, metric: string) {
  return summary.today.find((t) => t.metric === metric);
}

// ---------------------------------------------------------------------------
// 1-2. Empty and invalid input
// ---------------------------------------------------------------------------

describe("GET /health-summary — no connection and bad input", () => {
  it("reports an honest empty dashboard when nothing is connected", async () => {
    const res = await getSummary();
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthSummaryResponse>();

    expect(typeof body.configured).toBe("boolean");
    expect(body.connection).toBeNull();
    expect(body.today).toEqual([]);
    expect(body.latest).toEqual([]);
    expect(body.capabilities).toEqual([]);
    expect(body.latest_sleep).toBeNull();
    expect(body.latest_workout).toBeNull();
    expect(body.sleep_7d_average_seconds).toBeNull();
    expect(body.local_date).toBe(today());
    // Nothing verified is not the same as "up to date": with no evidence at
    // all the only honest answer is stale.
    expect(body.freshness.verified_through_date).toBeNull();
    expect(body.freshness.days_behind).toBeNull();
    expect(body.freshness.is_stale).toBe(true);
    expect(body.freshness.sync_in_progress).toBe(false);
  });

  it("rejects a missing timezone", async () => {
    expect((await getSummary(null)).statusCode).toBe(400);
  });

  it("rejects an unknown timezone", async () => {
    expect((await getSummary("Mars/Olympus_Mons")).statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// 3-7. The missing-is-not-zero contract
// ---------------------------------------------------------------------------

describe("GET /health-summary — value states", () => {
  it("surfaces a genuine recorded zero as a value, not as absence", async () => {
    const connectionId = await seedConnection();
    await seedDaily(connectionId, "steps", today(), { value: "0", sourceCount: 1 });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    const steps = tile(body, "steps");
    expect(steps?.point.state).toBe("value");
    expect(steps?.point.value).toBe("0");
    expect(steps?.point.source_count).toBe(1);
  });

  it("surfaces a verified absence distinctly from a zero", async () => {
    const connectionId = await seedConnection();
    await seedDaily(connectionId, "steps", today(), {
      hasData: false,
      value: null,
      breakdown: null,
    });

    const steps = tile((await getSummary()).json<HealthSummaryResponse>(), "steps");
    expect(steps?.point.state).toBe("verified_absent");
    expect(steps?.point.value).toBeNull();
  });

  it("surfaces a date with no row at all as unknown", async () => {
    await seedConnection();

    const steps = tile((await getSummary()).json<HealthSummaryResponse>(), "steps");
    expect(steps?.point.state).toBe("unknown");
    expect(steps?.point.value).toBeNull();
  });

  it("refuses to invent a number from a breakdown-only row", async () => {
    const connectionId = await seedConnection();
    // Legal under migration 0013's has_data CHECK: has_data with a breakdown
    // and no scalar value. Reducing the breakdown to a headline number would
    // be manufacturing a fact the provider never sent.
    await seedDaily(connectionId, "heart-rate", today(), {
      value: null,
      breakdown: { beatsPerMinuteMin: 48, beatsPerMinuteMax: 141 },
    });

    const hr = tile((await getSummary()).json<HealthSummaryResponse>(), "heart-rate");
    expect(hr?.point.state).toBe("unknown");
    expect(hr?.point.value).toBeNull();
  });

  it("emits a tile for every daily metric even with nothing stored", async () => {
    await seedConnection();

    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.today.map((t) => t.metric).sort()).toEqual([...DAILY_METRICS].sort());
    expect(body.today.every((t) => t.point.state === "unknown")).toBe(true);
    // Capability covers sessions too, so it is strictly larger than `today`.
    expect(body.capabilities.map((c) => c.metric).sort()).toEqual([...READABLE_METRICS].sort());
  });

  it("never exposes the intraday stream on this surface", async () => {
    await seedConnection();
    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.today.some((t) => t.metric === "heart-rate-intraday")).toBe(false);
    expect(body.capabilities.some((c) => c.metric === "heart-rate-intraday")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 8. Latest
// ---------------------------------------------------------------------------

describe("GET /health-summary — latest recorded value", () => {
  it("carries each metric's own most recent date and omits metrics never recorded", async () => {
    const connectionId = await seedConnection();
    const older = addCalendarDays(today(), -4);
    const newer = addCalendarDays(today(), -1);
    await seedDaily(connectionId, "steps", older, { value: "3000" });
    await seedDaily(connectionId, "steps", newer, { value: "8200" });
    // A verified absence is not a recorded value and must not become `latest`.
    await seedDaily(connectionId, "floors", newer, {
      hasData: false,
      value: null,
      breakdown: null,
    });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    const steps = body.latest.find((t) => t.metric === "steps");
    expect(steps?.point.local_date).toBe(newer);
    expect(steps?.point.value).toBe("8200");
    expect(body.latest.some((t) => t.metric === "floors")).toBe(false);
    // Today itself still has no steps row, so the tile stays unknown -- which
    // is exactly why `latest` exists.
    expect(tile(body, "steps")?.point.state).toBe("unknown");
  });
});

// ---------------------------------------------------------------------------
// 9. Freshness
// ---------------------------------------------------------------------------

describe("GET /health-summary — freshness", () => {
  it("reports zero days behind when the enabled streams cover today", async () => {
    const connectionId = await seedConnection();
    await seedStream(connectionId, "steps", { verifiedThroughDate: today() });

    const { freshness } = (await getSummary()).json<HealthSummaryResponse>();
    expect(freshness.verified_through_date).toBe(today());
    expect(freshness.days_behind).toBe(0);
    expect(freshness.is_stale).toBe(false);
  });

  it("goes stale once verification falls past the threshold", async () => {
    const connectionId = await seedConnection();
    await seedStream(connectionId, "steps", { verifiedThroughDate: addCalendarDays(today(), -9) });

    const { freshness } = (await getSummary()).json<HealthSummaryResponse>();
    expect(freshness.days_behind).toBe(9);
    expect(freshness.is_stale).toBe(true);
    expect(freshness.staleness_threshold_days).toBe(2);
  });

  it("is only as fresh as its stalest enabled stream", async () => {
    const connectionId = await seedConnection();
    await seedStream(connectionId, "steps", { verifiedThroughDate: today() });
    await seedStream(connectionId, "floors", { verifiedThroughDate: addCalendarDays(today(), -6) });
    // Disabled streams are excluded, so this very old one must not drag the
    // answer down.
    await seedStream(connectionId, "weight", {
      syncEnabled: false,
      verifiedThroughDate: addCalendarDays(today(), -200),
    });

    const { freshness } = (await getSummary()).json<HealthSummaryResponse>();
    expect(freshness.verified_through_date).toBe(addCalendarDays(today(), -6));
    expect(freshness.days_behind).toBe(6);
  });

  it("reports a sync as running only while an unfinished run is recent", async () => {
    const connectionId = await seedConnection();
    await app.db.insert(healthSyncRuns).values({
      connectionId,
      metric: "steps",
      kind: "warm",
      status: "succeeded",
      rangeStartDate: today(),
      rangeEndDate: today(),
      startedAt: new Date(Date.now() - 60_000),
      finishedAt: null,
    });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.freshness.sync_in_progress).toBe(true);
    expect(body.freshness.last_attempted_sync_at).not.toBeNull();
    expect(body.freshness.last_attempt_status).toBe("succeeded");
  });

  it("stops reporting a run as running once it outlives the queue's expiry", async () => {
    const connectionId = await seedConnection();
    await app.db.insert(healthSyncRuns).values({
      connectionId,
      metric: "steps",
      kind: "warm",
      status: "failed",
      rangeStartDate: today(),
      rangeEndDate: today(),
      // Older than HEALTH_SYNC_RUN_STALE_MINUTES: pg-boss has already stopped
      // treating this job as active, so a spinner here would never clear.
      startedAt: new Date(Date.now() - 60 * 60_000),
      finishedAt: null,
    });

    const { freshness } = (await getSummary()).json<HealthSummaryResponse>();
    expect(freshness.sync_in_progress).toBe(false);
    expect(freshness.last_attempt_status).toBe("failed");
  });

  it("does not report a finished run as running", async () => {
    const connectionId = await seedConnection();
    await app.db.insert(healthSyncRuns).values({
      connectionId,
      metric: "steps",
      kind: "warm",
      status: "succeeded",
      rangeStartDate: today(),
      rangeEndDate: today(),
      startedAt: new Date(Date.now() - 30_000),
      finishedAt: new Date(Date.now() - 10_000),
    });

    expect((await getSummary()).json<HealthSummaryResponse>().freshness.sync_in_progress).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------------------
// 10-11. Connection state and leakage
// ---------------------------------------------------------------------------

describe("GET /health-summary — connection", () => {
  it("names the scopes a partial consent left ungranted", async () => {
    await seedConnection({ grantedScope: PHASE_6A_SCOPES[0] });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.connection?.granted_scopes).toEqual([PHASE_6A_SCOPES[0]]);
    expect(body.connection?.has_partial_scope).toBe(true);
    expect(body.connection?.missing_scopes.sort()).toEqual(
      [PHASE_6A_SCOPES[1], PHASE_6A_SCOPES[2]].sort(),
    );
  });

  it("reports full consent as complete", async () => {
    await seedConnection();
    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.connection?.missing_scopes).toEqual([]);
    expect(body.connection?.has_partial_scope).toBe(false);
    expect(body.connection?.needs_reconnect).toBe(false);
  });

  it("flags a reconnect and leaks no error text or credential material", async () => {
    const canary = "PGDETAIL-Failing-row-contains-super-secret";
    await seedConnection({
      status: "needs_reauth",
      lastSyncError: canary,
      lastSyncErrorAt: new Date(),
      accessTokenCiphertext: Buffer.from("ya29.not-a-real-token"),
      accessTokenIv: Buffer.from("iv-123456789"),
      accessTokenAuthTag: Buffer.from("tag-0123456789ab"),
    });

    const res = await getSummary();
    const body = res.json<HealthSummaryResponse>();
    expect(body.connection?.needs_reconnect).toBe(true);
    expect(body.connection?.has_sync_error).toBe(true);
    expect(body.connection?.last_sync_error_at).not.toBeNull();

    // The message itself must be structurally inexpressible on this surface.
    const raw = res.body;
    expect(raw).not.toContain(canary);
    expect(raw).not.toContain("ya29.");
    expect(raw).not.toContain("ciphertext");
    expect(raw).not.toContain("auth_tag");
    expect(raw).not.toContain("refresh_token");

    // A substring scan for "last_sync_error" would trip on the deliberately
    // exposed last_sync_error_at TIMESTAMP, so the absence of the message is
    // asserted on KEYS instead -- which is the stronger claim anyway: no key
    // named last_sync_error exists anywhere in the payload, at any depth.
    const keys = new Set<string>();
    const walk = (node: unknown): void => {
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (node !== null && typeof node === "object") {
        for (const [key, child] of Object.entries(node)) {
          keys.add(key);
          walk(child);
        }
      }
    };
    walk(body);
    expect(keys.has("last_sync_error")).toBe(false);
    expect(keys.has("last_sync_error_at")).toBe(true);
  });

  it("prefers the active connection over a disconnected one", async () => {
    await seedConnection({ status: "disconnected", healthUserId: "hu-old" });
    const activeId = await seedConnection({ status: "active", healthUserId: "hu-new" });

    expect((await getSummary()).json<HealthSummaryResponse>().connection?.id).toBe(activeId);
  });
});

// ---------------------------------------------------------------------------
// 12-15. Series
// ---------------------------------------------------------------------------

describe("GET /health-metrics", () => {
  it("bounds the range", async () => {
    await seedConnection();
    // 367 inclusive days.
    expect(
      (await getSeries({ metric: "steps", from: "2026-01-01", to: "2027-01-02" })).statusCode,
    ).toBe(400);
    // Exactly HEALTH_MAX_RANGE_DAYS.
    expect(
      (await getSeries({ metric: "steps", from: "2026-01-01", to: "2027-01-01" })).statusCode,
    ).toBe(200);
    expect(
      (await getSeries({ metric: "steps", from: "2026-03-02", to: "2026-03-01" })).statusCode,
    ).toBe(400);
  });

  it("refuses metrics that are not a readable daily series", async () => {
    await seedConnection();
    for (const metric of ["heart-rate-intraday", "sleep", "exercise", "not-a-metric"]) {
      const res = await getSeries({ metric, from: "2026-08-01", to: "2026-08-03" });
      expect(res.statusCode, metric).toBe(400);
      expect(res.json<{ error: string }>().error, metric).toBe("metric_not_readable");
    }
  });

  it("aggregates only the days that actually recorded a value", async () => {
    const connectionId = await seedConnection();
    await seedStream(connectionId, "steps", { verifiedThroughDate: "2026-08-03" });
    await seedDaily(connectionId, "steps", "2026-08-01", { value: "10" });
    // A genuine recorded zero participates in the aggregate; the untouched
    // 2026-08-03 must not.
    await seedDaily(connectionId, "steps", "2026-08-02", { value: "0" });

    const res = await getSeries({ metric: "steps", from: "2026-08-01", to: "2026-08-03" });
    expect(res.statusCode).toBe(200);
    const body = res.json<HealthMetricSeriesResponse>();

    expect(body.points.map((p) => p.local_date)).toEqual([
      "2026-08-01",
      "2026-08-02",
      "2026-08-03",
    ]);
    expect(body.summary.days_in_range).toBe(3);
    expect(body.summary.days_with_value).toBe(2);
    expect(body.summary.days_unknown).toBe(1);
    expect(body.summary.total).toBe("10");
    // 10 over TWO recorded days, not three -- a missing day is not a zero.
    expect(body.summary.average).toBe("5");
    expect(body.summary.min).toBe("0");
    expect(body.summary.max).toBe("10");
    expect(body.capability.metric).toBe("steps");
    expect(body.capability.sync_enabled).toBe(true);
  });

  it("nulls every aggregate when nothing in the range was recorded", async () => {
    await seedConnection();
    const body = (
      await getSeries({ metric: "steps", from: "2026-08-01", to: "2026-08-03" })
    ).json<HealthMetricSeriesResponse>();
    expect(body.summary.days_with_value).toBe(0);
    expect(body.summary.average).toBeNull();
    expect(body.summary.total).toBeNull();
    expect(body.summary.min).toBeNull();
    expect(body.summary.max).toBeNull();
  });

  it("keeps the counts honest when empty days are filtered out of points", async () => {
    const connectionId = await seedConnection();
    await seedDaily(connectionId, "steps", "2026-08-02", { value: "4200" });
    await seedDaily(connectionId, "steps", "2026-08-03", {
      hasData: false,
      value: null,
      breakdown: null,
    });

    const body = (
      await getSeries({
        metric: "steps",
        from: "2026-08-01",
        to: "2026-08-04",
        include_empty: "false",
      })
    ).json<HealthMetricSeriesResponse>();

    expect(body.points.map((p) => p.local_date)).toEqual(["2026-08-02"]);
    // include_empty changes what is rendered, never what is true.
    expect(body.summary.days_in_range).toBe(4);
    expect(body.summary.days_with_value).toBe(1);
    expect(body.summary.days_verified_absent).toBe(1);
    expect(body.summary.days_unknown).toBe(2);
  });

  it("returns an honest empty series with no connection at all", async () => {
    const body = (
      await getSeries({ metric: "steps", from: "2026-08-01", to: "2026-08-02" })
    ).json<HealthMetricSeriesResponse>();
    expect(body.points).toHaveLength(2);
    expect(body.points.every((p) => p.state === "unknown")).toBe(true);
    expect(body.capability.sync_enabled).toBe(false);
    expect(body.capability.backfill_status).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// 16-20. Sessions
// ---------------------------------------------------------------------------

describe("GET /health-sleep", () => {
  it("groups a night by its wake date, not the date it began", async () => {
    const connectionId = await seedConnection();
    // 2026-08-10 22:30 CDT -> 2026-08-11 06:30 CDT. ADR-049 attributes this to
    // the 11th, which is also the axis Google's own sleep filter uses.
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T03:30:00Z"),
      endAt: new Date("2026-08-11T11:30:00Z"),
    });

    const onWakeDate = await app.inject({
      method: "GET",
      url: "/health-sleep?from=2026-08-11&to=2026-08-11",
    });
    expect(onWakeDate.statusCode).toBe(200);
    const wake = onWakeDate.json<HealthSleepListResponse>();
    expect(wake.items).toHaveLength(1);
    expect(wake.items[0]!.wake_local_date).toBe("2026-08-11");

    const onStartDate = (
      await app.inject({ method: "GET", url: "/health-sleep?from=2026-08-10&to=2026-08-10" })
    ).json<HealthSleepListResponse>();
    expect(onStartDate.items).toEqual([]);
    expect(onStartDate.total).toBe(0);
  });

  it("excludes a tombstoned session from items, total and latest_sleep", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-12",
      startAt: new Date("2026-08-12T04:00:00Z"),
      endAt: new Date("2026-08-12T11:00:00Z"),
      deletedAt: new Date(),
      key: "tombstoned",
    });
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T03:30:00Z"),
      endAt: new Date("2026-08-11T11:30:00Z"),
      key: "live",
    });

    const list = (
      await app.inject({ method: "GET", url: "/health-sleep?from=2026-08-01&to=2026-08-31" })
    ).json<HealthSleepListResponse>();
    expect(list.items).toHaveLength(1);
    expect(list.total).toBe(1);
    expect(list.items[0]!.wake_local_date).toBe("2026-08-11");

    // The newest row by date is the tombstoned one -- if the summary ignored
    // deleted_at it would surface exactly that row here.
    const summary = (await getSummary()).json<HealthSummaryResponse>();
    expect(summary.latest_sleep?.wake_local_date).toBe("2026-08-11");
  });

  it("reports the stage gap as an explicit absence rather than a fabricated split", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T03:30:00Z"),
      endAt: new Date("2026-08-11T11:30:00Z"),
    });

    const item = (
      await app.inject({ method: "GET", url: "/health-sleep?from=2026-08-11&to=2026-08-11" })
    ).json<HealthSleepListResponse>().items[0]!;
    expect(item.stages).toBeNull();
    expect(item.asleep_seconds).toBeNull();
    expect(item.awake_seconds).toBeNull();
    expect(item.duration_seconds).toBe(8 * 3600);
    expect(item.session_type).toBe("SLEEP");
    expect(item.source.device_form_factor).toBe("PHONE");
  });

  it("survives a detail blob that is not the shape the sync engine writes", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T03:30:00Z"),
      endAt: new Date("2026-08-11T11:30:00Z"),
      detail: { source: "not-an-object", sessionType: 42 },
    });

    const res = await app.inject({
      method: "GET",
      url: "/health-sleep?from=2026-08-11&to=2026-08-11",
    });
    expect(res.statusCode).toBe(200);
    const item = res.json<HealthSleepListResponse>().items[0]!;
    expect(item.session_type).toBeNull();
    expect(item.source).toEqual({
      recording_method: null,
      device_form_factor: null,
      application_platform: null,
    });
  });

  it("pages while reporting the full count", async () => {
    const connectionId = await seedConnection();
    for (let day = 1; day <= 5; day += 1) {
      const date = `2026-08-0${day}`;
      await seedSession(connectionId, "sleep", {
        attributedLocalDate: date,
        startAt: new Date(`${date}T04:00:00Z`),
        endAt: new Date(`${date}T11:00:00Z`),
        key: `night-${day}`,
      });
    }

    const first = (
      await app.inject({
        method: "GET",
        url: "/health-sleep?from=2026-08-01&to=2026-08-31&limit=2&offset=0",
      })
    ).json<HealthSleepListResponse>();
    expect(first.items.map((i) => i.wake_local_date)).toEqual(["2026-08-05", "2026-08-04"]);
    expect(first.total).toBe(5);
    expect(first.limit).toBe(2);

    const second = (
      await app.inject({
        method: "GET",
        url: "/health-sleep?from=2026-08-01&to=2026-08-31&limit=2&offset=2",
      })
    ).json<HealthSleepListResponse>();
    expect(second.items.map((i) => i.wake_local_date)).toEqual(["2026-08-03", "2026-08-02"]);
    expect(second.total).toBe(5);
    expect(second.offset).toBe(2);
  });
});

describe("GET /health-workouts", () => {
  it("keys workouts on their start date and leaves the unstored fields null", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "exercise", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T17:00:00Z"),
      endAt: new Date("2026-08-11T17:45:00Z"),
      detail: {
        source: { recordingMethod: "MANUALLY_ENTERED", deviceFormFactor: null },
        sessionType: "RUNNING",
        sessionSubtype: "TRAIL",
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/health-workouts?from=2026-08-11&to=2026-08-11",
    });
    expect(res.statusCode).toBe(200);
    const item = res.json<HealthWorkoutListResponse>().items[0]!;
    expect(item.start_local_date).toBe("2026-08-11");
    expect(item.duration_seconds).toBe(45 * 60);
    expect(item.session_type).toBe("RUNNING");
    expect(item.session_subtype).toBe("TRAIL");
    expect(item.source.recording_method).toBe("MANUALLY_ENTERED");
    expect(item.source.device_form_factor).toBeNull();
    // Not captured by the 6.3 sync engine; null is the honest answer.
    expect(item.distance_meters).toBeNull();
    expect(item.calories_kcal).toBeNull();
    expect(item.heart_rate_zones).toBeNull();
  });

  it("does not return sleep sessions", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: "2026-08-11",
      startAt: new Date("2026-08-11T03:30:00Z"),
      endAt: new Date("2026-08-11T11:30:00Z"),
    });

    const body = (
      await app.inject({ method: "GET", url: "/health-workouts?from=2026-08-01&to=2026-08-31" })
    ).json<HealthWorkoutListResponse>();
    expect(body.items).toEqual([]);
    expect(body.total).toBe(0);
  });
});

describe("GET /health-summary — trailing sleep average", () => {
  it("averages only the nights that have a session", async () => {
    const connectionId = await seedConnection();
    const lastNight = today();
    const twoNightsAgo = addCalendarDays(today(), -2);
    // 7h and 8h across a seven-night window: the five nights with no session
    // must not enter the divisor.
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: lastNight,
      startAt: new Date("2026-01-01T00:00:00Z"),
      endAt: new Date("2026-01-01T07:00:00Z"),
      key: "a",
    });
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: twoNightsAgo,
      startAt: new Date("2026-01-01T00:00:00Z"),
      endAt: new Date("2026-01-01T08:00:00Z"),
      key: "b",
    });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.sleep_7d_average_seconds).toBe((7 * 3600 + 8 * 3600) / 2);
  });

  it("ignores nights outside the trailing window", async () => {
    const connectionId = await seedConnection();
    await seedSession(connectionId, "sleep", {
      attributedLocalDate: addCalendarDays(today(), -30),
      startAt: new Date("2026-01-01T00:00:00Z"),
      endAt: new Date("2026-01-01T09:00:00Z"),
      key: "old",
    });

    const body = (await getSummary()).json<HealthSummaryResponse>();
    expect(body.sleep_7d_average_seconds).toBeNull();
    // The session itself is still the latest one on record -- excluded from the
    // average, not hidden.
    expect(body.latest_sleep).not.toBeNull();
  });

  it("is null when there are no sessions at all", async () => {
    await seedConnection();
    expect((await getSummary()).json<HealthSummaryResponse>().sleep_7d_average_seconds).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 21. Source-level guard
// ---------------------------------------------------------------------------

describe("health read surface source hygiene", () => {
  // Two invariants that are easy to state and easy to break silently, so they
  // are asserted against the source itself rather than trusted to review --
  // same reasoning as apps/mobile's routes-hygiene guard.
  //
  // Substituting zero for a missing value would satisfy every response schema
  // while destroying the exact distinction migration 0013's has_data CHECK
  // exists to preserve, and it would be invisible in any test that only ever
  // seeds real data.
  const sources: [string, string][] = [
    ["read-models/health-dashboard.ts", "../read-models/health-dashboard.ts"],
    ["routes/health-data.ts", "./health-data.ts"],
  ];

  for (const [label, relative] of sources) {
    it(`${label} never substitutes zero for a missing value`, () => {
      const text = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(text.toLowerCase()).not.toContain("coalesce");
    });

    it(`${label} never reads the raw intraday table`, () => {
      const text = readFileSync(new URL(relative, import.meta.url), "utf8");
      expect(text).not.toContain("healthObservations");
      expect(text).not.toContain("health_observations");
    });
  }
});
