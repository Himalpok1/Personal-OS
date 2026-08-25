// The Health read surface's collector (Phase 6 Checkpoint 6.4).
//
// Mirrors read-models/today.ts and project-summaries.ts: one effectiveNow per
// build, batched queries rather than per-metric fan-out, honest totals derived
// from the same sets the sections are derived from, and every response parsed
// through its frozen schema before it leaves the module.
//
// Two rules run through everything here and are the reason this is a read
// MODEL rather than the seven tables projected outward.
//
// MISSING IS NOT ZERO. Migration 0013's has_data CHECK makes "genuine recorded
// zero" and "verified absent" structurally distinct in Postgres (ADR-047), and
// that distinction has to survive to the client. So every gap becomes an
// explicit `state`, never a substituted numeric default -- and no aggregate
// here counts a day without a value as a zero in either a numerator or a
// denominator. A week with two recorded days averages those two days.
//
// NOTHING PROVIDER-AUTHORED CROSSES THE BOUNDARY. health_connections.last_sync_error
// holds a string the worker wrote, which has previously carried a Postgres
// `detail` (fixed in 6.3's audit) and could carry a Google phrase. Only its
// timestamp and a boolean are projected. Token, ciphertext, IV, auth-tag and
// OAuth-state columns are simply never selected.
//
// Raw intraday heart rate is excluded structurally, by acquisition mode rather
// than by a name blocklist -- the same test the backfill route already uses --
// so a future reconcile-mode metric is excluded by default rather than by
// somebody remembering to add it.
import { addCalendarDays, localDayWindow } from "@personal-os/core";
import { civilDateRange } from "@personal-os/core/health/civil-time";
import {
  healthConnections,
  healthDailyMetrics,
  healthMetricStreams,
  healthSessions,
  healthSyncRuns,
  type Db,
} from "@personal-os/db";
import { HEALTH_METRIC_CATALOG, PHASE_6A_SCOPES } from "@personal-os/health-providers";
import {
  HealthMetricSeriesResponseSchema,
  HealthSleepListResponseSchema,
  HealthSummaryResponseSchema,
  HealthWorkoutListResponseSchema,
  type HealthMetricCapability,
  type HealthMetricPoint,
  type HealthMetricSeriesResponse,
  type HealthMetricTile,
  type HealthSeriesQuery,
  type HealthSessionRangeQuery,
  type HealthSleepListResponse,
  type HealthSleepSession,
  type HealthSourceIdentity,
  type HealthSummaryResponse,
  type HealthWorkoutListResponse,
  type HealthWorkoutSession,
} from "@personal-os/schema";
import { and, asc, desc, eq, gt, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { isHealthConfigured } from "../services/health-connection.js";

/**
 * How recently a run must have started to still count as running.
 *
 * Matched to the connection queue's own 900-second expire_seconds, so a job
 * killed mid-flight stops being reported as in-progress at exactly the moment
 * pg-boss stops treating it as active. Any longer and a crashed worker pins a
 * spinner on the dashboard indefinitely; any shorter and a legitimately slow
 * backfill chunk reads as finished while it is still writing.
 */
export const HEALTH_SYNC_RUN_STALE_MINUTES = 15;

/**
 * Days behind before the dashboard calls itself stale.
 *
 * Two, not one: the sync window is widened a full calendar day at each end
 * (ADR-048) and the current civil day is deliberately never densified, so a
 * perfectly healthy connection routinely sits one day behind.
 */
export const HEALTH_STALENESS_THRESHOLD_DAYS = 2;

const SLEEP_AVERAGE_WINDOW_DAYS = 7;

/**
 * Every metric this surface may read.
 *
 * Excluded by acquisition MODE rather than by name: `sample_reconcile` is the
 * raw intraday path, which stays disabled under the 6.2P F5 deferral and whose
 * table is empty by design. Testing the mode -- the same test the backfill
 * route uses -- means a future reconcile metric is excluded automatically,
 * instead of depending on somebody remembering to extend a blocklist.
 */
export const READABLE_METRICS: readonly string[] = Object.values(HEALTH_METRIC_CATALOG)
  .filter((def) => def.mode !== "sample_reconcile")
  .map((def) => def.metric);

/** The readable metrics that have one value per civil day, i.e. not sessions. */
export const DAILY_METRICS: readonly string[] = Object.values(HEALTH_METRIC_CATALOG)
  .filter((def) => def.mode !== "sample_reconcile" && def.mode !== "session_list")
  .map((def) => def.metric);

// Catalog declaration order is the display order everywhere: activity, heart
// rate, precomputed vitals, body. Sorting alphabetically instead would put
// body-fat above steps, which is nobody's idea of a dashboard.
const METRIC_ORDER = new Map(READABLE_METRICS.map((metric, index) => [metric, index]));

/** Thrown for an unknown metric, a session metric, or the intraday stream. */
export class HealthMetricNotReadableError extends Error {
  constructor(readonly metric: string) {
    super("metric is not readable through the health dashboard surface");
    this.name = "HealthMetricNotReadableError";
  }
}

type ConnectionRow = typeof healthConnections.$inferSelect;
type StreamRow = typeof healthMetricStreams.$inferSelect;
type DailyRow = typeof healthDailyMetrics.$inferSelect;
type SessionRow = typeof healthSessions.$inferSelect;

// ---------------------------------------------------------------------------
// Connection selection
// ---------------------------------------------------------------------------

/**
 * Picks the one connection the dashboard reads from.
 *
 * The schema permits several rows -- a disconnect NULLs the credentials and
 * keeps the row as history rather than deleting it -- so "the" connection has
 * to be chosen rather than assumed. Active first, then most recently touched:
 * a reconnect writes a fresh active row, and an old disconnected row must never
 * outrank it. The dashboard is deliberately single-connection; showing two
 * accounts' step counts side by side is a product question nobody has asked.
 */
async function selectConnection(db: Db): Promise<ConnectionRow | null> {
  const [row] = await db
    .select()
    .from(healthConnections)
    .orderBy(
      sql`case when ${healthConnections.status} = 'active' then 0 else 1 end`,
      desc(healthConnections.updatedAt),
    )
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------------
// Points and capabilities
// ---------------------------------------------------------------------------

/**
 * The three-state reading of one stored row, or of its absence.
 *
 * The `has_data = true` with a null `value` case is legal under 0013's CHECK
 * (a row carrying only a breakdown satisfies it) and is not something the 6.3
 * sync engine currently writes. It is reported as `unknown` rather than
 * reduced from the breakdown: picking a component out of an untyped jsonb blob
 * and calling it the day's value would be manufacturing a number the provider
 * never gave us, which is exactly what the has_data invariant exists to stop.
 */
function pointFor(localDate: string, row: DailyRow | undefined): HealthMetricPoint {
  if (!row) return { local_date: localDate, state: "unknown", value: null, source_count: null };
  if (!row.hasData) {
    return { local_date: localDate, state: "verified_absent", value: null, source_count: null };
  }
  if (row.value === null) {
    return { local_date: localDate, state: "unknown", value: null, source_count: null };
  }
  return {
    local_date: localDate,
    state: "value",
    value: row.value,
    source_count: row.sourceCount,
  };
}

/**
 * A capability record for one metric, whether or not a stream row exists.
 *
 * A missing stream row is a real state -- partial consent never seeds one for
 * an ungranted scope -- so it maps to "not syncing, nothing verified" rather
 * than being omitted. Unit and aggregation come from the catalog, which is the
 * single source of truth for capability metadata; duplicating them into
 * columns would create the second source of truth AGENTS.md forbids.
 */
function capabilityFor(metric: string, stream: StreamRow | undefined): HealthMetricCapability {
  const def = HEALTH_METRIC_CATALOG[metric]!;
  return {
    metric,
    unit: def.unit,
    aggregation: def.dailyAggregation,
    sync_enabled: stream?.syncEnabled ?? false,
    capability_status: (stream?.capabilityStatus ??
      null) as HealthMetricCapability["capability_status"],
    capability_checked_at: stream?.capabilityCheckedAt?.toISOString() ?? null,
    verified_through_date: stream?.verifiedThroughDate ?? null,
    earliest_verified_date: stream?.earliestVerifiedDate ?? null,
    first_data_date: stream?.firstDataDate ?? null,
    last_successful_sync_at: stream?.lastSuccessfulSyncAt?.toISOString() ?? null,
    backfill_status: (stream?.backfillStatus ??
      "idle") as HealthMetricCapability["backfill_status"],
  };
}

function tileFor(metric: string, point: HealthMetricPoint): HealthMetricTile {
  const def = HEALTH_METRIC_CATALOG[metric]!;
  return { metric, unit: def.unit, aggregation: def.dailyAggregation, point };
}

// ---------------------------------------------------------------------------
// Session detail
// ---------------------------------------------------------------------------

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Reads the stored `detail` jsonb.
 *
 * The column is jsonb and therefore untyped at the database boundary: nothing
 * enforces that what the 6.3 sync engine wrote is what comes back, and a row
 * written by an older or newer engine has to be survivable. So every field is
 * probed rather than asserted, a wrong shape degrades to null, and nothing here
 * can throw -- one malformed row must not take down the whole dashboard. The
 * shape it expects is SessionDetail in
 * packages/health-providers/src/sync/translate.ts.
 */
function sourceFromDetail(detail: unknown): HealthSourceIdentity {
  const source = isRecord(detail) && isRecord(detail["source"]) ? detail["source"] : null;
  return {
    recording_method: source ? optionalString(source["recordingMethod"]) : null,
    device_form_factor: source ? optionalString(source["deviceFormFactor"]) : null,
    application_platform: source ? optionalString(source["applicationPlatform"]) : null,
  };
}

function sessionTypeFromDetail(detail: unknown): { type: string | null; subtype: string | null } {
  if (!isRecord(detail)) return { type: null, subtype: null };
  return {
    type: optionalString(detail["sessionType"]),
    subtype: optionalString(detail["sessionSubtype"]),
  };
}

/**
 * Sleep stage detail, asleep/awake splits, workout distance, calories and
 * heart-rate zones are ALWAYS null.
 *
 * The 6.3 sync engine stores an allowlisted SessionDetail of
 * {source, sessionType, sessionSubtype} and nothing else (see SessionDetail in
 * packages/health-providers/src/sync/translate.ts), so there is no stage
 * breakdown in the database to project. Capturing one would mean changing the
 * sync engine and re-fetching from Google, which 6.4 is not authorised to do.
 * They are emitted as explicit nulls rather than omitted so a client renders an
 * honest "not available" from the contract instead of hardcoding the gap.
 */
function toSleepSession(row: SessionRow): HealthSleepSession {
  const { type, subtype } = sessionTypeFromDetail(row.detail);
  return {
    id: row.id,
    // ADR-049: a sleep session is attributed to, filtered on, and swept on its
    // civil END date, so attributed_local_date IS the wake date here.
    wake_local_date: row.attributedLocalDate,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
    start_utc_offset_seconds: row.startUtcOffsetSeconds,
    end_utc_offset_seconds: row.endUtcOffsetSeconds,
    duration_seconds: row.durationSeconds,
    session_type: type,
    session_subtype: subtype,
    source: sourceFromDetail(row.detail),
    stages: null,
    asleep_seconds: null,
    awake_seconds: null,
  };
}

function toWorkoutSession(row: SessionRow): HealthWorkoutSession {
  const { type, subtype } = sessionTypeFromDetail(row.detail);
  return {
    id: row.id,
    // ADR-049: exercise is attributed to its civil START date.
    start_local_date: row.attributedLocalDate,
    start_at: row.startAt.toISOString(),
    end_at: row.endAt.toISOString(),
    start_utc_offset_seconds: row.startUtcOffsetSeconds,
    end_utc_offset_seconds: row.endUtcOffsetSeconds,
    duration_seconds: row.durationSeconds,
    session_type: type,
    session_subtype: subtype,
    source: sourceFromDetail(row.detail),
    distance_meters: null,
    calories_kcal: null,
    heart_rate_zones: null,
  };
}

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

/** Whole civil days between two YYYY-MM-DD strings, from -> to. */
function civilDaysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

interface FreshnessInputs {
  streams: StreamRow[];
  localDate: string;
  latestRun: { startedAt: Date; status: string } | null;
  syncInProgress: boolean;
}

function buildFreshness(inputs: FreshnessInputs): HealthSummaryResponse["freshness"] {
  const { streams, localDate, latestRun, syncInProgress } = inputs;

  // The MINIMUM across sync-enabled streams, not the maximum: a dashboard is
  // only as fresh as its stalest stream, and reporting the newest would let one
  // cheap daily rollup vouch for seventeen streams that have not moved. A
  // single enabled stream with nothing verified collapses the whole answer to
  // null, which is the honest reading of "we cannot say".
  const enabled = streams.filter((row) => row.syncEnabled);
  let verifiedThroughDate: string | null = null;
  if (enabled.length > 0) {
    const dates = enabled.map((row) => row.verifiedThroughDate);
    verifiedThroughDate = dates.some((d) => d === null)
      ? null
      : dates.reduce<string>((min, d) => (d! < min ? d! : min), dates[0]!);
  }

  // Across ALL streams, including disabled ones: a stream the user turned off
  // yesterday is still evidence of when this connection last talked to Google.
  const successTimes = streams
    .map((row) => row.lastSuccessfulSyncAt)
    .filter((value): value is Date => value !== null);
  const lastSuccessfulSyncAt =
    successTimes.length === 0
      ? null
      : new Date(Math.max(...successTimes.map((value) => value.getTime())));

  const daysBehind =
    verifiedThroughDate === null
      ? null
      : // Clamped at zero because the sync window is widened a calendar day at
        // each end (ADR-048), so a healthy stream can legitimately be verified
        // through a date AFTER the requested timezone's local date. "Behind by
        // minus one day" is not a thing anyone should have to read.
        Math.max(0, civilDaysBetween(verifiedThroughDate, localDate));

  return {
    last_successful_sync_at: lastSuccessfulSyncAt?.toISOString() ?? null,
    last_attempted_sync_at: latestRun?.startedAt.toISOString() ?? null,
    last_attempt_status: (latestRun?.status ??
      null) as HealthSummaryResponse["freshness"]["last_attempt_status"],
    verified_through_date: verifiedThroughDate,
    days_behind: daysBehind,
    is_stale: daysBehind === null || daysBehind > HEALTH_STALENESS_THRESHOLD_DAYS,
    staleness_threshold_days: HEALTH_STALENESS_THRESHOLD_DAYS,
    sync_in_progress: syncInProgress,
  };
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

export interface HealthSummaryParams {
  tz: string;
  /**
   * Internal-only clock seam, deliberately absent from HealthSummaryQuerySchema
   * so no HTTP client can pin or spoof it -- the same arrangement
   * buildTodayResponse uses (ADR-043).
   */
  now?: Date;
}

export async function buildHealthSummary(
  db: Db,
  params: HealthSummaryParams,
): Promise<HealthSummaryResponse> {
  const effectiveNow = params.now ?? new Date();
  const localDate = localDayWindow(params.tz, effectiveNow).localDate;
  const configured = isHealthConfigured();

  const connection = await selectConnection(db);
  if (!connection) {
    return HealthSummaryResponseSchema.parse({
      configured,
      connection: null,
      timezone: params.tz,
      local_date: localDate,
      freshness: buildFreshness({
        streams: [],
        localDate,
        latestRun: null,
        syncInProgress: false,
      }),
      today: [],
      latest: [],
      latest_sleep: null,
      sleep_7d_average_seconds: null,
      latest_workout: null,
      capabilities: [],
    });
  }

  const connectionId = connection.id;
  const runStaleBefore = new Date(effectiveNow.getTime() - HEALTH_SYNC_RUN_STALE_MINUTES * 60_000);
  const sleepWindowStart = addCalendarDays(localDate, -(SLEEP_AVERAGE_WINDOW_DAYS - 1));

  const [streams, todayRows, latestRows, latestSleep, latestWorkout, sleepAgg, latestRun, running] =
    await Promise.all([
      db
        .select()
        .from(healthMetricStreams)
        .where(eq(healthMetricStreams.connectionId, connectionId)),

      // One query for every tile, never one per metric.
      db
        .select()
        .from(healthDailyMetrics)
        .where(
          and(
            eq(healthDailyMetrics.connectionId, connectionId),
            inArray(healthDailyMetrics.metric, [...DAILY_METRICS]),
            eq(healthDailyMetrics.localDate, localDate),
          ),
        ),

      // The newest row that actually HAS a value, per metric, in one pass --
      // this is what lets a screen say "last recorded on the 23rd" instead of
      // letting today's blank read as a real zero. A metric that has never
      // recorded a value produces no row here and is simply absent from
      // `latest`, rather than appearing with a fabricated placeholder.
      db
        .selectDistinctOn([healthDailyMetrics.metric])
        .from(healthDailyMetrics)
        .where(
          and(
            eq(healthDailyMetrics.connectionId, connectionId),
            inArray(healthDailyMetrics.metric, [...DAILY_METRICS]),
            eq(healthDailyMetrics.hasData, true),
            isNotNull(healthDailyMetrics.value),
          ),
        )
        .orderBy(asc(healthDailyMetrics.metric), desc(healthDailyMetrics.localDate)),

      db
        .select()
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.metric, "sleep"),
            isNull(healthSessions.deletedAt),
          ),
        )
        .orderBy(desc(healthSessions.attributedLocalDate), desc(healthSessions.endAt))
        .limit(1),

      db
        .select()
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.metric, "exercise"),
            isNull(healthSessions.deletedAt),
          ),
        )
        .orderBy(desc(healthSessions.attributedLocalDate), desc(healthSessions.startAt))
        .limit(1),

      // Nights, and the total seconds over those nights. A night with no
      // session contributes to NEITHER, so the mean is over the nights that
      // were actually recorded -- treating an unrecorded night as zero hours
      // would drag a real average toward a number the user never slept.
      //
      // DISTINCT on the wake date, not count(*): the unique index on
      // health_sessions is (connection, metric, external_key), so two records
      // can legitimately share one wake date -- a nap, or a night split across
      // two provider records. Counting rows would make this a per-SESSION mean
      // while calling itself a nightly average, and would understate a night
      // the user actually slept in two stretches.
      db
        .select({
          nights: sql<number>`count(distinct ${healthSessions.attributedLocalDate})`.mapWith(
            Number,
          ),
          totalSeconds: sql<string | null>`sum(${healthSessions.durationSeconds})`,
        })
        .from(healthSessions)
        .where(
          and(
            eq(healthSessions.connectionId, connectionId),
            eq(healthSessions.metric, "sleep"),
            isNull(healthSessions.deletedAt),
            gte(healthSessions.attributedLocalDate, sleepWindowStart),
            lte(healthSessions.attributedLocalDate, localDate),
          ),
        ),

      db
        .select({ startedAt: healthSyncRuns.startedAt, status: healthSyncRuns.status })
        .from(healthSyncRuns)
        .where(eq(healthSyncRuns.connectionId, connectionId))
        .orderBy(desc(healthSyncRuns.startedAt))
        .limit(1),

      // Durable evidence of an in-flight sync, read from a run row the worker
      // wrote -- never an optimistic "I just pressed sync" claim from a client.
      db
        .select({ id: healthSyncRuns.id })
        .from(healthSyncRuns)
        .where(
          and(
            eq(healthSyncRuns.connectionId, connectionId),
            isNull(healthSyncRuns.finishedAt),
            gt(healthSyncRuns.startedAt, runStaleBefore),
          ),
        )
        .limit(1),
    ]);

  const streamByMetric = new Map(streams.map((row) => [row.metric, row]));
  const todayByMetric = new Map(todayRows.map((row) => [row.metric, row]));

  const granted = (connection.grantedScope ?? "").split(/\s+/).filter(Boolean);
  const grantedSet = new Set(granted);
  const missingScopes = PHASE_6A_SCOPES.filter((scope) => !grantedSet.has(scope));

  const nights = sleepAgg[0]?.nights ?? 0;
  const totalSleepSeconds = sleepAgg[0]?.totalSeconds ?? null;

  return HealthSummaryResponseSchema.parse({
    configured,
    connection: {
      id: connection.id,
      provider: connection.provider,
      status: connection.status,
      identity_verified_at: connection.identityVerifiedAt?.toISOString() ?? null,
      granted_scopes: granted,
      missing_scopes: missingScopes,
      has_partial_scope: missingScopes.length > 0,
      needs_reconnect: connection.status === "needs_reauth" || connection.status === "revoked",
      // The boolean and the timestamp cross the boundary; the message never
      // does. That is a property of this projection, not a rule a screen has
      // to remember (ADR-043's structural-exclusion reasoning).
      has_sync_error: connection.lastSyncError !== null,
      last_sync_error_at: connection.lastSyncErrorAt?.toISOString() ?? null,
    },
    timezone: params.tz,
    local_date: localDate,
    freshness: buildFreshness({
      streams,
      localDate,
      latestRun: latestRun[0] ?? null,
      syncInProgress: running.length > 0,
    }),
    // ALWAYS every daily metric, including the ones with nothing stored. A
    // metric quietly vanishing from the array is precisely the kind of absence
    // a reader interprets as zero.
    today: DAILY_METRICS.map((metric) =>
      tileFor(metric, pointFor(localDate, todayByMetric.get(metric))),
    ),
    latest: latestRows
      .slice()
      .sort((a, b) => (METRIC_ORDER.get(a.metric) ?? 0) - (METRIC_ORDER.get(b.metric) ?? 0))
      .map((row) => tileFor(row.metric, pointFor(row.localDate, row))),
    latest_sleep: latestSleep[0] ? toSleepSession(latestSleep[0]) : null,
    sleep_7d_average_seconds:
      nights === 0 || totalSleepSeconds === null
        ? null
        : Math.round(Number(totalSleepSeconds) / nights),
    latest_workout: latestWorkout[0] ? toWorkoutSession(latestWorkout[0]) : null,
    capabilities: READABLE_METRICS.map((metric) =>
      capabilityFor(metric, streamByMetric.get(metric)),
    ),
  });
}

