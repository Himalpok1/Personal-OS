import { encryptSecret } from "@personal-os/ai-providers";
import { satisfiesBackfillInvariant } from "@personal-os/core/health/backfill";
import {
  devices,
  healthConnections,
  healthDailyMetrics,
  healthMetricStreams,
  healthSessions,
  healthSyncRuns,
  type Db,
} from "@personal-os/db";
import {
  createFakeGoogleHealthClient,
  createHealthLimiter,
  GoogleHealthApiError,
  GoogleHealthOAuthError,
  HEALTH_METRICS,
  rollupBucket,
  type DataPointPage,
  type GoogleHealthClient,
  type RefreshedHealthTokens,
} from "@personal-os/health-providers";
import { and, eq, sql } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";
import { HealthSyncJobError } from "./health-sync-connection.js";
import {
  isSyncableMetric,
  runHealthConnectionSync,
  SYNCABLE_METRICS,
  type HealthSyncConnectionJobData,
  type HealthSyncDeps,
} from "../health/orchestrate.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";

// ===========================================================================
// SYNTHETIC DATA ONLY. Not one byte in this file came from a real account.
// ===========================================================================
//
// Every civil date, step count and session below is invented. Real health data
// must never enter this repository -- not in a fixture, not in a snapshot, not
// "anonymized".

const db: Db = buildTestDb();

/**
 * One fixed instant for every test.
 *
 * 18:00 UTC is chosen on purpose: `lastGloballyCompleteDateExclusive` subtracts
 * twelve hours (the maximum lag behind UTC of any real offset), so at 18:00 the
 * bound lands on the SAME UTC date. That makes the verified-range clamp
 * observable -- warmWindow's exclusive end is 2026-08-26 while only 2026-08-24
 * may be claimed -- rather than accidentally equal.
 */
const NOW = new Date("2026-08-24T18:00:00.000Z");
const WARM_START = "2026-07-20";
const WARM_END = "2026-08-26";
/** The most a warm pass at NOW may claim as verified. */
const CLAIMABLE_THROUGH = "2026-08-24";

const ACCESS_TOKEN_PLAINTEXT = "synthetic-access-token-aaaa";
const REFRESHED_TOKEN_PLAINTEXT = "synthetic-access-token-bbbb";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface ConnectionOptions {
  healthUserId?: string;
  accessTokenExpiresAt?: Date | null;
  withRefreshToken?: boolean;
  status?: "active" | "needs_reauth" | "revoked" | "disconnected";
}

async function insertConnection(options: ConnectionOptions = {}): Promise<string> {
  const access = encryptSecret(ACCESS_TOKEN_PLAINTEXT, env.CREDENTIALS_ENCRYPTION_KEY);
  const refresh = encryptSecret("synthetic-refresh-token", env.CREDENTIALS_ENCRYPTION_KEY);
  const withRefresh = options.withRefreshToken !== false;

  const [row] = await db
    .insert(healthConnections)
    .values({
      provider: "google",
      healthUserId: options.healthUserId ?? `health-user-${Math.random()}`,
      accessTokenCiphertext: access.ciphertext,
      accessTokenIv: access.iv,
      accessTokenAuthTag: access.authTag,
      accessTokenExpiresAt:
        options.accessTokenExpiresAt === undefined
          ? new Date(NOW.getTime() + 3_600_000)
          : options.accessTokenExpiresAt,
      ...(withRefresh
        ? {
            refreshTokenCiphertext: refresh.ciphertext,
            refreshTokenIv: refresh.iv,
            refreshTokenAuthTag: refresh.authTag,
          }
        : {}),
      status: options.status ?? "active",
    })
    .returning({ id: healthConnections.id });
  return row!.id;
}

async function insertStream(
  connectionId: string,
  metric: string,
  overrides: Partial<typeof healthMetricStreams.$inferInsert> = {},
): Promise<typeof healthMetricStreams.$inferSelect> {
  const [row] = await db
    .insert(healthMetricStreams)
    .values({ connectionId, metric, syncEnabled: true, ...overrides })
    .returning();
  return row!;
}

async function insertAlertDevice(): Promise<string> {
  const [row] = await db
    .insert(devices)
    .values({
      name: "Test device",
      platform: "android",
      tokenHash: `hash-${Math.random()}`,
      pushToken: "ExponentPushToken[abc]",
      notifyAlerts: true,
      notificationsEnabled: true,
    })
    .returning({ id: devices.id });
  return row!.id;
}

/** A synthetic steps rollup bucket. int64 leaves arrive as STRINGS. */
// Leaf names below are the OBSERVED live rollup shapes (Checkpoint 6.3L):
// dailyRollUp appends an aggregation suffix, and the prefix is the bare unit
// noun -- `total-calories` has unit `caloriesKcal` but leaf `kcalSum`.
function steps(localDate: string, count: string) {
  return rollupBucket(localDate, "steps", { countSum: count });
}

function distanceBucket(localDate: string, mm: string) {
  return rollupBucket(localDate, "distance", { millimetersSum: mm });
}

function caloriesBucket(localDate: string, kcal: number) {
  return rollupBucket(localDate, "totalCalories", { kcalSum: kcal });
}

function civilDateTime(localDate: string, hours: number, minutes = 0): Record<string, unknown> {
  const [y, m, d] = localDate.split("-").map(Number);
  return { date: { year: y!, month: m!, day: d! }, time: { hours, minutes, seconds: 0 } };
}

interface SleepFixtureOptions {
  startLocalDate: string;
  endLocalDate: string;
  startTime: string;
  endTime: string;
  dataPointName?: string | null;
  updateTime?: string;
}

/** A synthetic sleep session, filtered and attributed on its civil END. */
function sleepRecord(options: SleepFixtureOptions): Record<string, unknown> {
  const record: Record<string, unknown> = {
    sleep: {
      interval: {
        startTime: options.startTime,
        endTime: options.endTime,
        civilStartTime: civilDateTime(options.startLocalDate, 22, 41),
        civilEndTime: civilDateTime(options.endLocalDate, 6, 52),
        startTimeUtcOffset: "-18000s",
        endTimeUtcOffset: "-18000s",
      },
      type: "SLEEP",
    },
    dataSource: { recordingMethod: "AUTOMATICALLY_RECORDED" },
  };
  if (options.dataPointName !== null) {
    record["dataPointName"] = options.dataPointName ?? "users/me/dataPoints/sleep-1";
  }
  if (options.updateTime !== undefined) record["updateTime"] = options.updateTime;
  return record;
}

function page(records: readonly Record<string, unknown>[], nextPageToken?: string): DataPointPage {
  return {
    dataPoints: records as never,
    ...(nextPageToken !== undefined ? { nextPageToken } : {}),
  };
}

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

/** A limiter with a real clock but instant sleeps, so backoff never blocks. */
function testLimiter() {
  return createHealthLimiter(
    {
      now: () => Date.now(),
      sleep: () => Promise.resolve(),
      random: () => 0,
    },
    { qps: 0, passBudgetMs: 600_000 },
  );
}

interface FakeBoss {
  boss: PgBoss;
  sent: { queue: string; data: Record<string, unknown> }[];
}

