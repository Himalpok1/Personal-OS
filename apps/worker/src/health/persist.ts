import { healthDailyMetrics, healthSessions, type Db } from "@personal-os/db";
import {
  contentHash,
  dailyContentInput,
  sessionContentInput,
  type DailyMetricRow,
  type SessionRow,
} from "@personal-os/health-providers";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

// Hash-gated persistence for health data rows.
//
// ============================================================================
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE:
//   TWO IDENTICAL CONSECUTIVE SYNCS WRITE ZERO ROWS.
// ============================================================================
//
// Not "write the same values twice" -- literally zero writes. That matters for
// three concrete reasons, none of them aesthetic:
//
//   1. `updated_at` is the only signal available to the 6.4 dashboard for "when
//      did this actually change". A sync that rewrites every row with identical
//      content every 30 minutes destroys it.
//   2. The warm window is 35 days across up to 18 streams. Rewriting it hourly
//      is ~15k pointless row versions a day, every one of them dead tuples for
//      autovacuum on a mini PC.
//   3. It is the property that makes an idempotency test possible at all. If
//      re-running a sync is observably a no-op, a test can assert `ctid`/`xmin`
//      equality and catch any future change that starts writing spuriously.
//
// The mechanism is a WHERE clause on the ON CONFLICT DO UPDATE:
//
//   on conflict (...) do update set ..., updated_at = now()
//   where <table>.content_hash is distinct from excluded.content_hash
//
// When that predicate is false the row is not written AT ALL -- no new tuple,
// no updated_at bump -- and, critically, the statement returns NO ROW for it.
// That absence is how "unchanged" is counted: a returned row means something
// was written, and `xmax = 0` on that returned row distinguishes an insert from
// an update.
//
// `is distinct from`, not `<>`: content_hash is NOT NULL today, but `<>` yields
// NULL (not false) against a NULL and would silently stop updating.

/** What a hash-gated upsert actually did. */
export interface UpsertCounts {
  inserted: number;
  updated: number;
  /** Present in the payload, byte-identical to what is stored, not written. */
  unchanged: number;
  /**
   * Rows dropped because two fetched records shared one identity key. Counted
   * rather than left to the database, because a multi-row INSERT ... ON
   * CONFLICT raises `cannot affect row a second time` if the same key appears
   * twice in one statement -- a whole-chunk failure caused by a provider
   * duplicate, which is not a failure worth having.
   */
  collapsed: number;
}

const EMPTY: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0, collapsed: 0 };

function tally(
  returned: readonly { inserted: boolean }[],
  attempted: number,
): {
  inserted: number;
  updated: number;
  unchanged: number;
} {
  const inserted = returned.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: attempted - returned.length,
  };
}

/**
 * `(xmax = 0)` is Postgres's own way of asking "was this returned row an
 * INSERT?".
 *
 * On a plain insert the tuple's xmax is 0; on an ON CONFLICT DO UPDATE the
 * conflicting tuple was locked by the speculative insertion, so xmax carries
 * that transaction id. It is the only in-statement discriminator available --
 * `RETURNING` cannot otherwise tell the two apart -- and it is why the tests
 * are careful to compare `ctid`/`xmin`/`updated_at` across runs but NEVER
 * `xmax`: the speculative lock sets xmax IN PLACE on rows that were merely
 * examined, so an unchanged row's xmax legitimately differs run to run.
 */
const WAS_INSERT = sql<boolean>`(xmax = 0)`;

// ---------------------------------------------------------------------------
// Daily metrics
// ---------------------------------------------------------------------------

/**
 * The hash of a VERIFIED-ABSENT day.
 *
 * Built here rather than through dailyContentInput because that helper's row
 * type declares `hasData: true` as a literal -- deliberately, so the pure
 * translation layer cannot emit an absence. Densification is a decision about a
 * whole window, not about a record, so it belongs on this side of the boundary.
 * The KEY SET is kept byte-identical to dailyContentInput's output so a real
 * row and an absence row are hashed over the same shape and can never collide.
 */
