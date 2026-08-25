import { civilDateRange } from "@personal-os/core/health/civil-time";
import {
  advanceBackfillCursor,
  completeBackfill,
  type BackfillProgressColumns,
  settleBackfill,
  type BackfillColumns,
  type BackfillState,
} from "@personal-os/core/health/backfill";
import {
  chunkRange,
  densifiableRange,
  hotWindow,
  lastGloballyCompleteDateExclusive,
  warmWindow,
  type CivilWindow,
} from "@personal-os/core/health/windows";
import { devices, healthConnections, healthMetricStreams, type Db } from "@personal-os/db";
import {
  assessDailyCompleteness,
  assessPagedCompleteness,
  buildRollupRange,
  buildWindowFilter,
  classifyCapability,
  collapseSamplesToDays,
  createHealthLimiter,
  datesOutsideWindow,
  DATA_SOURCE_FAMILY_ALL,
  GoogleHealthApiError,
  HEALTH_METRIC_CATALOG,
  HEALTH_METRICS,
  HealthPassBudgetExhaustedError,
  MAX_PAGES_LARGE,
  MAX_PAGES_SESSIONS,
  getValueSpec,
  sanitizeApiError,
  translateDailyListRecord,
  translateRollupBucket,
  translateSampleRecord,
  translateSession,
  type Completeness,
  type DailyMetricRow,
  type GoogleHealthClient,
  type HealthLimiter,
  type HealthMetricDefinition,
  type SampleRow,
  type SessionRow,
} from "@personal-os/health-providers";
import { HealthCapabilityStatusSchema } from "@personal-os/schema";
import { and, eq, isNull } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { evaluateStreamBreaker } from "./breaker.js";
import { withConnectionLock } from "./lock.js";
import {
  densifyDates,
  tombstoneMissingSessions,
  upsertDailyMetrics,
  upsertSessions,
  type UpsertCounts,
} from "./persist.js";
import { closeSyncRun, faultTokens, openSyncRun, type HealthSyncRunKind } from "./run.js";
import {
  createRefreshBudget,
  HealthAuthPermanentError,
  HealthNotConfiguredError,
  HealthRefreshBudgetExhaustedError,
  resolveFreshHealthAccessToken,
  type HealthConnectionRow,
  type RefreshBudget,
  type RefreshFn,
} from "./token.js";
import { env } from "../env.js";

// The Google Health sync pass: one connection, all of its enabled streams,
// foreground first and then a bounded slice of backfill.
//
// ===========================================================================
// THE AUTHORITY MODEL, WHICH IS THE CORRECTNESS CORE OF THIS FILE
// ===========================================================================
//
//   fetchComplete = pagination ended naturally && no page cap && no fault
//   authoritative = fetchComplete && rejections === 0 && kind !== "hot"
//
// The distinction exists because the Google Health API OMITS civil days with no
// recorded data and offers no tombstones of any kind (ADR-046). Absence is
// therefore not a fact we are told; it is a fact we INFER, and an inference is
// only sound over a window we can prove we fetched completely.
//
// Three operations write ABSENCE and are gated on `authoritative`:
//
//   * densification -- writing has_data=false for a verified-absent day;
//   * session tombstoning -- soft-deleting sessions the provider stopped
//     returning;
//   * advancing verified_through_date / earliest_verified_date, which is the
//     durable claim "this range has been checked".
//
// Real observed rows are NOT gated that way and are persisted on every pass,
// including `hot`. That is deliberate and is the whole point of the hot
// cadence: the hourly pass exists to keep today's steps current between
// nightly warm passes, and a hot pass that wrote nothing would make the fast
// cadence dead code. Writing a real observation can never destroy information;
// writing an absence can, which is why exactly the absence-writing paths carry
// the gate.

/** How stale a stream's last full pass may be before a warm pass is due. */
const WARM_DUE_MS = 20 * 60 * 60 * 1000;

/**
 * Suppression window for repeat scheduled/app-open triggers.
 *
 * The API enqueues on app open as well as on the hourly cron, so a user
 * flipping back to the app five times in a minute would otherwise fan out five
 * full passes over eighteen streams. `manual` is exempt: pressing "Sync now"
 * must always do something visible, and a button that silently does nothing is
 * worse than a redundant fetch.
 */
const DEBOUNCE_MS = 5 * 60 * 1000;

/**
 * Backfill chunks serviced per pass, across all running streams.
 *
 * Small AND unconditional, which is the fairness guarantee: foreground runs
 * first (it is what the user is looking at), but backfill is never skipped
 * because foreground had work, so a backfill cannot starve behind a
 * perpetually-busy foreground. Two chunks an hour walks 28-180 days of history
 * per stream per day, which finishes a year in well under a fortnight without
 * ever monopolising the pass budget.
 */
const BACKFILL_CHUNKS_PER_PASS = 2;

/**
 * Master switch for session tombstoning.
 *
 * A module constant rather than a column or an env var: it is a design
 * decision, not configuration, and if the deletion-detection heuristic ever
 * proves unsafe against real data the fix must be one line in review, not a
 * production toggle someone can flip without one.
 */
const SESSION_TOMBSTONING_ENABLED = true;

export interface HealthSyncConnectionJobData {
  connectionId: string;
  trigger: "scheduled" | "manual";
  requestedKind?: "hot" | "warm";
}