function fakeBoss(): FakeBoss {
  const sent: { queue: string; data: Record<string, unknown> }[] = [];
  const boss = {
    send: (queue: string, data: Record<string, unknown>) => {
      sent.push({ queue, data });
      return Promise.resolve("job-id");
    },
  } as unknown as PgBoss;
  return { boss, sent };
}

/** Wraps a client so concurrent in-flight requests can be observed. */
function instrument(client: GoogleHealthClient): {
  client: GoogleHealthClient;
  maxInFlight: () => number;
} {
  let inFlight = 0;
  let max = 0;
  async function track<T>(run: () => Promise<T>): Promise<T> {
    inFlight += 1;
    max = Math.max(max, inFlight);
    try {
      // A real await boundary, so two overlapping callers would both be counted.
      await new Promise((resolve) => setTimeout(resolve, 5));
      return await run();
    } finally {
      inFlight -= 1;
    }
  }
  return {
    client: {
      getIdentity: (token) => track(() => client.getIdentity(token)),
      dailyRollUp: (req) => track(() => client.dailyRollUp(req)),
      list: (req) => track(() => client.list(req)),
      reconcile: (req) => track(() => client.reconcile(req)),
    },
    maxInFlight: () => max,
  };
}

type Fake = ReturnType<typeof createFakeGoogleHealthClient>;