export function absenceContentInput(metric: string, localDate: string): Record<string, unknown> {
  return {
    metric,
    localDate,
    hasData: false,
    value: null,
    breakdown: null,
    sourceCount: null,
  };
}

export interface UpsertDailyParams {
  connectionId: string;
  rows: readonly DailyMetricRow[];
  sourceFamily: string | null;
}

/** Hash-gated upsert of real observed daily rows. */
export async function upsertDailyMetrics(db: Db, params: UpsertDailyParams): Promise<UpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY };

  // Last-wins de-duplication on the conflict key. See UpsertCounts.collapsed.
  const byDate = new Map<string, DailyMetricRow>();
  let collapsed = 0;
  for (const row of params.rows) {
    if (byDate.has(row.localDate)) collapsed += 1;
    byDate.set(row.localDate, row);
  }

  const values = [...byDate.values()].map((row) => ({
    connectionId: params.connectionId,
    metric: row.metric,
    localDate: row.localDate,
    hasData: true,
    value: row.value,
    breakdown: row.breakdown ?? null,
    sourceCount: row.sourceCount,
    sourceFamily: params.sourceFamily,
    contentHash: contentHash(dailyContentInput(row)),
  }));

  const returned = await db
    .insert(healthDailyMetrics)
    .values(values)
    .onConflictDoUpdate({
      target: [
        healthDailyMetrics.connectionId,
        healthDailyMetrics.metric,
        healthDailyMetrics.localDate,
      ],
      set: {
        hasData: sql`excluded.has_data`,
        value: sql`excluded.value`,
        breakdown: sql`excluded.breakdown`,
        sourceCount: sql`excluded.source_count`,
        sourceFamily: sql`excluded.source_family`,
        contentHash: sql`excluded.content_hash`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`health_daily_metrics.content_hash is distinct from excluded.content_hash`,
    })
    .returning({ inserted: WAS_INSERT });

  return { ...tally(returned, values.length), collapsed };
}

export interface DensifyParams {
  connectionId: string;
  metric: string;
  /** Civil dates verified absent. Callers pass window-minus-observed. */
  dates: readonly string[];
  sourceFamily: string | null;
  /**
   * Backfill: add absence markers, never remove data.
   *
   * A warm or manual pass over the trailing window IS authoritative about
   * deletion -- a day that had steps yesterday and returns nothing today, in a
   * complete authoritative fetch, was deleted upstream, and overwriting the row
   * with an absence is the ONLY deletion detection daily metrics have (the API
   * offers no tombstones; ADR-046). A BACKFILL chunk is different in kind: it
   * is reaching into history to fill holes, and a provider that has quietly
   * aged out old detail would otherwise let a backfill erase years of real
   * data in one pass. Insert-only makes that impossible rather than unlikely.
   */
  insertOnly: boolean;
}

/**
 * Writes `has_data = false` rows for civil days the provider verifiably had no
 * data for.
 *
 * The caller is responsible for the ADR-046 gating: densification is legal only
 * on an authoritative pass, and only over `densifiableRange(...)`, which clamps
 * out days still in flight somewhere on Earth and days before this stream ever
 * produced data. Nothing here re-derives those rules, because they need the
 * whole-window context this function does not have.
 */