export interface HealthSyncDeps {
  db: Db;
  client: GoogleHealthClient;
  /** Optional so tests need not stand up pg-boss. Alerts are best-effort. */
  boss?: PgBoss | null;
  /** One limiter per pass. Injected in tests to drive a virtual clock. */
  limiterFactory?: () => HealthLimiter;
  now?: () => Date;
  /** Injected in tests; defaults to the real Google token endpoint. */
  refresh?: RefreshFn;
}

export type HealthPassSkipReason =
  | "lock_not_acquired"
  | "connection_not_found"
  | "connection_not_active"
  | "not_configured"
  | "no_enabled_streams";

export interface HealthPassResult {
  skipped: HealthPassSkipReason | null;
  streamsAttempted: number;
  runsWritten: number;
  backfillChunks: number;
  /** Streams whose chunks all failed. Drives the "everything failed" alert. */
  streamsFailed: number;
}

type StreamRow = typeof healthMetricStreams.$inferSelect;

/**
 * Whether a stream may be synced at all.
 *
 * STRUCTURAL, not a name blocklist. `heart-rate-intraday` is excluded because
 * it is the only `sample_reconcile` metric, and Checkpoint 6.3 excludes raw
 * intraday ingestion entirely: F5 (reconcile identity stability across calls
 * separated by time) is deferred acceptance debt, so its external keys cannot
 * be trusted to be stable and nothing here may write health_observations.
 *
 * Testing the MODE rather than the metric name means a second reconcile-mode
 * metric added later is excluded automatically, instead of quietly inheriting
 * an identity strategy nobody proved.
 */
export function isSyncableMetric(metric: string): boolean {
  const def = HEALTH_METRIC_CATALOG[metric];
  return def !== undefined && def.mode !== "sample_reconcile";
}

/** The syncable metric set, in catalog order. 18 of the catalog's 19. */
export const SYNCABLE_METRICS: readonly string[] = HEALTH_METRICS.filter(isSyncableMetric);

// ---------------------------------------------------------------------------
// Pass context
// ---------------------------------------------------------------------------

interface PassContext {
  db: Db;
  client: GoogleHealthClient;
  boss: PgBoss | null;
  limiter: HealthLimiter;
  budget: RefreshBudget;
  connection: HealthConnectionRow;
  now: Date;
  refresh: RefreshFn | undefined;
  /** Resolved once per pass, reused by every stream. */
  accessToken: string | null;
  /** Dedupes alerts within one pass. */
  alertedReasons: Set<string>;
  runsWritten: number;
}

async function passToken(ctx: PassContext, force = false): Promise<string> {
  if (!force && ctx.accessToken !== null) return ctx.accessToken;
  const token = await resolveFreshHealthAccessToken(ctx.db, ctx.connection, ctx.budget, ctx.now, {
    force,
    refresh: ctx.refresh,
  });
  ctx.accessToken = token;
  return token;
}

/**
 * Issues one Google Health request through the pass limiter, with at most ONE
 * refresh-and-retry on a 401 for the WHOLE pass.
 *
 * The limiter classifies 401 as fatal and does not retry it -- correctly, since
 * retrying the same dead token cannot help -- so the refresh-and-retry has to
 * live above it. The budget lives on the pass rather than on the request
 * because eighteen streams sharing one expired grant would otherwise mean
 * eighteen refreshes.
 */