function runPass(
  client: GoogleHealthClient,
  data: HealthSyncConnectionJobData,
  overrides: Partial<HealthSyncDeps> = {},
) {
  return runHealthConnectionSync(
    {
      db,
      client,
      limiterFactory: testLimiter,
      now: () => NOW,
      ...overrides,
    },
    data,
  );
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

async function dailyRows(connectionId: string) {
  return db
    .select()
    .from(healthDailyMetrics)
    .where(eq(healthDailyMetrics.connectionId, connectionId))
    .orderBy(healthDailyMetrics.metric, healthDailyMetrics.localDate);
}

async function runRows(connectionId: string) {
  return db
    .select()
    .from(healthSyncRuns)
    .where(eq(healthSyncRuns.connectionId, connectionId))
    .orderBy(healthSyncRuns.startedAt, healthSyncRuns.id);
}

async function streamRow(connectionId: string, metric: string) {
  const [row] = await db
    .select()
    .from(healthMetricStreams)
    .where(
      and(
        eq(healthMetricStreams.connectionId, connectionId),
        eq(healthMetricStreams.metric, metric),
      ),
    );
  return row!;
}

interface Identity {
  table_key: string;
  ctid: string;
  xmin: string;
  updated_at: string;
}

/**
 * Physical identity of every health data row, for the idempotency assertion.
 *
 * ctid = the tuple's physical location (changes on any update);
 * xmin  = the transaction that wrote it (changes on any update);
 * updated_at = the column the SET clause would bump.
 *
 * xmax is deliberately ABSENT: ON CONFLICT's speculative insertion takes a row
 * lock that stamps xmax IN PLACE on rows it merely examined, so an untouched
 * row's xmax legitimately differs between runs. Comparing it would fail a
 * correct implementation.
 */
async function identities(connectionId: string): Promise<Identity[]> {
  const daily = await db.execute(
    sql`select metric || ':' || local_date::text as table_key, ctid::text as ctid,
               xmin::text as xmin, updated_at::text as updated_at
        from health_daily_metrics where connection_id = ${connectionId}`,
  );
  const sessions = await db.execute(
    sql`select metric || ':' || external_key as table_key, ctid::text as ctid,
               xmin::text as xmin, updated_at::text as updated_at
        from health_sessions where connection_id = ${connectionId}`,
  );
  return [
    ...(daily.rows as unknown as Identity[]),
    ...(sessions.rows as unknown as Identity[]),
  ].sort((a, b) => a.table_key.localeCompare(b.table_key));
}

async function observationCount(): Promise<number> {
  const res = await db.execute(sql`select count(*)::int as n from health_observations`);
  return (res.rows[0] as { n: number }).n;
}

// ---------------------------------------------------------------------------

describe("health.google.sync-connection", () => {
  beforeEach(async () => {
    await truncateTestTables(db);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // Stream selection
  // -------------------------------------------------------------------------

  describe("stream selection", () => {
    it("selects 18 of the catalog's 19 metrics, excluding the reconcile stream", () => {
      expect(HEALTH_METRICS).toHaveLength(19);
      expect(SYNCABLE_METRICS).toHaveLength(18);
      // Structural, not a name blocklist: the exclusion is by acquisition mode.
      expect(isSyncableMetric("heart-rate-intraday")).toBe(false);
      expect(isSyncableMetric("heart-rate")).toBe(true);
    });

    it("never fetches heart-rate-intraday even when its stream is enabled", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "heart-rate-intraday", { syncEnabled: true });

      // The fake throws on ANY unqueued call, so a reconcile here would fail
      // loudly rather than returning an empty page and a green test.
      const fake = createFakeGoogleHealthClient();
      const result = await runPass(fake, { connectionId, trigger: "manual" });

      expect(result.skipped).toBe("no_enabled_streams");
      expect(fake.calls).toHaveLength(0);
      expect(await observationCount()).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Idempotency
  // -------------------------------------------------------------------------

  describe("idempotency", () => {
    it("writes ZERO health rows on an identical second sync, but still records a run", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");
      const buckets = [steps("2026-08-20", "1234"), steps("2026-08-21", "0")];

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: buckets });
      await runPass(fake, { connectionId, trigger: "manual" });

      const before = await identities(connectionId);
      expect(before.length).toBeGreaterThan(0);
      const runsBefore = (await runRows(connectionId)).length;

      fake.queueDailyRollUp("steps", { rollupDataPoints: buckets });
      await runPass(fake, { connectionId, trigger: "manual" });

      expect(await identities(connectionId)).toEqual(before);
      // "We checked" lives on the run table, never on the data rows -- which is
      // exactly what makes zero data writes possible.
      expect((await runRows(connectionId)).length).toBe(runsBefore + 1);
      const [, second] = await runRows(connectionId);
      expect(second).toMatchObject({ status: "succeeded", rowsInserted: 0, rowsUpdated: 0 });
      expect(second!.rowsUnchanged).toBeGreaterThan(0);
    });

    it("records exactly one update when only a session's updateTime changed", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");
      const base = {
        startLocalDate: "2026-08-20",
        endLocalDate: "2026-08-21",
        startTime: "2026-08-21T03:41:00Z",
        endTime: "2026-08-21T11:52:00Z",
      };

      const fake = createFakeGoogleHealthClient();
      // sleep's maxRangeDays is 30, so a 37-day warm window is two chunks.
      fake.queueList("sleep", page([sleepRecord({ ...base, updateTime: "2026-08-21T12:00:00Z" })]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      fake.queueList("sleep", page([sleepRecord({ ...base, updateTime: "2026-08-22T09:00:00Z" })]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      const runs = await runRows(connectionId);
      const updates = runs.reduce((sum, r) => sum + r.rowsUpdated, 0);
      const inserts = runs.reduce((sum, r) => sum + r.rowsInserted, 0);
      expect(inserts).toBe(1);
      expect(updates).toBe(1);

      const stored = await db
        .select()
        .from(healthSessions)
        .where(eq(healthSessions.connectionId, connectionId));
      expect(stored).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Authority model
  // -------------------------------------------------------------------------

  describe("authority", () => {
    it("A: an authoritative warm pass densifies and advances a CLAMPED verified range", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [steps("2026-08-20", "1234"), steps("2026-08-21", "0")],
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      const rows = await dailyRows(connectionId);
      const real = rows.filter((r) => r.hasData);
      const absent = rows.filter((r) => !r.hasData);
      expect(real.map((r) => r.localDate)).toEqual(["2026-08-20", "2026-08-21"]);
      // densifiableRange clamps the start to first_data_date (2026-08-20) and
      // the end to the last globally-complete civil date (2026-08-24), so 22
      // and 23 are verified absent and nothing earlier is invented.
      expect(absent.map((r) => r.localDate)).toEqual(["2026-08-22", "2026-08-23"]);

      const stream = await streamRow(connectionId, "steps");
      expect(stream.firstDataDate).toBe("2026-08-20");
      // NOT WARM_END. trailingWindow's exclusive end is today+2 precisely so no
      // real local day escapes the window; stamping it verified would be a
      // claim about a civil date that has not begun anywhere.
      expect(stream.verifiedThroughDate).toBe(CLAIMABLE_THROUGH);
      expect(WARM_END > CLAIMABLE_THROUGH).toBe(true);
      expect(stream.earliestVerifiedDate).toBe(WARM_START);
      expect(stream.lastFullSyncAt).not.toBeNull();
      expect(stream.capabilityStatus).toBe("available_in_window");
    });

    it("A2 (ADR-046a): an authoritative EMPTY window densifies INSERT-ONLY, never blanking real data", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1234")] });
      await runPass(fake, { connectionId, trigger: "manual" });

      // A complete, authoritative fetch that returns NOTHING. ADR-046a permits
      // this to create verified-absence rows, but bounds them: "those writes
      // must be insert-only [and] must never overwrite or downgrade an existing
      // has_data = true row."
      //
      // The reason is that `authoritative` proves only that WE fetched the whole
      // window -- never that Google's empty answer was correct. One HTTP 200
      // carrying an empty array is indistinguishable from a genuinely empty
      // account, so allowing it to overwrite would let a single bad response
      // blank the entire warm window of real history.
      fake.queueDailyRollUp("steps", { rollupDataPoints: [] });
      await runPass(fake, { connectionId, trigger: "manual" });

      const afterBlank = await dailyRows(connectionId);
      expect(afterBlank.find((r) => r.localDate === "2026-08-20")).toMatchObject({
        hasData: true,
        value: "1234",
      });
      // Days that never had data DO get absence markers -- the densification
      // itself still happened, it simply could not downgrade anything.
      expect(afterBlank.some((r) => !r.hasData)).toBe(true);
    });

    it("A2b: a NON-empty authoritative window still overwrites an absent day (deletion detection)", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [steps("2026-08-20", "1234"), steps("2026-08-21", "999")],
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      // 08-20 disappears while the fetch still returns real data, so the empty
      // answer is not suspect: this IS the only deletion detection daily
      // metrics have, because the API ships no tombstones.
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-21", "999")] });
      await runPass(fake, { connectionId, trigger: "manual" });

      const after = await dailyRows(connectionId);
      expect(after.find((r) => r.localDate === "2026-08-20")).toMatchObject({
        hasData: false,
        value: null,
      });
      expect(after.find((r) => r.localDate === "2026-08-21")).toMatchObject({
        hasData: true,
        value: "999",
      });

      // ...and it is not a one-way door.
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [steps("2026-08-20", "1234"), steps("2026-08-21", "999")],
      });
      await runPass(fake, { connectionId, trigger: "manual" });
      const restored = await dailyRows(connectionId);
      expect(restored.find((r) => r.localDate === "2026-08-20")).toMatchObject({
        hasData: true,
        value: "1234",
      });
    });

    it("B: an INCOMPLETE empty response writes no absence and does not advance the range", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", { firstDataDate: "2026-07-01" });

      const fake = createFakeGoogleHealthClient();
      // dailyRollUp cannot follow a page token at all (sending pageSize is a
      // live-verified 400), so a token appearing is positive evidence of an
      // unread page -- the one thing that makes a fetch non-authoritative.
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [],
        nextPageToken: "more-please",
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      expect(await dailyRows(connectionId)).toHaveLength(0);
      const stream = await streamRow(connectionId, "steps");
      expect(stream.verifiedThroughDate).toBeNull();
      expect(stream.earliestVerifiedDate).toBeNull();
      const [run] = await runRows(connectionId);
      expect(run).toMatchObject({
        status: "failed",
        failureClass: "unfollowable_next_page_token",
      });
    });

    it("C: existing rows survive an incomplete empty response BYTE-IDENTICALLY", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1234")] });
      await runPass(fake, { connectionId, trigger: "manual" });
      const before = await identities(connectionId);

      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [],
        nextPageToken: "truncated",
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      expect(await identities(connectionId)).toEqual(before);
    });

    it("D: a hot pass writes real data but NEVER densifies or advances the range", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", { firstDataDate: "2026-01-01" });

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-22", "500")] });
      const result = await runPass(fake, {
        connectionId,
        trigger: "manual",
        requestedKind: "hot",
      });
      expect(result.skipped).toBeNull();

      const rows = await dailyRows(connectionId);
      // The hot cadence exists to keep today's numbers current; a hot pass that
      // wrote nothing would make it dead code.
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ localDate: "2026-08-22", hasData: true, value: "500" });
      // But it writes no ABSENCE and makes no verified claim.
      expect(rows.some((r) => !r.hasData)).toBe(false);
      const stream = await streamRow(connectionId, "steps");
      expect(stream.verifiedThroughDate).toBeNull();
      expect(stream.lastFullSyncAt).toBeNull();
    });

    it("does NOT fail a run merely because 6 of 7 civil days came back", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      // 6.2P observed exactly this: `floors` returned six buckets for a
      // seven-day range because day seven had no stairs. The originally-planned
      // "bucket count must equal civil-day count" check would have hard-failed
      // it, and would go on hard-failing every backfill chunk covering days the
      // device was not worn.
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [
          steps("2026-08-18", "1"),
          steps("2026-08-19", "2"),
          steps("2026-08-20", "3"),
          steps("2026-08-21", "4"),
          steps("2026-08-22", "5"),
          steps("2026-08-23", "6"),
        ],
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      const [run] = await runRows(connectionId);
      expect(run!.status).toBe("succeeded");
      expect(run!.failureClass).toBeNull();
      // The pair is still reported, because it is a genuinely useful diagnostic.
      expect(run!.receivedBucketCount).toBe(6);
      expect(run!.expectedBucketCount).toBeGreaterThan(6);
    });

    it("counts a value-shape violation, fails the run, and densifies nothing", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", { firstDataDate: "2026-07-01" });

      const fake = createFakeGoogleHealthClient();
      // steps is declared int64; a fractional value means our reading of the
      // type is wrong and must surface rather than be truncated away.
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [steps("2026-08-20", "12.5")],
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      const [run] = await runRows(connectionId);
      expect(run).toMatchObject({ status: "failed", failureClass: "value_shape_violation" });
      expect(run!.rowsRejected).toBe(1);
      expect(await dailyRows(connectionId)).toHaveLength(0);
      expect((await streamRow(connectionId, "steps")).verifiedThroughDate).toBeNull();
    });

    // Checkpoint 9.0. The HRV incident tripped a breaker five times with an
    // identical rejection and left no record of WHICH shape was rejected: the
    // count survived, the Rejection did not, and the worker log that held the
    // response shape was discarded by a container recreation. This pins the
    // two durable records that now exist -- the rejection CODE as a token in
    // the run row, and the code/key-path/JSON-kind triple in a structured log
    // line -- and that neither carries the rejected value itself.
    it("records WHICH shape was rejected: a token in error_message and a value-free log line", async () => {
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      try {
        const connectionId = await insertConnection();
        await insertStream(connectionId, "steps", { firstDataDate: "2026-07-01" });

        const fake = createFakeGoogleHealthClient();
        fake.queueDailyRollUp("steps", {
          rollupDataPoints: [steps("2026-08-20", "12.5"), steps("2026-08-21", "13.5")],
        });
        await runPass(fake, { connectionId, trigger: "manual" });

        const [run] = await runRows(connectionId);
        expect(run!.rowsRejected).toBe(2);
        // The class first, then the rejection code upper-cased into the TOKEN
        // form closeSyncRun persists; nothing else.
        expect(run!.errorMessage).toBe("value_shape_violation LEAF_TYPE_MISMATCH");

        const rejectionLines = records.filter((r) => r["event"] === "health.sync.rejection");
        // Two records, one distinct shape: the line is per SHAPE with a count,
        // not per record.
        expect(rejectionLines).toHaveLength(1);
        expect(rejectionLines[0]).toMatchObject({
          runId: run!.id,
          metric: "steps",
          kind: "manual",
          code: "leaf_type_mismatch",
          keyPath: "steps.countSum",
          sawType: "string",
          count: 2,
        });
        const serialized = JSON.stringify(records);
        expect(serialized).not.toContain("12.5");
        expect(serialized).not.toContain("13.5");
        expect(run!.errorMessage).not.toContain("12.5");
      } finally {
        restore();
      }
    });

    it("drops records dated outside the requested window and counts them as rejections", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", { firstDataDate: "2026-07-01" });

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", {
        // 2026-01-01 is far outside the warm window. Storing it would let one
        // chunk overwrite a neighbouring chunk's days.
        rollupDataPoints: [steps("2026-08-20", "10"), steps("2026-01-01", "99")],
      });
      await runPass(fake, { connectionId, trigger: "manual" });

      const rows = await dailyRows(connectionId);
      expect(rows.some((r) => r.localDate === "2026-01-01")).toBe(false);
      const [run] = await runRows(connectionId);
      expect(run).toMatchObject({ status: "failed", failureClass: "records_outside_window" });
      expect(run!.rowsRejected).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Sessions
  // -------------------------------------------------------------------------

  describe("sessions", () => {
    const base = {
      startLocalDate: "2026-08-20",
      endLocalDate: "2026-08-21",
      startTime: "2026-08-21T03:41:00Z",
      endTime: "2026-08-21T11:52:00Z",
    };

    async function seedOneSleep(connectionId: string, fake: Fake): Promise<void> {
      fake.queueList("sleep", page([sleepRecord(base)]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });
    }

    it("tombstones a name-keyed session that stops being returned, then revives it", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");
      const fake = createFakeGoogleHealthClient();
      await seedOneSleep(connectionId, fake);

      // A DIFFERENT session, not an empty page. An empty authoritative window
      // yields no seen keys at all, and the sweep refuses to run on an empty
      // key set -- `x <> ALL('{}')` is TRUE in Postgres, so an unguarded sweep
      // would delete the whole window. So the evidence that session 1 is gone
      // has to be a fetch that returned something ELSE.
      const other = sleepRecord({
        startLocalDate: "2026-08-18",
        endLocalDate: "2026-08-19",
        startTime: "2026-08-19T03:41:00Z",
        endTime: "2026-08-19T11:52:00Z",
        dataPointName: "users/me/dataPoints/sleep-2",
      });
      fake.queueList("sleep", page([other]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      const [swept] = await db
        .select()
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.externalKey, "users/me/dataPoints/sleep-1"),
          ),
        );
      expect(swept!.deletedAt).not.toBeNull();

      fake.queueList("sleep", page([sleepRecord(base), other]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      const [revived] = await db
        .select()
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.externalKey, "users/me/dataPoints/sleep-1"),
          ),
        );
      // Same row resurrected under the same external key, never a duplicate.
      expect(revived!.id).toBe(swept!.id);
      expect(revived!.deletedAt).toBeNull();
    });

    it("never tombstones a DERIVED-key session", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");
      const fake = createFakeGoogleHealthClient();

      // No dataPointName -- identity.ts falls back to a derived hash, whose
      // stability depends on fields Google may recompute.
      fake.queueList("sleep", page([sleepRecord({ ...base, dataPointName: null })]));
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      const [seeded] = await db
        .select()
        .from(healthSessions)
        .where(eq(healthSessions.connectionId, connectionId));
      expect(seeded!.externalKeySource).not.toBe("data_point_name");

      // A NON-EMPTY sweep, so the empty-key-set guard is not what protects the
      // derived row -- the external_key_source restriction is.
      fake.queueList(
        "sleep",
        page([
          sleepRecord({
            startLocalDate: "2026-08-18",
            endLocalDate: "2026-08-19",
            startTime: "2026-08-19T03:41:00Z",
            endTime: "2026-08-19T11:52:00Z",
            dataPointName: "users/me/dataPoints/sleep-2",
          }),
        ]),
      );
      fake.queueList("sleep", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      const [after] = await db
        .select()
        .from(healthSessions)
        .where(eq(healthSessions.id, seeded!.id));
      expect(after!.deletedAt).toBeNull();
    });

    it("a hot pass never sweeps", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");
      const fake = createFakeGoogleHealthClient();
      await seedOneSleep(connectionId, fake);

      // hotWindow is 5 days at 30 days per chunk, so exactly one chunk. It
      // returns a DIFFERENT session, so the sweep would fire on any pass that
      // was allowed to sweep -- the only thing stopping it is `kind === "hot"`.
      fake.queueList(
        "sleep",
        page([
          sleepRecord({
            startLocalDate: "2026-08-22",
            endLocalDate: "2026-08-23",
            startTime: "2026-08-23T03:41:00Z",
            endTime: "2026-08-23T11:52:00Z",
            dataPointName: "users/me/dataPoints/sleep-3",
          }),
        ]),
      );
      await runPass(fake, { connectionId, trigger: "manual", requestedKind: "hot" });

      const [row] = await db
        .select()
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.externalKey, "users/me/dataPoints/sleep-1"),
          ),
        );
      expect(row!.deletedAt).toBeNull();
    });

    it("attributes a sleep session to its civil WAKE date (ADR-049)", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");
      const fake = createFakeGoogleHealthClient();
      await seedOneSleep(connectionId, fake);

      const [row] = await db
        .select()
        .from(healthSessions)
        .where(eq(healthSessions.connectionId, connectionId));
      // Started the evening of the 20th, woke on the 21st.
      expect(row!.attributedLocalDate).toBe("2026-08-21");
      // Derived from the PHYSICAL instants, never from civil-clock subtraction.
      expect(row!.durationSeconds).toBe(29460);
    });
  });

  // -------------------------------------------------------------------------
  // Token handling
  // -------------------------------------------------------------------------

  describe("token handling", () => {
    function refreshStub(): {
      fn: (params: { refreshToken: string }) => Promise<RefreshedHealthTokens>;
      calls: () => number;
    } {
      let calls = 0;
      return {
        fn: () => {
          calls += 1;
          return Promise.resolve({
            accessToken: REFRESHED_TOKEN_PLAINTEXT,
            expiresAt: new Date(NOW.getTime() + 3_600_000),
          });
        },
        calls: () => calls,
      };
    }

    it("refreshes inline when the stored token is expired, exactly ONCE for the whole pass", async () => {
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");
      await insertStream(connectionId, "distance");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      fake.queueDailyRollUp("distance", {
        rollupDataPoints: [distanceBucket("2026-08-20", "1000")],
      });

      const refresh = refreshStub();
      await runPass(fake, { connectionId, trigger: "manual" }, { refresh: refresh.fn });

      // Two streams, one refresh: the token is resolved once and reused. An
      // unbudgeted design would hit Google's token endpoint eighteen times on a
      // fully-enabled connection.
      expect(refresh.calls()).toBe(1);
      const runs = await runRows(connectionId);
      expect(runs.every((r) => r.status === "succeeded")).toBe(true);
    });

    it("retries a 401 once, then aborts the pass rather than refreshing again", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");
      await insertStream(connectionId, "distance");

      const fake = createFakeGoogleHealthClient();
      const unauthorized = new GoogleHealthApiError(
        "Google Health API 401",
        401,
        "UNAUTHENTICATED",
      );
      fake.queueDailyRollUp("steps", unauthorized);
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      fake.queueDailyRollUp("distance", unauthorized);

      const refresh = refreshStub();
      await expect(
        runPass(fake, { connectionId, trigger: "manual" }, { refresh: refresh.fn }),
      ).rejects.toThrow(/refresh budget exhausted/i);

      expect(refresh.calls()).toBe(1);
      const runs = await runRows(connectionId);
      expect(runs[0]).toMatchObject({ metric: "steps", status: "succeeded" });
      expect(runs[1]).toMatchObject({ metric: "distance", failureClass: "auth_unresolved" });

      // A 401 that survived one refresh is a propagation blip far more often
      // than a revoked grant, so the connection is deliberately left alone.
      const [connection] = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connectionId));
      expect(connection!.status).toBe("active");
    });

    it("marks needs_reauth on invalid_grant, alerts once, and does NOT throw", async () => {
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");
      await insertAlertDevice();
      const boss = fakeBoss();

      const fake = createFakeGoogleHealthClient();
      const result = await runPass(
        fake,
        { connectionId, trigger: "manual" },
        {
          boss: boss.boss,
          refresh: () =>
            Promise.reject(
              new GoogleHealthOAuthError(
                "Token has been expired or revoked.",
                400,
                "invalid_grant",
              ),
            ),
        },
      );
      expect(result.skipped).toBeNull();

      const [connection] = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connectionId));
      expect(connection!.status).toBe("needs_reauth");
      expect(connection!.lastSyncError).toBe("oauth_invalid_grant");

      const [run] = await runRows(connectionId);
      expect(run).toMatchObject({ status: "failed", failureClass: "auth_permanent" });

      const alerts = boss.sent.filter((s) => s.queue === NOTIFICATIONS_DISPATCH_QUEUE);
      expect(alerts).toHaveLength(1);
      // OCCURRENCE-SCOPED as of Checkpoint 8.1. The old key stopped at the
      // failure CLASS, so once `auth_permanent` was accepted for a connection it
      // could never alert again -- and production burned exactly this key on
      // 2026-09-01 (ADR-057 finding #4). The discriminator is
      // `health_connections.last_sync_error_at`, the instant this needs-reauth
      // episode began, so a reconnect-then-refail mints a genuinely new key.
      expect(connection!.lastSyncErrorAt).not.toBeNull();
      expect(alerts[0]!.data["dedupeKey"]).toBe(
        `health-sync-alert:${connectionId}:auth_permanent:${connection!.lastSyncErrorAt!.toISOString()}`,
      );
    });

    it("re-auth alerts are OCCURRENCE-scoped: A, retry A, recovery, B", async () => {
      // The contract this lane exists to establish. The old key stopped at the
      // failure CLASS (`health-sync-alert:<id>:auth_permanent`), and production
      // ACCEPTED exactly that key on 2026-09-01. ADR-051b then records that the
      // recovery rebound the SAME connection row with `created_at` preserved --
      // so the connection id was unchanged and the next auth_permanent failure
      // would have alerted nobody (ADR-057 finding #4).
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");
      await insertAlertDevice();

      const failing = {
        refresh: () =>
          Promise.reject(
            new GoogleHealthOAuthError("Token has been expired or revoked.", 400, "invalid_grant"),
          ),
      };

      // `at` is threaded through because the discriminator IS the instant the
      // episode began. The rest of the suite freezes the clock at NOW, which
      // would make two genuinely separate episodes share a millisecond and
      // collide -- an artifact of a frozen clock, not of the design, since a
      // reconnect between two grant losses takes human time. Passing real
      // elapsed time is what models production.
      async function keysAfterPass(at: Date): Promise<string[]> {
        const boss = fakeBoss();
        await runPass(
          createFakeGoogleHealthClient(),
          { connectionId, trigger: "manual" },
          { boss: boss.boss, now: () => at, ...failing },
        );
        return boss.sent
          .filter((sent) => sent.queue === NOTIFICATIONS_DISPATCH_QUEUE)
          .map((sent) => String(sent.data["dedupeKey"]));
      }

      async function episodeStamp(): Promise<string> {
        const [row] = await db
          .select()
          .from(healthConnections)
          .where(eq(healthConnections.id, connectionId));
        return row!.lastSyncErrorAt!.toISOString();
      }

      // ---- occurrence A ---------------------------------------------------
      const a = await keysAfterPass(NOW);
      expect(a).toHaveLength(1);
      const keyA = a[0]!;
      expect(keyA).toBe(`health-sync-alert:${connectionId}:auth_permanent:${await episodeStamp()}`);

      // ---- retry of A -----------------------------------------------------
      // The connection is now needs_reauth, so the pass is refused before any
      // alert can fire. Zero new keys is the correct anti-spam outcome, and the
      // durable state is already surfaced in Settings.
      const retry = await keysAfterPass(new Date(NOW.getTime() + 60_000));
      expect(retry).toHaveLength(0);

      // ---- recovery -------------------------------------------------------
      // What a reconnect does: status back to active and the episode marker
      // CLEARED. Clearing it is what re-arms the key.
      await db
        .update(healthConnections)
        .set({ status: "active", lastSyncError: null, lastSyncErrorAt: null })
        .where(eq(healthConnections.id, connectionId));

      // ---- occurrence B ---------------------------------------------------
      const b = await keysAfterPass(new Date(NOW.getTime() + 3_600_000));
      expect(b).toHaveLength(1);
      const keyB = b[0]!;
      expect(keyB).toBe(`health-sync-alert:${connectionId}:auth_permanent:${await episodeStamp()}`);
      // THE WHOLE POINT: a second, independent grant loss is notifiable.
      expect(keyB).not.toBe(keyA);
    });

    it("leaves the connection ACTIVE when the token endpoint returns a 5xx", async () => {
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      await runPass(
        fake,
        { connectionId, trigger: "manual" },
        {
          refresh: () =>
            Promise.reject(new GoogleHealthOAuthError("upstream boom", 503, undefined)),
        },
      );

      // Marking needs_reauth here would sign the user out of Health because
      // Google had a bad minute.
      const [connection] = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connectionId));
      expect(connection!.status).toBe("active");
      const [run] = await runRows(connectionId);
      expect(run!.status).toBe("failed");
      expect(run!.failureClass).toBe("transport");
    });

    it("never overwrites the stored refresh token on a refresh", async () => {
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");
      const [before] = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connectionId));

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [] });
      await runPass(
        fake,
        { connectionId, trigger: "manual" },
        {
          refresh: () =>
            Promise.resolve({
              accessToken: REFRESHED_TOKEN_PLAINTEXT,
              expiresAt: new Date(NOW.getTime() + 3_600_000),
            }),
        },
      );

      const [after] = await db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, connectionId));
      // Google usually omits a refresh_token on a refresh grant, so an
      // "overwrite everything" update would null the only credential that lets
      // this connection ever recover.
      expect(after!.refreshTokenCiphertext).toEqual(before!.refreshTokenCiphertext);
      expect(after!.accessTokenCiphertext).not.toEqual(before!.accessTokenCiphertext);
    });
  });

  // -------------------------------------------------------------------------
  // Breaker
  // -------------------------------------------------------------------------

  describe("circuit breaker", () => {
    it("disables a stream after 5 identical non-retryable failures and alerts once", async () => {
      const connectionId = await insertConnection();
      const stream = await insertStream(connectionId, "steps", { firstDataDate: "2026-07-01" });
      await insertAlertDevice();
      const boss = fakeBoss();

      for (let i = 0; i < 4; i += 1) {
        await db.insert(healthSyncRuns).values({
          connectionId,
          streamId: stream.id,
          metric: "steps",
          kind: "warm",
          rangeStartDate: WARM_START,
          rangeEndDate: WARM_END,
          status: "failed",
          failureClass: "value_shape_violation",
          startedAt: new Date(NOW.getTime() - (10 - i) * 3_600_000),
        });
      }

      // A second, HEALTHY stream so the separate "every stream failed" alert
      // does not also fire and blur what this test is asserting.
      await insertStream(connectionId, "distance");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", {
        rollupDataPoints: [steps("2026-08-20", "12.5")],
      });
      fake.queueDailyRollUp("distance", {
        rollupDataPoints: [distanceBucket("2026-08-20", "10")],
      });
      await runPass(fake, { connectionId, trigger: "manual" }, { boss: boss.boss });

      const after = await streamRow(connectionId, "steps");
      expect(after.syncEnabled).toBe(false);
      // Never `not_supported`: a repeated non-retryable fault is at least as
      // consistent with a defect in our own request (the 6.2P lesson).
      expect(after.capabilityStatus).toBe("provider_error");
      expect(after.lastSyncError).toBe("value_shape_violation");

      const alerts = boss.sent.filter((s) => s.queue === NOTIFICATIONS_DISPATCH_QUEUE);
      expect(alerts).toHaveLength(1);
      // OCCURRENCE-SCOPED as of Checkpoint 8.1: a UTC date bucket. A breaker
      // trip is self-limiting (it disables the stream), so re-tripping the same
      // metric on the same day needs a manual re-enable plus five more failing
      // runs; the bucket re-arms daily rather than never.
      expect(alerts[0]!.data["dedupeKey"]).toBe(
        `health-sync-alert:${connectionId}:breaker:steps:${NOW.toISOString().slice(0, 10)}`,
      );
    });

    it("does not trip on repeated RETRYABLE failures", async () => {
      const connectionId = await insertConnection();
      const stream = await insertStream(connectionId, "steps");

      for (let i = 0; i < 5; i += 1) {
        await db.insert(healthSyncRuns).values({
          connectionId,
          streamId: stream.id,
          metric: "steps",
          kind: "warm",
          rangeStartDate: WARM_START,
          rangeEndDate: WARM_END,
          status: "failed",
          failureClass: "rate_limited",
          startedAt: new Date(NOW.getTime() - (10 - i) * 3_600_000),
        });
      }

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp(
        "steps",
        new GoogleHealthApiError("Google Health API 429", 429, "RESOURCE_EXHAUSTED"),
      );
      await runPass(fake, { connectionId, trigger: "manual" });

      // Disabling a stream because Google was busy would be the wrong response.
      expect((await streamRow(connectionId, "steps")).syncEnabled).toBe(true);
    });

    it("disables the stream on an EVIDENCED missing scope, with the exact API literal", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "sleep");

      const fake = createFakeGoogleHealthClient();
      fake.queueList(
        "sleep",
        new GoogleHealthApiError("Google Health API 403", 403, "PERMISSION_DENIED", [
          { reason: "ACCESS_TOKEN_SCOPE_INSUFFICIENT" },
        ]),
      );
      await runPass(fake, { connectionId, trigger: "manual" });

      const stream = await streamRow(connectionId, "sleep");
      expect(stream.syncEnabled).toBe(false);
      expect(stream.capabilityStatus).toBe("missing_scope");
      // The exact literal PATCH /streams refuses to re-enable against, so the
      // API and the worker agree on one string rather than two that look alike.
      expect(stream.lastSyncError).toBe("scope_not_granted");
      const [run] = await runRows(connectionId);
      expect(run!.failureClass).toBe("scope_denied");
    });

    it("never records not_supported from an ambiguous 404", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp(
        "steps",
        new GoogleHealthApiError("Google Health API 404", 404, "NOT_FOUND"),
      );
      await runPass(fake, { connectionId, trigger: "manual" });

      const stream = await streamRow(connectionId, "steps");
      expect(stream.capabilityStatus).toBe("provider_error");
      expect(stream.capabilityStatus).not.toBe("not_supported");
      // The stream stays enabled: an ambiguous 404 is at least as likely to be
      // a path we built wrong as a type Google lacks.
      expect(stream.syncEnabled).toBe(true);
      const [run] = await runRows(connectionId);
      expect(run!.failureClass).toBe("provider_error:404");
    });
  });

  // -------------------------------------------------------------------------
  // Backfill
  // -------------------------------------------------------------------------

  describe("backfill", () => {
    it("resumes from the persisted cursor and advances it inside the chunk transaction", async () => {
      const connectionId = await insertConnection();
      // sync_enabled false so ONLY backfill runs -- the fake throws on any
      // unqueued call, so a stray foreground fetch would fail loudly.
      await insertStream(connectionId, "total-calories", {
        syncEnabled: false,
        backfillStatus: "running",
        backfillTargetDate: "2026-06-01",
        backfillCursorDate: "2026-07-20",
      });

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("total-calories", {
        rollupDataPoints: [caloriesBucket("2026-07-10", 1800)],
      });
      fake.queueDailyRollUp("total-calories", {
        rollupDataPoints: [caloriesBucket("2026-06-30", 1900)],
      });

      const result = await runPass(fake, { connectionId, trigger: "scheduled" });
      expect(result.backfillChunks).toBe(2);

      const stream = await streamRow(connectionId, "total-calories");
      // total-calories carries a DOCUMENTED 14-day rollup cap, so chunkRange
      // walks backwards in fortnights: 07-20 -> 07-06 -> 06-22.
      expect(stream.backfillCursorDate).toBe("2026-06-22");
      expect(stream.backfillStatus).toBe("running");
      expect(
        satisfiesBackfillInvariant({
          backfillStatus: stream.backfillStatus as "running",
          backfillTargetDate: stream.backfillTargetDate,
          backfillCursorDate: stream.backfillCursorDate,
        }),
      ).toBe(true);

      const runs = await runRows(connectionId);
      expect(runs).toHaveLength(2);
      expect(runs.every((r) => r.kind === "backfill")).toBe(true);
    });

    it("completes when the cursor reaches the target, KEEPING the target non-null", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", {
        syncEnabled: false,
        backfillStatus: "running",
        backfillTargetDate: "2026-06-01",
        backfillCursorDate: "2026-07-20",
      });

      const fake = createFakeGoogleHealthClient();
      // steps' cap is 90 days, so 06-01..07-20 is a single chunk that lands
      // exactly on the target.
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-07-01", "500")] });
      await runPass(fake, { connectionId, trigger: "scheduled" });

      const stream = await streamRow(connectionId, "steps");
      expect(stream.backfillStatus).toBe("complete");
      // 'complete' is a NON-idle status, so nulling the target here would raise
      // 23514 against 0013's backfill CHECK.
      expect(stream.backfillTargetDate).toBe("2026-06-01");
      expect(stream.backfillCursorDate).toBe("2026-06-01");
    });

    it("consumes a cancel request at the chunk boundary without fetching anything", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", {
        syncEnabled: false,
        backfillStatus: "running",
        backfillTargetDate: "2026-06-01",
        backfillCursorDate: "2026-07-20",
        backfillCancelRequested: true,
      });

      const fake = createFakeGoogleHealthClient();
      const result = await runPass(fake, { connectionId, trigger: "scheduled" });
      expect(result.skipped).toBeNull();
      // Nothing was queued, and the fake throws on an unqueued call -- so zero
      // calls is a proof, not an absence of evidence.
      expect(fake.calls).toHaveLength(0);

      const stream = await streamRow(connectionId, "steps");
      expect(stream.backfillStatus).toBe("cancelled");
      expect(stream.backfillTargetDate).toBe("2026-06-01");
      expect(stream.backfillCancelRequested).toBe(false);
      const [run] = await runRows(connectionId);
      expect(run).toMatchObject({ status: "cancelled", kind: "backfill" });
    });

    it("densifies INSERT-ONLY on a backfill, never downgrading an existing real row", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "total-calories", {
        syncEnabled: false,
        firstDataDate: "2026-01-01",
        backfillStatus: "running",
        backfillTargetDate: "2026-07-06",
        backfillCursorDate: "2026-07-20",
      });
      await db.insert(healthDailyMetrics).values({
        connectionId,
        metric: "total-calories",
        localDate: "2026-07-10",
        hasData: true,
        value: "2000",
        contentHash: "seeded-by-a-previous-warm-pass",
      });

      const fake = createFakeGoogleHealthClient();
      // The chunk covers 07-06..07-20 and returns nothing at all.
      fake.queueDailyRollUp("total-calories", { rollupDataPoints: [] });
      await runPass(fake, { connectionId, trigger: "scheduled" });

      const rows = await dailyRows(connectionId);
      const seeded = rows.find((r) => r.localDate === "2026-07-10");
      // A provider that quietly ages out old detail must not let a backfill
      // erase real history.
      expect(seeded).toMatchObject({ hasData: true, value: "2000" });
      expect(rows.filter((r) => !r.hasData).length).toBeGreaterThan(0);
    });

    it("services backfill on EVERY pass even while foreground always has work", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");
      await insertStream(connectionId, "total-calories", {
        syncEnabled: false,
        backfillStatus: "running",
        backfillTargetDate: "2026-01-01",
        backfillCursorDate: "2026-07-20",
      });

      const fake = createFakeGoogleHealthClient();
      const cursors: (string | null)[] = [];

      for (let pass = 0; pass < 3; pass += 1) {
        fake.queueDailyRollUp("steps", {
          rollupDataPoints: [steps("2026-08-20", String(100 + pass))],
        });
        fake.queueDailyRollUp("total-calories", { rollupDataPoints: [] });
        fake.queueDailyRollUp("total-calories", { rollupDataPoints: [] });
        // `manual` so the 5-minute debounce does not suppress the foreground
        // half of later passes and hide the fairness property being asserted.
        await runPass(fake, { connectionId, trigger: "manual" });
        cursors.push((await streamRow(connectionId, "total-calories")).backfillCursorDate);
      }

      // Strictly decreasing: backfill never starved behind foreground work.
      expect(cursors).toEqual(["2026-06-22", "2026-05-25", "2026-04-27"]);
      // ...and foreground still ran FIRST within each pass.
      expect(fake.calls[0]!.dataType).toBe("steps");
    });
  });

  // -------------------------------------------------------------------------
  // Concurrency
  // -------------------------------------------------------------------------

  describe("concurrency", () => {
    it("never has more than ONE request in flight for a connection", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");
      await insertStream(connectionId, "distance");
      await insertStream(connectionId, "total-calories", {
        syncEnabled: false,
        backfillStatus: "running",
        backfillTargetDate: "2026-06-01",
        backfillCursorDate: "2026-07-20",
      });

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      fake.queueDailyRollUp("distance", {
        rollupDataPoints: [distanceBucket("2026-08-20", "10")],
      });
      fake.queueDailyRollUp("total-calories", { rollupDataPoints: [] });
      fake.queueDailyRollUp("total-calories", { rollupDataPoints: [] });

      const tracked = instrument(fake);
      await runPass(tracked.client, { connectionId, trigger: "manual" });

      // Foreground streams AND a backfill slice, all through one limiter.
      expect(tracked.maxInFlight()).toBe(1);
    });

    it("skips a second concurrent pass for the same connection, writing no run row", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      const tracked = instrument(fake);

      const [a, b] = await Promise.all([
        runPass(tracked.client, { connectionId, trigger: "manual" }),
        runPass(tracked.client, { connectionId, trigger: "manual" }),
      ]);

      const skipped = [a, b].filter((r) => r.skipped === "lock_not_acquired");
      expect(skipped).toHaveLength(1);
      // health_sync_runs.metric/range_*_date are NOT NULL and no stream or
      // window was chosen, so a connection-level "skipped" row could only be
      // fabricated. The honest record is no record.
      expect(await runRows(connectionId)).toHaveLength(1);
    });

    it("lets two DIFFERENT connections sync concurrently", async () => {
      const first = await insertConnection({ healthUserId: "user-a" });
      const second = await insertConnection({ healthUserId: "user-b" });
      await insertStream(first, "steps");
      await insertStream(second, "steps");

      const fakeA = createFakeGoogleHealthClient();
      const fakeB = createFakeGoogleHealthClient();
      fakeA.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      fakeB.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "2")] });

      const [a, b] = await Promise.all([
        runPass(fakeA, { connectionId: first, trigger: "manual" }),
        runPass(fakeB, { connectionId: second, trigger: "manual" }),
      ]);

      expect(a.skipped).toBeNull();
      expect(b.skipped).toBeNull();
      expect(await runRows(first)).toHaveLength(1);
      expect(await runRows(second)).toHaveLength(1);
    });
  });

  // -------------------------------------------------------------------------
  // Guards
  // -------------------------------------------------------------------------

  describe("guards", () => {
    it("re-reads the connection inside the lock and refuses a non-active one", async () => {
      const connectionId = await insertConnection({ status: "needs_reauth" });
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      const result = await runPass(fake, { connectionId, trigger: "scheduled" });

      expect(result.skipped).toBe("connection_not_active");
      expect(fake.calls).toHaveLength(0);
      expect(await runRows(connectionId)).toHaveLength(0);
    });

    it("debounces a scheduled re-trigger, but never a manual one", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", {
        lastSuccessfulSyncAt: new Date(NOW.getTime() - 60_000),
        lastFullSyncAt: new Date(NOW.getTime() - 60_000),
      });

      const fake = createFakeGoogleHealthClient();
      const debounced = await runPass(fake, { connectionId, trigger: "scheduled" });
      expect(debounced.streamsAttempted).toBe(0);
      expect(fake.calls).toHaveLength(0);

      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      const manual = await runPass(fake, { connectionId, trigger: "manual" });
      // A "Sync now" button that silently does nothing is worse than a
      // redundant fetch.
      expect(manual.streamsAttempted).toBe(1);
    });

    it("chooses hot over warm while the last full sync is recent", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps", {
        lastFullSyncAt: new Date(NOW.getTime() - 60 * 60 * 1000),
      });

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [] });
      await runPass(fake, { connectionId, trigger: "scheduled" });

      const [run] = await runRows(connectionId);
      expect(run!.kind).toBe("hot");
      expect(run!.rangeStartDate).toBe("2026-08-21");
    });
  });

  // -------------------------------------------------------------------------
  // Security
  // -------------------------------------------------------------------------

  describe("security", () => {
    it("writes NOTHING to health_observations, ever", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");
      await insertStream(connectionId, "sleep");
      await insertStream(connectionId, "weight");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp("steps", { rollupDataPoints: [steps("2026-08-20", "1")] });
      fake.queueList("sleep", page([]));
      fake.queueList("sleep", page([]));
      fake.queueList("weight", page([]));
      await runPass(fake, { connectionId, trigger: "manual" });

      // Raw intraday ingestion is excluded from 6.3 (F5 deferred), and nothing
      // else in Phase 6A writes per-sample rows.
      expect(await observationCount()).toBe(0);
    });

    it("puts no token and no health value in an alert payload or a log line", async () => {
      const connectionId = await insertConnection({
        accessTokenExpiresAt: new Date(NOW.getTime() - 60_000),
      });
      await insertStream(connectionId, "steps");
      await insertAlertDevice();
      const boss = fakeBoss();

      const logs: string[] = [];
      vi.spyOn(console, "log").mockImplementation((...a: unknown[]) => logs.push(a.join(" ")));
      vi.spyOn(console, "warn").mockImplementation((...a: unknown[]) => logs.push(a.join(" ")));
      vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => logs.push(a.join(" ")));

      await runPass(
        createFakeGoogleHealthClient(),
        { connectionId, trigger: "manual" },
        {
          boss: boss.boss,
          refresh: () =>
            Promise.reject(
              new GoogleHealthOAuthError(
                "Token has been expired or revoked.",
                400,
                "invalid_grant",
              ),
            ),
        },
      );

      const payloads = JSON.stringify(boss.sent);
      expect(payloads).not.toContain(ACCESS_TOKEN_PLAINTEXT);
      expect(payloads).not.toContain("synthetic-refresh-token");
      expect(payloads).not.toMatch(/ya29\.|access_token|refresh_token|ciphertext|auth_tag/i);
      // The provider's own prose is never carried anywhere: Google's
      // INVALID_ARGUMENT messages echo the request back verbatim.
      expect(payloads).not.toContain("Token has been expired");

      const joined = logs.join("\n");
      expect(joined).not.toContain(ACCESS_TOKEN_PLAINTEXT);
      expect(joined).not.toContain("synthetic-refresh-token");
    });

    it("stores only sanitized TOKENS in health_sync_runs.error_message", async () => {
      const connectionId = await insertConnection();
      await insertStream(connectionId, "steps");

      const fake = createFakeGoogleHealthClient();
      fake.queueDailyRollUp(
        "steps",
        new GoogleHealthApiError(
          "Unknown name \"startTime\" at 'range': Cannot find field",
          400,
          "INVALID_ARGUMENT",
          [{ reason: "INVALID_ROLLUP_QUERY_DURATION" }],
        ),
      );
      await runPass(fake, { connectionId, trigger: "manual" });

      const [run] = await runRows(connectionId);
      expect(run!.errorMessage).toBe(
        "client_request_defect:INVALID_ROLLUP_QUERY_DURATION INVALID_ARGUMENT INVALID_ROLLUP_QUERY_DURATION",
      );
      // Google's prose is the channel by which a request field -- a filter
      // expression carrying civil timestamps today, a value tomorrow -- would
      // reach a durable column.
      expect(run!.errorMessage).not.toContain("startTime");
      expect(run!.errorMessage).not.toContain("Cannot find field");
    });
  });
});