export async function densifyDates(db: Db, params: DensifyParams): Promise<UpsertCounts> {
  if (params.dates.length === 0) return { ...EMPTY };

  const rows = [...new Set(params.dates)].map((localDate) => ({
    connectionId: params.connectionId,
    metric: params.metric,
    localDate,
    // The 0013 CHECK makes this shape the only legal absence: has_data false
    // AND value null AND breakdown null. A true recorded zero is has_data true
    // with value '0', and never-verified is the absence of a row entirely.
    hasData: false,
    value: null,
    breakdown: null,
    sourceCount: null,
    sourceFamily: params.sourceFamily,
    contentHash: contentHash(absenceContentInput(params.metric, localDate)),
  }));

  if (params.insertOnly) {
    const returned = await db
      .insert(healthDailyMetrics)
      .values(rows)
      .onConflictDoNothing({
        target: [
          healthDailyMetrics.connectionId,
          healthDailyMetrics.metric,
          healthDailyMetrics.localDate,
        ],
      })
      .returning({ inserted: WAS_INSERT });
    // DO NOTHING returns only rows genuinely inserted, so every absent row is
    // "unchanged" -- it was left exactly as it was, which is the whole point.
    return {
      inserted: returned.length,
      updated: 0,
      unchanged: rows.length - returned.length,
      collapsed: 0,
    };
  }

  const returned = await db
    .insert(healthDailyMetrics)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        healthDailyMetrics.connectionId,
        healthDailyMetrics.metric,
        healthDailyMetrics.localDate,
      ],
      set: {
        hasData: sql`excluded.has_data`,
        value: sql`excluded.value`,
        breakdown: sql`excluded.breakdown`,
        sourceCount: sql`excluded.source_count`,
        sourceFamily: sql`excluded.source_family`,
        contentHash: sql`excluded.content_hash`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`health_daily_metrics.content_hash is distinct from excluded.content_hash`,
    })
    .returning({ inserted: WAS_INSERT });

  return { ...tally(returned, rows.length), collapsed: 0 };
}

// ---------------------------------------------------------------------------
// Sessions
// ---------------------------------------------------------------------------

export interface UpsertSessionsParams {
  connectionId: string;
  rows: readonly SessionRow[];
}

export async function upsertSessions(db: Db, params: UpsertSessionsParams): Promise<UpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY };

  const byKey = new Map<string, SessionRow>();
  let collapsed = 0;
  for (const row of params.rows) {
    const key = `${row.metric} ${row.externalKey}`;
    if (byKey.has(key)) collapsed += 1;
    byKey.set(key, row);
  }

  const values = [...byKey.values()].map((row) => ({
    connectionId: params.connectionId,
    metric: row.metric,
    externalKey: row.externalKey,
    externalKeySource: row.externalKeySource,
    dataPointName: row.dataPointName,
    attributedLocalDate: row.attributedLocalDate,
    civilStartLocal: row.civilStartLocal,
    civilEndLocal: row.civilEndLocal,
    startAt: row.startAt,
    endAt: row.endAt,
    startUtcOffsetSeconds: row.startUtcOffsetSeconds,
    endUtcOffsetSeconds: row.endUtcOffsetSeconds,
    durationSeconds: row.durationSeconds,
    detail: row.detail,
    providerCreatedAt: row.providerCreatedAt === null ? null : new Date(row.providerCreatedAt),
    providerUpdatedAt: row.providerUpdatedAt === null ? null : new Date(row.providerUpdatedAt),
    contentHash: contentHash(sessionContentInput(row)),
  }));

  const returned = await db
    .insert(healthSessions)
    .values(values)
    .onConflictDoUpdate({
      target: [healthSessions.connectionId, healthSessions.metric, healthSessions.externalKey],
      set: {
        externalKeySource: sql`excluded.external_key_source`,
        dataPointName: sql`excluded.data_point_name`,
        attributedLocalDate: sql`excluded.attributed_local_date`,
        civilStartLocal: sql`excluded.civil_start_local`,
        civilEndLocal: sql`excluded.civil_end_local`,
        startAt: sql`excluded.start_at`,
        endAt: sql`excluded.end_at`,
        startUtcOffsetSeconds: sql`excluded.start_utc_offset_seconds`,
        endUtcOffsetSeconds: sql`excluded.end_utc_offset_seconds`,
        durationSeconds: sql`excluded.duration_seconds`,
        detail: sql`excluded.detail`,
        providerCreatedAt: sql`excluded.provider_created_at`,
        providerUpdatedAt: sql`excluded.provider_updated_at`,
        contentHash: sql`excluded.content_hash`,
        // Un-tombstone. A session that was swept and then returned again by
        // the provider is alive; leaving deleted_at set would hide it forever.
        deletedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      // `or ... deleted_at is not null` IS LOAD-BEARING, not belt-and-braces.
      // Without it, a session that was tombstoned and then reappeared with
      // BYTE-IDENTICAL content would fail the hash test, skip the update, and
      // stay deleted permanently -- the one case where "nothing changed" and
      // "nothing needs writing" are not the same statement.
      setWhere: sql`health_sessions.content_hash is distinct from excluded.content_hash or health_sessions.deleted_at is not null`,
    })
    .returning({ inserted: WAS_INSERT });

  return { ...tally(returned, values.length), collapsed };
}