async function callWithAuth<T>(
  ctx: PassContext,
  fn: (accessToken: string, signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const token = await passToken(ctx);
  try {
    return await ctx.limiter.run((signal) => fn(token, signal));
  } catch (err) {
    if (!(err instanceof GoogleHealthApiError) || err.httpStatus !== 401) throw err;
    // Throws HealthRefreshBudgetExhaustedError if this pass already refreshed,
    // which the caller turns into `auth_unresolved` and rethrows -- a second
    // 401 after a successful refresh is not something more requests will fix.
    const fresh = await passToken(ctx, true);
    return await ctx.limiter.run((signal) => fn(fresh, signal));
  }
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

interface FetchOutcome {
  records: Record<string, unknown>[];
  pagesFetched: number;
  nextPageToken: string | null;
  pagingSupported: boolean;
  maxPages: number;
}

async function fetchChunk(
  ctx: PassContext,
  def: HealthMetricDefinition,
  window: CivilWindow,
): Promise<FetchOutcome> {
  const family = def.supportsDataSourceFamily ? DATA_SOURCE_FAMILY_ALL : undefined;

  if (def.mode === "daily_rollup") {
    const response = await callWithAuth(ctx, (accessToken, signal) =>
      ctx.client.dailyRollUp({
        accessToken,
        dataType: def.googleDataType,
        // buildRollupRange, never a hand-built object: the request range is a
        // CivilTimeInterval with bare `start`/`end`, and `startTime` -- the
        // spelling used by the interval carried ON a record -- is a live-proven
        // HTTP 400 on every rollup call. pageSize is unrepresentable by design.
        range: buildRollupRange(window),
        ...(family !== undefined ? { dataSourceFamily: family } : {}),
        signal,
      }),
    );
    return {
      records: response.rollupDataPoints as unknown as Record<string, unknown>[],
      pagesFetched: 1,
      nextPageToken: response.nextPageToken ?? null,
      // dailyRollUp cannot follow a page token (sending pageSize is a 400), so
      // a token appearing at all is truncation we must REPORT, not paginate.
      pagingSupported: false,
      maxPages: 1,
    };
  }

  const maxPages = def.mode === "session_list" ? MAX_PAGES_SESSIONS : MAX_PAGES_LARGE;
  const filter = buildWindowFilter(def, window);
  const records: Record<string, unknown>[] = [];
  let pageToken: string | undefined;
  let pagesFetched = 0;
  let nextPageToken: string | null;

  for (;;) {
    const page: { dataPoints: unknown[]; nextPageToken?: string } = await callWithAuth(
      ctx,
      (accessToken, signal) =>
        ctx.client.list({
          accessToken,
          dataType: def.googleDataType,
          filter,
          pageSize: def.pageSize,
          ...(pageToken !== undefined ? { pageToken } : {}),
          signal,
        }),
    );
    pagesFetched += 1;
    records.push(...(page.dataPoints as Record<string, unknown>[]));
    nextPageToken = page.nextPageToken ?? null;
    if (nextPageToken === null || pagesFetched >= maxPages) break;
    pageToken = nextPageToken;
  }

  return { records, pagesFetched, nextPageToken, pagingSupported: true, maxPages };
}

// ---------------------------------------------------------------------------
// Translation
// ---------------------------------------------------------------------------

interface TranslatedChunk {
  dailyRows: DailyMetricRow[];
  sessionRows: SessionRow[];
  observedDates: Set<string>;
  rejections: number;
  collapsed: number;
}

function translateChunk(
  def: HealthMetricDefinition,
  records: readonly Record<string, unknown>[],
): TranslatedChunk {
  const out: TranslatedChunk = {
    dailyRows: [],
    sessionRows: [],
    observedDates: new Set<string>(),
    rejections: 0,
    collapsed: 0,
  };

  if (def.mode === "session_list") {
    for (const record of records) {
      const translated = translateSession(record, def);
      if (!translated.ok) {
        out.rejections += 1;
        continue;
      }
      out.sessionRows.push(translated.row);
    }
    return out;
  }

  const spec = getValueSpec(def.metric);

  if (def.mode === "sample_list") {
    const samples: SampleRow[] = [];
    for (const record of records) {
      const translated = translateSampleRecord(record, def, spec);
      if (!translated.ok) {
        out.rejections += 1;
        continue;
      }
      samples.push(translated.row);
    }
    const collapse = collapseSamplesToDays(samples, def);
    out.collapsed = collapse.collapsed;
    out.dailyRows = [...collapse.rows];
  } else {
    for (const record of records) {
      const translated =
        def.mode === "daily_rollup"
          ? translateRollupBucket(record, def, spec)
          : translateDailyListRecord(record, def, spec);
      if (!translated.ok) {
        out.rejections += 1;
        continue;
      }
      out.dailyRows.push(translated.row);
    }
  }

  for (const row of out.dailyRows) out.observedDates.add(row.localDate);
  return out;
}

// ---------------------------------------------------------------------------
// One chunk = one transaction = one run row
// ---------------------------------------------------------------------------

export type ChunkOutcome =
  /** Committed. `authoritative` decides whether absence was written. */
  | { kind: "ok"; authoritative: boolean }
  /** Recorded as a failed run; the pass continues with the next stream. */
  | { kind: "failed"; failureClass: string }
  /** The grant is dead. Stop the pass; do NOT throw. */
  | { kind: "auth_permanent" }
  /** Out of wall clock. Stop the pass; do NOT throw. */
  | { kind: "budget_exhausted" };

interface ChunkParams {
  stream: StreamRow;
  def: HealthMetricDefinition;
  kind: HealthSyncRunKind;
  window: CivilWindow;
  /** Extra work committed atomically with this chunk's rows (backfill cursor). */
  extraTxWork?: ((tx: Db) => Promise<void>) | undefined;
}

function addCounts(a: UpsertCounts, b: UpsertCounts): UpsertCounts {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
    collapsed: a.collapsed + b.collapsed,
  };
}

function minDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a < b ? a : b;
}

function maxDate(a: string | null, b: string | null): string | null {
  if (a === null) return b;
  if (b === null) return a;
  return a > b ? a : b;
}