describe("nothing raw crosses the pg-boss boundary", () => {
  // pg-boss serializes a thrown handler error into pgboss.job.output, a
  // durable table, via serialize-error -- which emits every enumerable own
  // property. A `pg` DatabaseError carries `detail`, and for a CHECK or unique
  // violation that is "Failing row contains (...)": the entire row, health
  // value included.
  it("reduces a Postgres error to a SQLSTATE, dropping detail/where/query", () => {
    const pgErr = Object.assign(new Error("duplicate key value violates unique constraint"), {
      name: "error",
      code: "23505",
      detail: "Failing row contains (abc, steps, 2026-08-20, t, 13337, null).",
      where: "SQL statement",
      internalQuery: "insert into health_daily_metrics ...",
      table: "health_daily_metrics",
      constraint: "health_daily_metrics_connection_metric_local_date_unique",
    });

    const wrapped = new HealthSyncJobError(pgErr);
    const serialized = JSON.stringify(wrapped, Object.getOwnPropertyNames(wrapped));

    expect(wrapped.message).toBe("health sync failed (23505)");
    expect(wrapped.sqlState).toBe("23505");
    for (const leak of [
      "Failing row",
      "13337",
      "internalQuery",
      "duplicate key",
      "SQL statement",
    ]) {
      expect(serialized).not.toContain(leak);
    }
  });

  it("does not echo a non-SQLSTATE-shaped code", () => {
    const wrapped = new HealthSyncJobError(
      Object.assign(new Error("boom"), { name: "WeirdError", code: "ya29.SECRET-LOOKING" }),
    );
    expect(wrapped.message).toBe("health sync failed (WeirdError)");
    expect(wrapped.message).not.toContain("ya29");
    expect(wrapped.sqlState).toBeNull();
  });

  it("handles a non-Error throw without leaking its contents", () => {
    const wrapped = new HealthSyncJobError({ token: "ya29.fake", bpm: 137 });
    expect(wrapped.message).toBe("health sync failed (unknown)");
    expect(wrapped.message).not.toContain("ya29");
    expect(wrapped.message).not.toContain("137");
  });
});