// ---------------------------------------------------------------------------
// Series
// ---------------------------------------------------------------------------

/**
 * Formats an aggregate for the wire.
 *
 * The stored values are Postgres `numeric` and therefore exact, but a sum or a
 * mean of them here goes through IEEE-754 doubles and can pick up
 * representation error in the far decimals. Rounding bounds that visibly, and
 * the exact per-day values are always present in `points` for anyone who needs
 * them. min/max deliberately skip this path entirely -- they are the original
 * strings of real days, never arithmetic.
 */
function formatAggregate(value: number, decimals: number): string {
  const factor = 10 ** decimals;
  return String(Math.round(value * factor) / factor);
}

export async function buildHealthSeries(
  db: Db,
  query: HealthSeriesQuery,
): Promise<HealthMetricSeriesResponse> {
  if (!DAILY_METRICS.includes(query.metric)) {
    // One rejection covers three cases -- an unknown metric, a session metric
    // (which has its own routes), and the intraday stream -- because all three
    // are equally not a daily series and the caller's remedy is the same.
    throw new HealthMetricNotReadableError(query.metric);
  }
  const def = HEALTH_METRIC_CATALOG[query.metric]!;

  // `to` is INCLUSIVE on this surface while civilDateRange is half-open, so the
  // end is advanced one day. Getting this wrong silently drops the day the user
  // most likely cares about, which is the last one.
  const dates = civilDateRange(query.from, addCalendarDays(query.to, 1));

  const connection = await selectConnection(db);
  const [rows, streams] = connection
    ? await Promise.all([
        db
          .select()
          .from(healthDailyMetrics)
          .where(
            and(
              eq(healthDailyMetrics.connectionId, connection.id),
              eq(healthDailyMetrics.metric, query.metric),
              gte(healthDailyMetrics.localDate, query.from),
              lte(healthDailyMetrics.localDate, query.to),
            ),
          ),
        db
          .select()
          .from(healthMetricStreams)
          .where(
            and(
              eq(healthMetricStreams.connectionId, connection.id),
              eq(healthMetricStreams.metric, query.metric),
            ),
          ),
      ])
    : [[] as DailyRow[], [] as StreamRow[]];

  const byDate = new Map(rows.map((row) => [row.localDate, row]));

  // Counted over the FULL inclusive range regardless of include_empty: the
  // filter changes what is rendered, never what is true. A client that hides
  // empty days must still be able to say how many there were.
  let daysWithValue = 0;
  let daysVerifiedAbsent = 0;
  let daysUnknown = 0;
  let minValue: string | null = null;
  let maxValue: string | null = null;
  let total = 0;

  const points: HealthMetricPoint[] = [];
  for (const localDate of dates) {
    const point = pointFor(localDate, byDate.get(localDate));
    if (point.state === "value") {
      daysWithValue += 1;
      const numeric = Number(point.value);
      total += numeric;
      if (minValue === null || numeric < Number(minValue)) minValue = point.value;
      if (maxValue === null || numeric > Number(maxValue)) maxValue = point.value;
    } else if (point.state === "verified_absent") {
      daysVerifiedAbsent += 1;
    } else {
      daysUnknown += 1;
    }
    if (query.include_empty || point.state === "value") points.push(point);
  }

  return HealthMetricSeriesResponseSchema.parse({
    metric: query.metric,
    unit: def.unit,
    aggregation: def.dailyAggregation,
    from: query.from,
    to: query.to,
    capability: capabilityFor(query.metric, streams[0]),
    points,
    summary: {
      days_in_range: dates.length,
      days_with_value: daysWithValue,
      days_verified_absent: daysVerifiedAbsent,
      days_unknown: daysUnknown,
      min: minValue,
      max: maxValue,
      // Both are over the days that HAVE a value. A day with no recorded value
      // is not a day with a value of zero, so it enters neither the sum nor the
      // divisor; a range with no values at all aggregates to nothing.
      average: daysWithValue === 0 ? null : formatAggregate(total / daysWithValue, 2),
      total: daysWithValue === 0 ? null : formatAggregate(total, 3),
    },
  });
}