async function syncChunk(ctx: PassContext, params: ChunkParams): Promise<ChunkOutcome> {
  const { stream, def, kind, window } = params;
  const sourceFamily = def.supportsDataSourceFamily ? DATA_SOURCE_FAMILY_ALL : null;

  const runId = await openSyncRun(ctx.db, {
    connectionId: ctx.connection.id,
    streamId: stream.id,
    metric: stream.metric,
    kind,
    rangeStartDate: window.startDate,
    rangeEndDate: window.endDate,
    sourceFamily,
  });
  ctx.runsWritten += 1;

  const requestsBefore = ctx.limiter.stats.requests;

  let fetched: FetchOutcome;
  try {
    fetched = await fetchChunk(ctx, def, window);
  } catch (err) {
    const requestCount = ctx.limiter.stats.requests - requestsBefore;

    if (err instanceof HealthAuthPermanentError) {
      await closeSyncRun(ctx.db, runId, {
        status: "failed",
        failureClass: "auth_permanent",
        httpStatus: 401,
        requestCount,
      });
      return { kind: "auth_permanent" };
    }
    if (err instanceof HealthRefreshBudgetExhaustedError) {
      await closeSyncRun(ctx.db, runId, {
        status: "failed",
        failureClass: "auth_unresolved",
        httpStatus: 401,
        requestCount,
      });
      // THROWN, unlike every other failure. A 401 that survived this pass's
      // refresh is not a per-stream problem: continuing would issue seventeen
      // more doomed requests. The connection is deliberately left `active` --
      // see HealthRefreshBudgetExhaustedError for why this is not needs_reauth.
      throw err;
    }
    if (err instanceof HealthPassBudgetExhaustedError) {
      await closeSyncRun(ctx.db, runId, {
        status: "failed",
        failureClass: "pass_budget_exhausted",
        requestCount,
      });
      return { kind: "budget_exhausted" };
    }
    if (err instanceof HealthNotConfiguredError) {
      await closeSyncRun(ctx.db, runId, {
        status: "skipped",
        failureClass: "not_configured",
        requestCount,
      });
      return { kind: "budget_exhausted" };
    }

    const fault = sanitizeApiError(err);
    const verdict = classifyCapability({
      fault,
      recordCount: 0,
      firstDataDate: stream.firstDataDate,
    });
    const failureClass =
      verdict.capability === "missing_scope"
        ? "scope_denied"
        : (verdict.failureClass ?? "provider_error");

    await closeSyncRun(ctx.db, runId, {
      status: "failed",
      failureClass,
      httpStatus: fault.httpStatus === 0 ? null : fault.httpStatus,
      requestCount,
      errorTokens: faultTokens(fault),
    });

    if (verdict.capability === "missing_scope") {
      // An EVIDENCED scope denial (ACCESS_TOKEN_SCOPE_INSUFFICIENT), never an
      // ambiguous 403. `scope_not_granted` is the exact literal PATCH /streams
      // refuses to re-enable against, so the API and the worker agree on one
      // string rather than two that look alike.
      await ctx.db
        .update(healthMetricStreams)
        .set({
          capabilityStatus: HealthCapabilityStatusSchema.parse("missing_scope"),
          capabilityCheckedAt: ctx.now,
          syncEnabled: false,
          lastSyncError: "scope_not_granted",
          updatedAt: ctx.now,
        })
        .where(eq(healthMetricStreams.id, stream.id));
    } else if (!fault.retryable) {
      // A durable capability note, but NEVER `not_supported`: an ambiguous
      // 400/403/404 is at least as likely to be a defect in our own request as
      // a type Google lacks, which is exactly what 6.2P proved when two of our
      // request-shape bugs were reported as eight unsupported metrics.
      await ctx.db
        .update(healthMetricStreams)
        .set({
          capabilityStatus: HealthCapabilityStatusSchema.parse("provider_error"),
          capabilityCheckedAt: ctx.now,
          lastSyncError: failureClass,
          updatedAt: ctx.now,
        })
        .where(eq(healthMetricStreams.id, stream.id));
    }

    return { kind: "failed", failureClass };
  }

  const requestCount = ctx.limiter.stats.requests - requestsBefore;
  const translated = translateChunk(def, fetched.records);

  // Records dated outside the half-open window we asked for mean our filter and
  // Google's reading of it disagree -- the classic symptom of a wrong literal
  // form. They are DROPPED rather than stored, because writing them would let
  // one chunk overwrite a neighbouring chunk's days, and counted as rejections
  // so the run is non-authoritative and the breaker can see the pattern.
  const strayDates = new Set(datesOutsideWindow(window, translated.observedDates));
  if (strayDates.size > 0) {
    translated.dailyRows = translated.dailyRows.filter((r) => !strayDates.has(r.localDate));
    for (const stray of strayDates) translated.observedDates.delete(stray);
  }
  const rejections = translated.rejections + strayDates.size;

  const isDailyMode = def.mode === "daily_rollup" || def.mode === "daily_list";
  const evidence = {
    pagesFetched: fetched.pagesFetched,
    maxPages: fetched.maxPages,
    nextPageToken: fetched.nextPageToken,
    pagingSupported: fetched.pagingSupported,
  };
  const completeness: Completeness = isDailyMode
    ? assessDailyCompleteness(window, translated.observedDates, evidence)
    : assessPagedCompleteness(evidence);

  const authoritative = completeness.fetchComplete && rejections === 0 && kind !== "hot";

  // Both halves of the effective first-data date, computed BEFORE the
  // transaction so the same value is used for clamping and for persistence.
  // Reading only the stored value would clamp the very chunk that discovered
  // older data than we had ever seen -- which is precisely a backfill chunk.
  const observedMin = [...translated.observedDates].sort()[0] ?? null;
  const effectiveFirstDataDate = minDate(stream.firstDataDate, observedMin);

  let counts: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0, collapsed: 0 };
  let tombstoned = 0;

  await ctx.db.transaction(async (txRaw) => {
    // The same `tx as unknown as Db` shape calendar-sync-calendar.ts uses:
    // Drizzle's transaction type is structurally compatible for every operation
    // these helpers perform, and threading the generic parameter through would
    // buy nothing.
    const tx = txRaw as unknown as Db;

    if (translated.dailyRows.length > 0) {
      counts = addCounts(
        counts,
        await upsertDailyMetrics(tx, {
          connectionId: ctx.connection.id,
          rows: translated.dailyRows,
          sourceFamily,
        }),
      );
    }
    if (translated.sessionRows.length > 0) {
      counts = addCounts(
        counts,
        await upsertSessions(tx, {
          connectionId: ctx.connection.id,
          rows: translated.sessionRows,
        }),
      );
    }
    counts.collapsed += translated.collapsed;

    if (authoritative && def.mode !== "session_list") {
      // ADR-046a: an authoritative window returning ZERO buckets may still
      // densify. The earlier blanket "skip densification when the chunk came
      // back empty" rule was lifted because it made the common case unreachable
      // -- a wearable that is simply not worn for a week returns nothing, and
      // that week is exactly what the user needs marked verified-absent rather
      // than left indistinguishable from never-checked.
      //
      // What replaces it is not trust but the two clamps in densifiableRange:
      // nothing still in flight anywhere on Earth, and nothing before this
      // stream's first-ever data. A transient empty 200 can therefore blank at
      // most days that are already over, inside a window we proved we fetched
      // completely -- and a subsequent pass that sees real data replaces the
      // absence, because the content hash differs.
      const range = densifiableRange(window, effectiveFirstDataDate, ctx.now);
      const missing = civilDateRange(range.startDate, range.endDate).filter(
        (d) => !translated.observedDates.has(d),
      );
      if (missing.length > 0) {
        counts = addCounts(
          counts,
          await densifyDates(tx, {
            connectionId: ctx.connection.id,
            metric: stream.metric,
            dates: missing,
            sourceFamily,
            // Insert-only in TWO cases, and the second is load-bearing.
            //
            // A backfill reaches into history to fill holes, so it may add
            // absence markers but must never erase years of real data if the
            // provider has quietly aged out old detail.
            //
            // A chunk that returned ZERO buckets is the case ADR-046a
            // explicitly bounds: "those writes must be insert-only [and] must
            // never overwrite or downgrade an existing has_data = true row."
            // `authoritative` proves only that WE fetched completely -- never
            // that Google's empty answer was right. One HTTP 200 carrying
            // `rollupDataPoints: []` is indistinguishable from a genuinely
            // empty account, and without this guard a single such response
            // would blank the whole warm window of real history in one
            // transaction.
            //
            // A chunk that DID return buckets keeps overwrite semantics: a day
            // that had steps yesterday and is absent from a complete
            // authoritative fetch today was deleted upstream, and that is the
            // only deletion detection daily metrics have.
            insertOnly: kind === "backfill" || translated.observedDates.size === 0,
          }),
        );
      }
    }

    if (
      SESSION_TOMBSTONING_ENABLED &&
      authoritative &&
      def.mode === "session_list" &&
      (kind === "warm" || kind === "manual")
    ) {
      const seenKeys = translated.sessionRows
        .filter((r) => r.externalKeySource === "data_point_name")
        .map((r) => r.externalKey);
      tombstoned = await tombstoneMissingSessions(tx, {
        connectionId: ctx.connection.id,
        metric: stream.metric,
        // The SAME axis the filter used (ADR-049). Sleep is filtered,
        // attributed and swept on civil END; exercise on civil START.
        // The catalog owns this. The sweep MUST bound on the same column the
        // fetch filtered on, or it tombstones sessions the query could never
        // have returned.
        axis: def.attributionAxis ?? "civil_start",
        windowStartDate: window.startDate,
        windowEndDateExclusive: window.endDate,
        seenKeys,
        now: ctx.now,
      });
    }

    const succeeded = completeness.fetchComplete && rejections === 0;
    const streamSet: Partial<typeof healthMetricStreams.$inferInsert> = { updatedAt: ctx.now };
    if (effectiveFirstDataDate !== stream.firstDataDate) {
      streamSet.firstDataDate = effectiveFirstDataDate;
    }
    if (succeeded) {
      streamSet.lastSuccessfulSyncAt = ctx.now;
      streamSet.lastSyncError = null;
      streamSet.capabilityStatus = HealthCapabilityStatusSchema.parse(
        classifyCapability({
          fault: null,
          recordCount: translated.dailyRows.length + translated.sessionRows.length,
          firstDataDate: effectiveFirstDataDate,
        }).capability,
      );
      streamSet.capabilityCheckedAt = ctx.now;
    }
    if (authoritative) {
      // CLAMPED. trailingWindow deliberately ends at `today + 2` so that no
      // real local day can escape the window whatever the device's offset --
      // which means the exclusive end is routinely a civil date that has not
      // BEGUN in most of the world. Stamping it verified would be a claim about
      // the future.
      const claimable = maxDate(
        null,
        minDate(window.endDate, lastGloballyCompleteDateExclusive(ctx.now)),
      );
      const nextVerifiedThrough = maxDate(stream.verifiedThroughDate, claimable);
      if (nextVerifiedThrough !== stream.verifiedThroughDate) {
        streamSet.verifiedThroughDate = nextVerifiedThrough;
      }
      const nextEarliest = minDate(stream.earliestVerifiedDate, window.startDate);
      if (nextEarliest !== stream.earliestVerifiedDate) {
        streamSet.earliestVerifiedDate = nextEarliest;
      }
      if (params.extraTxWork) await params.extraTxWork(tx);
    }

    await tx
      .update(healthMetricStreams)
      .set(streamSet)
      .where(eq(healthMetricStreams.id, stream.id));
  });

  const succeeded = completeness.fetchComplete && rejections === 0;
  const failureClass = !completeness.fetchComplete
    ? (completeness.truncationReason ?? "fetch_incomplete")
    : rejections > 0
      ? strayDates.size > 0 && translated.rejections === 0
        ? "records_outside_window"
        : "value_shape_violation"
      : null;

  await closeSyncRun(ctx.db, runId, {
    status: succeeded ? "succeeded" : "failed",
    failureClass,
    requestCount,
    pageCount: fetched.pagesFetched,
    rowsInserted: counts.inserted,
    rowsUpdated: counts.updated,
    rowsUnchanged: counts.unchanged,
    rowsTombstoned: tombstoned,
    rowsRejected: rejections,
    rowsCollapsed: counts.collapsed,
    expectedBucketCount: completeness.expectedBucketCount,
    receivedBucketCount: completeness.receivedBucketCount,
  });

  if (succeeded) return { kind: "ok", authoritative };
  return { kind: "failed", failureClass: failureClass ?? "fetch_incomplete" };
}

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