export interface TombstoneParams {
  connectionId: string;
  metric: string;
  /**
   * Which civil axis bounds the sweep.
   *
   * MUST be the same axis the fetch filter used (ADR-049): sleep is filtered,
   * attributed and swept on civil END; exercise on civil START. Sweeping on a
   * different axis than the query means deleting rows the query never had a
   * chance to return.
   */
  axis: "civil_end" | "civil_start";
  /** Half-open, matching the chunk's own window. */
  windowStartDate: string;
  windowEndDateExclusive: string;
  /** External keys this authoritative fetch actually returned. */
  seenKeys: readonly string[];
  now?: Date;
}

/**
 * Soft-deletes sessions inside an authoritative window that the provider no
 * longer returns.
 *
 * FOUR PRECONDITIONS, ALL ENFORCED BY THE CALLER, ONE ENFORCED HERE:
 *
 *   * only on a warm or manual pass (never hot);
 *   * only when the fetch was authoritative;
 *   * only for `external_key_source = 'data_point_name'` (enforced below);
 *   * only when `seenKeys` is NON-EMPTY (enforced below, and see why).
 *
 * WHY THE NON-EMPTY GATE IS A CORRECTNESS REQUIREMENT AND NOT AN OPTIMIZATION:
 * in Postgres, `x <> ALL('{}'::text[])` is TRUE -- an empty "not in" set
 * matches EVERYTHING. A sweep with no seen keys would therefore tombstone every
 * session in the window in one statement. Returning early is the guard, and it
 * is why an empty array is never passed to the query at all.
 *
 * The `external_key_source` restriction exists because a DERIVED key is a hash
 * over the fields the API happened to return. If the provider changes any of
 * them -- a recomputed source attribution, a rounded instant -- the key changes,
 * the record looks new, and the old one looks deleted. Tombstoning on that
 * evidence would delete real sessions on a provider-side refactor. A
 * `dataPointName` is a stable resource identifier and its absence is real
 * evidence.
 */
export async function tombstoneMissingSessions(db: Db, params: TombstoneParams): Promise<number> {
  if (params.seenKeys.length === 0) return 0;

  const now = params.now ?? new Date();
  const axisColumn =
    params.axis === "civil_end" ? healthSessions.civilEndLocal : healthSessions.civilStartLocal;

  const returned = await db
    .update(healthSessions)
    .set({ deletedAt: now, updatedAt: now })
    .where(
      and(
        eq(healthSessions.connectionId, params.connectionId),
        eq(healthSessions.metric, params.metric),
        // Idempotency: a second identical sweep writes nothing, so a run's
        // rows_tombstoned is a genuine count of newly-missing sessions rather
        // than a restatement of history.
        isNull(healthSessions.deletedAt),
        eq(healthSessions.externalKeySource, "data_point_name"),
        sql`${axisColumn} >= ${params.windowStartDate}::timestamp`,
        sql`${axisColumn} < ${params.windowEndDateExclusive}::timestamp`,
        notInArray(healthSessions.externalKey, [...params.seenKeys]),
      ),
    )
    .returning({ id: healthSessions.id });

  return returned.length;
}