// ---------------------------------------------------------------------------
// Session lists
// ---------------------------------------------------------------------------

async function listSessions<T>(
  db: Db,
  metric: string,
  query: HealthSessionRangeQuery,
  secondaryOrder: typeof healthSessions.endAt | typeof healthSessions.startAt,
  map: (row: SessionRow) => T,
): Promise<{ items: T[]; limit: number; offset: number; total: number }> {
  const connection = await selectConnection(db);
  if (!connection) return { items: [], limit: query.limit, offset: query.offset, total: 0 };

  // A tombstoned session is a provider-side deletion the sweep reconciled
  // (ADR-047a). The row is retained indefinitely as history, but it is no
  // longer something the provider claims happened, so it is not shown and is
  // not counted.
  const where = and(
    eq(healthSessions.connectionId, connection.id),
    eq(healthSessions.metric, metric),
    isNull(healthSessions.deletedAt),
    gte(healthSessions.attributedLocalDate, query.from),
    lte(healthSessions.attributedLocalDate, query.to),
  );

  const [rows, counted] = await Promise.all([
    db
      .select()
      .from(healthSessions)
      .where(where)
      .orderBy(desc(healthSessions.attributedLocalDate), desc(secondaryOrder))
      .limit(query.limit)
      .offset(query.offset),
    // The true count for the whole range, not the page -- an honest total is
    // what lets a client page at all.
    db
      .select({ total: sql<number>`count(*)`.mapWith(Number) })
      .from(healthSessions)
      .where(where),
  ]);

  return {
    items: rows.map(map),
    limit: query.limit,
    offset: query.offset,
    total: counted[0]?.total ?? 0,
  };
}

export async function listSleepSessions(
  db: Db,
  query: HealthSessionRangeQuery,
): Promise<HealthSleepListResponse> {
  // Ranged on attributed_local_date, which for sleep IS the wake date: a night
  // that begins on the 3rd and ends on the 4th belongs to the 4th, because
  // "how did I sleep last night?" is asked the morning after (ADR-049).
  return HealthSleepListResponseSchema.parse(
    await listSessions(db, "sleep", query, healthSessions.endAt, toSleepSession),
  );
}

export async function listWorkoutSessions(
  db: Db,
  query: HealthSessionRangeQuery,
): Promise<HealthWorkoutListResponse> {
  return HealthWorkoutListResponseSchema.parse(
    await listSessions(db, "exercise", query, healthSessions.startAt, toWorkoutSession),
  );
}