/**
 * Fans one alert out to every eligible device, at most once per reason per
 * pass.
 *
 * Best-effort by design: the durable state (needs_reauth, a disabled stream, a
 * failed run) is already committed before this runs, so a pg-boss hiccup costs
 * a notification, never a fact. Copied from calendar-refresh-token.ts's
 * markNeedsReauth -- the health service's own markNeedsReauth in apps/api sends
 * nothing at all, so it is deliberately NOT the precedent here.
 */
async function alertOnce(
  ctx: PassContext,
  reason: string,
  title: string,
  body: string,
): Promise<void> {
  if (ctx.alertedReasons.has(reason)) return;
  ctx.alertedReasons.add(reason);
  if (!ctx.boss) return;

  const eligible = await ctx.db
    .select({ id: devices.id })
    .from(devices)
    .where(
      and(
        eq(devices.notifyAlerts, true),
        eq(devices.notificationsEnabled, true),
        isNull(devices.revokedAt),
      ),
    );

  for (const device of eligible) {
    await ctx.boss.send(NOTIFICATIONS_DISPATCH_QUEUE, {
      category: "alert",
      title,
      // `body` is always one of this module's own literals, optionally
      // interpolating a METRIC NAME. It never carries a health value, a date,
      // a token or a provider message -- a push notification is the least
      // private surface in the system and the alert exists to say "look at
      // Settings", not to report data.
      body,
      data: { healthConnectionId: ctx.connection.id },
      dedupeKey: `health-sync-alert:${ctx.connection.id}:${reason}`,
      deviceId: device.id,
    });
  }
}

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

function deriveKind(
  data: HealthSyncConnectionJobData,
  stream: StreamRow,
  nowMs: number,
): HealthSyncRunKind {
  if (data.requestedKind === "hot") return "hot";
  if (data.trigger === "manual") return "manual";
  if (stream.lastFullSyncAt === null) return "warm";
  return nowMs - stream.lastFullSyncAt.getTime() >= WARM_DUE_MS ? "warm" : "hot";
}

export async function runHealthConnectionSync(
  deps: HealthSyncDeps,
  data: HealthSyncConnectionJobData,
): Promise<HealthPassResult> {
  const empty: HealthPassResult = {
    skipped: null,
    streamsAttempted: 0,
    runsWritten: 0,
    backfillChunks: 0,
    streamsFailed: 0,
  };

  const outcome = await withConnectionLock(deps.db, data.connectionId, () =>
    runLockedPass(deps, data),
  );
  if (!outcome.acquired) {
    // NO RUN ROW IS WRITTEN HERE, and that is deliberate rather than an
    // omission. health_sync_runs.metric, range_start_date and range_end_date
    // are all NOT NULL, and at this point no stream has been selected and no
    // window computed -- a connection-level "skipped" row could only be
    // fabricated from values that do not exist. The other pass is covering the
    // same work anyway, so the honest record is no record.
    console.log(
      `health.google.sync-connection: connection ${data.connectionId} already syncing, skipping`,
    );
    return { ...empty, skipped: "lock_not_acquired" };
  }
  return outcome.result;
}

async function runLockedPass(
  deps: HealthSyncDeps,
  data: HealthSyncConnectionJobData,
): Promise<HealthPassResult> {
  const result: HealthPassResult = {
    skipped: null,
    streamsAttempted: 0,
    runsWritten: 0,
    backfillChunks: 0,
    streamsFailed: 0,
  };
  const now = deps.now ? deps.now() : new Date();

  // Re-read INSIDE the lock. Between enqueue and execution the user may have
  // disconnected, the grant may have died, or another pass may have marked the
  // connection needs_reauth -- and acting on the payload's stale view is how a
  // revoked connection keeps getting hammered.
  const [connection] = await deps.db
    .select()
    .from(healthConnections)
    .where(eq(healthConnections.id, data.connectionId));
  if (!connection) return { ...result, skipped: "connection_not_found" };
  if (connection.status !== "active") {
    console.log(
      `health.google.sync-connection: connection ${connection.id} is ${connection.status}, skipping`,
    );
    return { ...result, skipped: "connection_not_active" };
  }

  if (
    env.GOOGLE_HEALTH_OAUTH_CLIENT_ID === undefined ||
    env.GOOGLE_HEALTH_OAUTH_CLIENT_SECRET === undefined
  ) {
    // Checked before any run row is opened, so an unconfigured deployment
    // produces a log line rather than eighteen skipped rows an hour.
    console.warn("health.google.sync-connection: GOOGLE_HEALTH_OAUTH_* not configured, skipping");
    return { ...result, skipped: "not_configured" };
  }

  const allStreams = await deps.db
    .select()
    .from(healthMetricStreams)
    .where(eq(healthMetricStreams.connectionId, connection.id));

  const order = new Map(HEALTH_METRICS.map((m, i) => [m, i]));
  const enabled = allStreams
    .filter((s) => s.syncEnabled && isSyncableMetric(s.metric))
    .sort((a, b) => (order.get(a.metric) ?? 0) - (order.get(b.metric) ?? 0));
  const running = allStreams
    .filter((s) => s.backfillStatus === "running" && isSyncableMetric(s.metric))
    .sort((a, b) => (order.get(a.metric) ?? 0) - (order.get(b.metric) ?? 0));

  if (enabled.length === 0 && running.length === 0) {
    return { ...result, skipped: "no_enabled_streams" };
  }

  const limiter = deps.limiterFactory
    ? deps.limiterFactory()
    : createHealthLimiter({
        now: () => Date.now(),
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        random: () => Math.random(),
      });

  const ctx: PassContext = {
    db: deps.db,
    client: deps.client,
    boss: deps.boss ?? null,
    limiter,
    budget: createRefreshBudget(),
    connection,
    now,
    refresh: deps.refresh,
    accessToken: null,
    alertedReasons: new Set<string>(),
    runsWritten: 0,
  };

  let stop = false;
  let authPermanent = false;

  // ---- foreground -------------------------------------------------------
  for (const stream of enabled) {
    if (stop) break;
    const def = HEALTH_METRIC_CATALOG[stream.metric];
    if (!def) continue;

    const kind = deriveKind(data, stream, now.getTime());
    if (
      kind !== "manual" &&
      stream.lastSuccessfulSyncAt !== null &&
      now.getTime() - stream.lastSuccessfulSyncAt.getTime() < DEBOUNCE_MS
    ) {
      continue;
    }

    result.streamsAttempted += 1;
    const window = kind === "hot" ? hotWindow(now) : warmWindow(now);
    const chunks = chunkRange(def.maxRangeDays, window.startDate, window.endDate);

    let anyOk = false;
    let allAuthoritative = true;
    for (const chunk of chunks) {
      const outcome = await syncChunk(ctx, { stream, def, kind, window: chunk });
      if (outcome.kind === "auth_permanent") {
        authPermanent = true;
        stop = true;
        break;
      }
      if (outcome.kind === "budget_exhausted") {
        stop = true;
        break;
      }
      if (outcome.kind === "failed") {
        allAuthoritative = false;
        const breaker = await evaluateStreamBreaker(
          ctx.db,
          { connectionId: connection.id, streamId: stream.id, metric: stream.metric },
          now,
        );
        if (breaker.tripped) {
          await alertOnce(
            ctx,
            `breaker:${stream.metric}`,
            "Health sync disabled a metric",
            `Personal OS stopped syncing "${stream.metric}" after repeated failures. Re-enable it in Settings.`,
          );
        }
        continue;
      }
      anyOk = true;
      if (!outcome.authoritative) allAuthoritative = false;
    }

    if (!anyOk) result.streamsFailed += 1;
    if (anyOk && allAuthoritative && kind !== "hot") {
      // Only at the END of a fully authoritative pass over the whole window.
      // Advancing it on a partial pass would push the next warm pass twenty
      // hours out on the strength of a window that was never completely
      // verified.
      await ctx.db
        .update(healthMetricStreams)
        .set({ lastFullSyncAt: now, updatedAt: now })
        .where(eq(healthMetricStreams.id, stream.id));
    }
  }

  // ---- backfill ---------------------------------------------------------
  if (!stop) {
    result.backfillChunks = await runBackfillSlice(ctx, running);
  }

  if (authPermanent) {
    await alertOnce(
      ctx,
      "auth_permanent",
      "Google Health needs reconnecting",
      "Personal OS can no longer sync your Google Health data. Reconnect it in Settings.",
    );
  } else if (result.streamsAttempted > 0 && result.streamsFailed === result.streamsAttempted) {
    await alertOnce(
      ctx,
      "all_streams_failed",
      "Google Health sync is failing",
      "Every Google Health metric failed to sync on the last attempt.",
    );
  }

  result.runsWritten = ctx.runsWritten;
  return result;
}

/**
 * Services at most BACKFILL_CHUNKS_PER_PASS chunks, round-robin across every
 * stream whose backfill is running.
 *
 * Round-robin rather than depth-first so that two running backfills make
 * progress together instead of one blocking the other for days.
 */
async function runBackfillSlice(ctx: PassContext, running: readonly StreamRow[]): Promise<number> {
  if (running.length === 0) return 0;

  // A round-robin queue of stream IDS, never of row snapshots. The cursor and
  // the cancel flag are BOTH re-read from Postgres at every chunk boundary: the
  // cursor because the previous chunk advanced it inside its own transaction
  // (so the database, not this loop, is the authority on where we are), and the
  // cancel flag because the user may have pressed stop while the previous chunk
  // was in flight.
  const queue = running.map((s) => s.id);
  let done = 0;
  // Bounds the loop against a stream that neither advances nor drops out --
  // an infinite backfill loop would hold the connection lock until pg-boss's
  // expireInSeconds fired, blocking every subsequent pass for fifteen minutes.
  let guard = 0;

  while (done < BACKFILL_CHUNKS_PER_PASS && queue.length > 0 && guard < 64) {
    guard += 1;
    const streamId = queue.shift()!;

    // Cancellation is consumed at a CHUNK BOUNDARY, never mid-chunk: a chunk
    // already in flight finishes its transaction cleanly rather than leaving
    // half a window written with no cursor advance.
    const [fresh] = await ctx.db
      .select()
      .from(healthMetricStreams)
      .where(eq(healthMetricStreams.id, streamId));
    if (!fresh || fresh.backfillStatus !== "running") continue;
    const def = HEALTH_METRIC_CATALOG[fresh.metric];
    if (!def) continue;

    const state: BackfillState = {
      backfillStatus: fresh.backfillStatus,
      backfillTargetDate: fresh.backfillTargetDate,
      backfillCursorDate: fresh.backfillCursorDate,
      backfillCancelRequested: fresh.backfillCancelRequested,
      earliestVerifiedDate: fresh.earliestVerifiedDate,
    };
    const target = state.backfillTargetDate;
    const cursor = state.backfillCursorDate;
    if (target === null || cursor === null) continue;

    if (state.backfillCancelRequested) {
      const columns = settleBackfill(state, "cancelled");
      await applyBackfill(ctx, fresh.id, columns);
      const pending = chunkRange(def.maxRangeDays, target, cursor)[0];
      const runId = await openSyncRun(ctx.db, {
        connectionId: ctx.connection.id,
        streamId: fresh.id,
        metric: fresh.metric,
        kind: "backfill",
        rangeStartDate: pending?.startDate ?? target,
        rangeEndDate: pending?.endDate ?? cursor,
      });
      ctx.runsWritten += 1;
      await closeSyncRun(ctx.db, runId, { status: "cancelled" });
      continue;
    }

    if (cursor <= target) {
      // completeBackfill KEEPS the target non-null: 'complete' is a non-idle
      // status and nulling it violates 0013's backfill CHECK.
      await applyBackfill(ctx, fresh.id, completeBackfill(state));
      continue;
    }

    const chunk = chunkRange(def.maxRangeDays, target, cursor)[0];
    if (!chunk) continue;

    const outcome = await syncChunk(ctx, {
      stream: fresh,
      def,
      kind: "backfill",
      window: chunk,
      extraTxWork: async (tx) => {
        // IN THE SAME TRANSACTION as this chunk's rows, so the database can
        // never claim a range is verified while its rows are missing.
        const columns =
          chunk.startDate <= target
            ? completeBackfill(state)
            : advanceBackfillCursor(state, chunk.startDate);
        await tx
          .update(healthMetricStreams)
          .set({
            backfillStatus: columns.backfillStatus,
            backfillTargetDate: columns.backfillTargetDate,
            backfillCursorDate: columns.backfillCursorDate,
            // Deliberately NOT backfillCancelRequested -- `state` was
            // snapshotted before this chunk's fetch, so writing it back would
            // overwrite a cancel that arrived while the fetch was in flight.
            updatedAt: ctx.now,
          })
          .where(eq(healthMetricStreams.id, fresh.id));
      },
    });

    done += 1;
    if (outcome.kind === "auth_permanent" || outcome.kind === "budget_exhausted") break;
    // Requeued only on an authoritative chunk that did not reach the target.
    // A failed or non-authoritative chunk deliberately does NOT advance the
    // cursor, so requeuing it would re-fetch the identical window inside the
    // same pass -- burning the whole per-pass allowance on a window that is
    // already failing, and starving any other running backfill.
    if (outcome.kind === "ok" && outcome.authoritative && chunk.startDate > target) {
      queue.push(streamId);
    }
  }

  return done;
}

/**
 * Writes a backfill transition.
 *
 * Accepts either the full column set or the narrower progress set. The cancel
 * flag is written ONLY when the transition actually owns it: a progress
 * transition composes its columns from state snapshotted BEFORE the chunk's
 * network fetch, so writing the flag back would silently discard a cancel that
 * arrived during that fetch -- after the API had already returned 200.
 */
async function applyBackfill(
  ctx: PassContext,
  streamId: string,
  columns: BackfillColumns | BackfillProgressColumns,
): Promise<void> {
  await ctx.db
    .update(healthMetricStreams)
    .set({
      backfillStatus: columns.backfillStatus,
      backfillTargetDate: columns.backfillTargetDate,
      backfillCursorDate: columns.backfillCursorDate,
      ...("backfillCancelRequested" in columns
        ? { backfillCancelRequested: columns.backfillCancelRequested }
        : {}),
      updatedAt: ctx.now,
    })
    .where(eq(healthMetricStreams.id, streamId));
}

/**
 * Enqueues one connection-level job per active connection.
 *
 * One job per CONNECTION, never per stream: a per-stream job would let all
 * eighteen streams of one connection run concurrently, and "do not overlap
 * syncs for the same connection" is the entire reason the pass exists.
 * singletonKey collapses the hourly cron, app-open and manual triggers onto one
 * slot per connection.
 */
export async function enqueueHealthSyncForAllActiveConnections(
  db: Db,
  boss: PgBoss,
  queueName: string,
): Promise<void> {
  const rows = await db
    .select({ id: healthConnections.id })
    .from(healthConnections)
    .where(eq(healthConnections.status, "active"));

  for (const row of rows) {
    await boss.send(
      queueName,
      { connectionId: row.id, trigger: "scheduled" as const },
      { singletonKey: row.id },
    );
  }
}
