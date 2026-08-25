import {
  civilDateTimeToNaiveDate,
  civilDateToLocalDate,
  parseGoogleDuration,
  type GoogleCivilDateTime,
} from "@personal-os/core/health/civil-time";
import {
  attributeExerciseLocalDate,
  attributeSleepLocalDate,
} from "@personal-os/core/health/day-attribution";
import type { HealthMetricDefinition } from "../google-health-catalog.js";
import { bodySampleKey, sessionKey, type ExternalKeySource } from "../identity.js";
import { extractValue, jsonKindOf, type Rejection } from "./extract.js";
import { camelCase, type HealthValueSpec } from "./value-spec.js";

// Pure translation: validated provider records in, row-shaped plain objects
// out. No database import, no Drizzle type, no clock read, no I/O.
//
// The row interfaces below are deliberately hand-written rather than derived
// from the Drizzle schema. Importing $inferInsert would make this package
// depend on @personal-os/db, which would drag the driver into a package whose
// entire value is being pure and trivially testable. The cost is that the two
// must be kept in step by review; the benefit is that these functions can be
// exercised with nothing running.

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type Translated<T> =
  { readonly ok: true; readonly row: T } | { readonly ok: false; readonly rejection: Rejection };

function fail<T>(code: string, keyPath: string, saw: unknown): Translated<T> {
  return { ok: false, rejection: { code, keyPath, sawType: jsonKindOf(saw) } };
}

// ---------------------------------------------------------------------------
// Row shapes
// ---------------------------------------------------------------------------

/**
 * A health_daily_metrics row carrying real data.
 *
 * hasData is the literal `true`: this module only ever produces rows for data
 * that was actually observed. A verified-ABSENT row (has_data=false, value and
 * breakdown null) is densification, which is a decision about a whole window
 * rather than about a record, and belongs to the sync engine -- ADR-046
 * restricts it to warm/manual/backfill and clamps it, and none of that context
 * exists here. Making the type literal means this module cannot accidentally
 * emit an absence.
 */
export interface DailyMetricRow {
  readonly metric: string;
  readonly localDate: string;
  readonly hasData: true;
  /** Canonical decimal string, destined for a Postgres `numeric`. */
  readonly value: string;
  readonly breakdown: unknown;
  readonly sourceCount: number | null;
}

/** The three descriptive provenance fields, validated and allowlisted. */
export interface CanonicalSourceIdentity {
  readonly recordingMethod: string | null;
  readonly deviceFormFactor: string | null;
  readonly applicationPlatform: string | null;
}

/** One episodic body sample, before collapse into a daily row. */
export interface SampleRow {
  readonly metric: string;
  readonly localDate: string;
  /** RFC-3339 UTC, normalized so equal instants produce equal keys. */
  readonly physicalTime: string;
  readonly utcOffsetSeconds: number;
  readonly value: string;
  readonly sourceIdentity: CanonicalSourceIdentity;
  readonly externalKey: string;
  readonly externalKeySource: ExternalKeySource;
}

export interface SessionDetail {
  readonly source: CanonicalSourceIdentity;
  readonly sessionType: string | null;
  readonly sessionSubtype: string | null;
}

/** A health_sessions row. */
export interface SessionRow {
  readonly metric: string;
  readonly externalKey: string;
  readonly externalKeySource: ExternalKeySource;
  readonly dataPointName: string | null;
  readonly attributedLocalDate: string;
  /** Naive Dates for the `timestamp without time zone` columns. */
  readonly civilStartLocal: Date;
  readonly civilEndLocal: Date;
  readonly startAt: Date;
  readonly endAt: Date;
  readonly startUtcOffsetSeconds: number;
  readonly endUtcOffsetSeconds: number;
  readonly durationSeconds: number;
  readonly detail: SessionDetail;
  /** RFC-3339 UTC, or null when the provider sent none. */
  readonly providerCreatedAt: string | null;
  readonly providerUpdatedAt: string | null;
}

// ---------------------------------------------------------------------------
// Field-name candidates
// ---------------------------------------------------------------------------

/**
 * Response field names, in one place so a live 400 or a documentation
 * correction is a one-line edit rather than a hunt.
 *
 * WHY SOME ARE LISTS. Two facts are certain because they were read off real
 * traffic: `dataPointName` is what a reconcile record actually carries (the
 * live F5 capture at apps/api/src/scripts/f5-capture.ts reads exactly that),
 * while ApiDataPoint's declared optional field is `name`. Both are therefore
 * accepted, in that order.
 *
 * The session interval's OFFSET field names are the genuinely uncertain ones --
 * the observation intervals we have seen carry `utcOffset` on a sample time,
 * but no session payload has ever been observed on this account. Both plausible
 * documented spellings are accepted. Crucially, the fallback is a list of NAMES,
 * never a default VALUE: if none matches, the record is rejected. Synthesizing
 * a zero offset would write a fabricated fact into a NOT NULL column and be
 * indistinguishable from a genuine UTC reading forever after.
 */
export const RESPONSE_FIELDS = {
  dataPointName: ["dataPointName", "name"],
  sampleTime: ["sampleTime"],
  physicalTime: ["physicalTime"],
  civilTime: ["civilTime"],
  utcOffset: ["utcOffset"],
  interval: ["interval"],
  startTime: ["startTime"],
  endTime: ["endTime"],
  civilStartTime: ["civilStartTime"],
  civilEndTime: ["civilEndTime"],
  startUtcOffset: ["startTimeUtcOffset", "startUtcOffset"],
  endUtcOffset: ["endTimeUtcOffset", "endUtcOffset"],
  sessionType: ["type", "activityType", "sessionType"],
  sessionSubtype: ["subtype", "activitySubtype", "sessionSubtype"],
  createTime: ["createTime"],
  updateTime: ["updateTime"],
} as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pickObject(
  source: Record<string, unknown>,
  names: readonly string[],
): Record<string, unknown> | null {
  for (const name of names) {
    const value = source[name];
    if (isPlainObject(value)) return value;
  }
  return null;
}

function pickString(source: Record<string, unknown>, names: readonly string[]): string | null {
  for (const name of names) {
    const value = source[name];
    if (typeof value === "string" && value.length > 0) return value;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Shared primitives
// ---------------------------------------------------------------------------

/**
 * Normalizes an RFC-3339 instant to a canonical UTC string.
 *
 * Normalized rather than kept verbatim so that "…T13:05:00Z",
 * "…T13:05:00.000Z" and "…T08:05:00-05:00" -- the same instant written three
 * ways -- cannot produce three external keys for one reading. Returns null for
 * anything unparseable so the caller rejects rather than storing an Invalid
 * Date.
 */
function normalizeInstant(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

/** Validates a google.type.Date and formats it, without inventing components. */
function formatGoogleDate(raw: unknown): string | null {
  if (!isPlainObject(raw)) return null;
  const year = raw["year"];
  const month = raw["month"];
  const day = raw["day"];
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const y = year as number;
  const m = month as number;
  const d = day as number;
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  return civilDateToLocalDate({ date: { year: y, month: m, day: d } });
}

/** Validates a CivilDateTime shape well enough for the core helpers to use it. */
function asCivilDateTime(raw: unknown): GoogleCivilDateTime | null {
  if (!isPlainObject(raw)) return null;
  if (formatGoogleDate(raw["date"]) === null) return null;
  return raw as unknown as GoogleCivilDateTime;
}

/**
 * The three provenance fields, each validated as a string or recorded as null.
 *
 * This is the ONLY route by which anything from `dataSource` reaches a stored
 * row. The raw object is never spread, never merged and never passed through,
 * so a field Google adds later -- of any name, of any shape -- cannot arrive in
 * jsonb by default.
 */
export function readSourceIdentity(record: Record<string, unknown>): CanonicalSourceIdentity {
  const ds = isPlainObject(record["dataSource"]) ? record["dataSource"] : {};
  const device = isPlainObject(ds["device"]) ? ds["device"] : {};
  const application = isPlainObject(ds["application"]) ? ds["application"] : {};
  const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);
  return {
    recordingMethod: str(ds["recordingMethod"]),
    deviceFormFactor: str(device["formFactor"]),
    applicationPlatform: str(application["platform"]),
  };
}

function readDataPointName(record: Record<string, unknown>): string | null {
  return pickString(record, RESPONSE_FIELDS.dataPointName);
}

// ---------------------------------------------------------------------------
// Daily rollup buckets
// ---------------------------------------------------------------------------

/**
 * One dailyRollUp bucket -> one health_daily_metrics row.
 *
 * local_date comes VERBATIM from civilStartTime.date (ADR-048). A rollup bucket
 * carries no physical instant and no UTC offset at all, so there is nothing to
 * convert even if we wanted to -- which is precisely why health data stores no
 * IANA timezone and is correct across DST and travel by construction.
 */
export function translateRollupBucket(
  bucket: Record<string, unknown>,
  def: HealthMetricDefinition,
  spec: HealthValueSpec,
): Translated<DailyMetricRow> {
  const localDate = formatGoogleDate(
    isPlainObject(bucket["civilStartTime"]) ? bucket["civilStartTime"]["date"] : undefined,
  );
  if (localDate === null) {
    return fail("rollup_civil_start_missing", "civilStartTime.date", bucket["civilStartTime"]);
  }

  const extracted = extractValue(bucket, spec);
  if (!extracted.ok) return { ok: false, rejection: extracted.rejection };

  return {
    ok: true,
    row: {
      metric: def.metric,
      localDate,
      hasData: true,
      value: extracted.value,
      breakdown: extracted.breakdown,
      // A rollup is already Google's cross-source aggregate for the day; it
      // reports no contributor count, so claiming one would be invention.
      sourceCount: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Precomputed daily records (`list`)
// ---------------------------------------------------------------------------

/**
 * One Google-precomputed Daily record -> one health_daily_metrics row.
 *
 * These types carry their own `date` (a bare google.type.Date, which is also
 * what their filter path addresses), so the local date is read from the record
 * rather than from the requested window. A record whose date falls outside the
 * chunk is the sync engine's problem to count as a rejection -- see
 * completeness.datesOutsideWindow -- not something to silently clamp here.
 */
export function translateDailyListRecord(
  record: Record<string, unknown>,
  def: HealthMetricDefinition,
  spec: HealthValueSpec,
): Translated<DailyMetricRow> {
  const container = record[spec.container];
  if (!isPlainObject(container)) {
    return fail("container_not_object", spec.container, container);
  }
  const localDate = formatGoogleDate(container["date"]);
  if (localDate === null) {
    return fail("daily_date_missing", `${spec.container}.date`, container["date"]);
  }

  const extracted = extractValue(record, spec);
  if (!extracted.ok) return { ok: false, rejection: extracted.rejection };

  return {
    ok: true,
    row: {
      metric: def.metric,
      localDate,
      hasData: true,
      value: extracted.value,
      breakdown: extracted.breakdown,
      sourceCount: null,
    },
  };
}

// ---------------------------------------------------------------------------
// Episodic body samples (`list`)
// ---------------------------------------------------------------------------

/**
 * One weight / body-fat sample -> an intermediate SampleRow.
 *
 * Note the local date comes from the sample's own CIVIL time, never from its
 * physical instant. That is the whole point of ADR-048: a 23:30 local weigh-in
 * belongs to that local day whatever UTC thinks, and deriving the date from the
 * instant would move it a day for anyone east or west of the server.
 */
export function translateSampleRecord(
  record: Record<string, unknown>,
  def: HealthMetricDefinition,
  spec: HealthValueSpec,
): Translated<SampleRow> {
  const container = record[spec.container];
  if (!isPlainObject(container)) {
    return fail("container_not_object", spec.container, container);
  }

  const sampleTime = pickObject(container, RESPONSE_FIELDS.sampleTime);
  if (sampleTime === null) {
    return fail("sample_time_missing", `${spec.container}.sampleTime`, container["sampleTime"]);
  }

  const rawCivil = pickObject(sampleTime, RESPONSE_FIELDS.civilTime);
  const localDate = rawCivil === null ? null : formatGoogleDate(rawCivil["date"]);
  if (localDate === null) {
    return fail("sample_civil_time_missing", `${spec.container}.sampleTime.civilTime`, rawCivil);
  }

  const physicalTime = normalizeInstant(pickString(sampleTime, RESPONSE_FIELDS.physicalTime));
  if (physicalTime === null) {
    return fail(
      "sample_physical_time_missing",
      `${spec.container}.sampleTime.physicalTime`,
      sampleTime["physicalTime"],
    );
  }

  const rawOffset = pickString(sampleTime, RESPONSE_FIELDS.utcOffset);
  if (rawOffset === null) {
    return fail(
      "sample_utc_offset_missing",
      `${spec.container}.sampleTime.utcOffset`,
      sampleTime["utcOffset"],
    );
  }
  let utcOffsetSeconds: number;
  try {
    utcOffsetSeconds = parseGoogleDuration(rawOffset);
  } catch {
    return fail(
      "sample_utc_offset_invalid",
      `${spec.container}.sampleTime.utcOffset`,
      sampleTime["utcOffset"],
    );
  }

  const extracted = extractValue(record, spec);
  if (!extracted.ok) return { ok: false, rejection: extracted.rejection };

  const sourceIdentity = readSourceIdentity(record);
  const key = bodySampleKey({
    dataPointName: readDataPointName(record),
    metric: def.metric,
    physicalTime,
    utcOffsetSeconds,
    value: extracted.value,
    ...sourceIdentity,
  });

  return {
    ok: true,
    row: {
      metric: def.metric,
      localDate,
      physicalTime,
      utcOffsetSeconds,
      value: extracted.value,
      sourceIdentity,
      externalKey: key.key,
      externalKeySource: key.source,
    },
  };
}

export interface SampleCollapseResult {
  readonly rows: readonly DailyMetricRow[];
  /**
   * External-key COLLISIONS only -- two fetched records that were
   * indistinguishable in every field the API exposes.
   *
   * This is what health_sync_runs.rows_collapsed documents, and it is NOT a
   * count of samples folded into a day. Many-samples-to-one-day is the normal,
   * expected behaviour of this function and is recorded per row by sourceCount;
   * reporting it as rows_collapsed would make a healthy day look like a
   * persistent identity defect and drown the signal that column exists for.
   */
  readonly collapsed: number;
}

/**
 * Collapses episodic samples into at most one row per civil day.
 *
 * LAST READING OF THE CIVIL DAY WINS. For weight and body fat that is the
 * conventional and defensible choice: a day's later reading supersedes an
 * earlier one, and averaging two weigh-ins produces a number that was never
 * measured.
 *
 * ORDERING IS A TOTAL ORDER, ON PURPOSE. Pages arrive in whatever order the API
 * and the retry loop produce them, and a result that depends on that order
 * would make the content hash flap -- rewriting unchanged rows on every sync
 * and destroying the "identical re-fetch writes nothing" property the whole
 * design rests on. Sorting by physicalTime, then canonical value, then external
 * key, then local date leaves no pair of distinct rows tied, so arrival order
 * cannot survive into the output.
 *
 * De-duplication happens AFTER sorting for the same reason: "first occurrence"
 * must mean first in a defined order, not first off the wire.
 */
export function collapseSamplesToDays(
  samples: readonly SampleRow[],
  def: HealthMetricDefinition,
): SampleCollapseResult {
  const sorted = [...samples].sort((a, b) => {
    if (a.physicalTime !== b.physicalTime) return a.physicalTime < b.physicalTime ? -1 : 1;
    if (a.value !== b.value) return a.value < b.value ? -1 : 1;
    if (a.externalKey !== b.externalKey) return a.externalKey < b.externalKey ? -1 : 1;
    if (a.localDate !== b.localDate) return a.localDate < b.localDate ? -1 : 1;
    return 0;
  });

  const seen = new Set<string>();
  const unique: SampleRow[] = [];
  let collapsed = 0;
  for (const sample of sorted) {
    if (seen.has(sample.externalKey)) {
      collapsed += 1;
      continue;
    }
    seen.add(sample.externalKey);
    unique.push(sample);
  }

  const byDay = new Map<string, SampleRow[]>();
  for (const sample of unique) {
    const bucket = byDay.get(sample.localDate);
    if (bucket) bucket.push(sample);
    else byDay.set(sample.localDate, [sample]);
  }

  const rows: DailyMetricRow[] = [];
  for (const localDate of [...byDay.keys()].sort()) {
    const daySamples = byDay.get(localDate)!;
    const winner = daySamples[daySamples.length - 1]!;
    rows.push({
      metric: def.metric,
      localDate,
      hasData: true,
      value: winner.value,
      breakdown: {
        kind: "sample_collapse",
        rule: "last_of_civil_day",
        // Same order as the sort, so the breakdown -- and therefore the content
        // hash -- is byte-identical however the pages arrived.
        samples: daySamples.map((s) => ({
          t: s.physicalTime,
          o: s.utcOffsetSeconds,
          v: s.value,
          src: s.sourceIdentity,
        })),
      },
      sourceCount: daySamples.length,
    });
  }

  return { rows, collapsed };
}

// ---------------------------------------------------------------------------
// Sessions (`list`)
// ---------------------------------------------------------------------------

/**
 * One sleep or exercise session -> a health_sessions row.
 *
 * THE RULES THAT ARE NOT NEGOTIABLE HERE:
 *
 *  * durationSeconds is ALWAYS derived from the physical instants. Subtracting
 *    civil clock readings is wrong in both directions across a DST transition:
 *    it understates a fall-back night by an hour and overstates a spring-forward
 *    one by an hour. Sleep is the single most likely record in this system to
 *    span 02:00 local, so this is a real bug, not a theoretical one.
 *
 *  * A missing start, end, or either offset is a REJECTION. Those four columns
 *    are NOT NULL, and the tempting default -- offset 0 -- is not a neutral
 *    placeholder but a positive claim that the session happened in UTC. Once
 *    written it is indistinguishable from a genuine reading forever.
 *
 *  * attributedLocalDate goes through the ADR-049 helpers and nowhere else, so
 *    the wake-date rule lives in exactly one function repo-wide.
 */
export function translateSession(
  record: Record<string, unknown>,
  def: HealthMetricDefinition,
): Translated<SessionRow> {
  if (def.metric !== "sleep" && def.metric !== "exercise") {
    return fail("unsupported_session_metric", def.metric, def.metric);
  }

  // Sessions carry no HealthValueSpec (their value is a derived duration, not a
  // numeric leaf), so the container field is derived the same way value-spec
  // derives it -- one shared function, so the two can never disagree.
  const container = record[camelCase(def.googleDataType)];
  if (!isPlainObject(container)) {
    return fail("session_container_missing", def.googleDataType, container);
  }

  const interval = pickObject(container, RESPONSE_FIELDS.interval);
  if (interval === null) {
    return fail("session_interval_missing", `${def.metric}.interval`, container["interval"]);
  }

  const startAtIso = normalizeInstant(pickString(interval, RESPONSE_FIELDS.startTime));
  if (startAtIso === null) {
    return fail(
      "session_start_time_missing",
      `${def.metric}.interval.startTime`,
      interval["startTime"],
    );
  }
  const endAtIso = normalizeInstant(pickString(interval, RESPONSE_FIELDS.endTime));
  if (endAtIso === null) {
    return fail("session_end_time_missing", `${def.metric}.interval.endTime`, interval["endTime"]);
  }

  const civilStart = asCivilDateTime(pickObject(interval, RESPONSE_FIELDS.civilStartTime));
  if (civilStart === null) {
    return fail(
      "session_civil_start_missing",
      `${def.metric}.interval.civilStartTime`,
      interval["civilStartTime"],
    );
  }
  const civilEnd = asCivilDateTime(pickObject(interval, RESPONSE_FIELDS.civilEndTime));
  if (civilEnd === null) {
    return fail(
      "session_civil_end_missing",
      `${def.metric}.interval.civilEndTime`,
      interval["civilEndTime"],
    );
  }

  const rawStartOffset = pickString(interval, RESPONSE_FIELDS.startUtcOffset);
  const rawEndOffset = pickString(interval, RESPONSE_FIELDS.endUtcOffset);
  if (rawStartOffset === null) {
    return fail(
      "session_start_offset_missing",
      `${def.metric}.interval.${RESPONSE_FIELDS.startUtcOffset[0]}`,
      undefined,
    );
  }
  if (rawEndOffset === null) {
    return fail(
      "session_end_offset_missing",
      `${def.metric}.interval.${RESPONSE_FIELDS.endUtcOffset[0]}`,
      undefined,
    );
  }
  let startUtcOffsetSeconds: number;
  let endUtcOffsetSeconds: number;
  try {
    startUtcOffsetSeconds = parseGoogleDuration(rawStartOffset);
    endUtcOffsetSeconds = parseGoogleDuration(rawEndOffset);
  } catch {
    return fail("session_utc_offset_invalid", `${def.metric}.interval`, rawStartOffset);
  }

  const startAt = new Date(startAtIso);
  const endAt = new Date(endAtIso);
  const elapsedMs = endAt.getTime() - startAt.getTime();
  if (elapsedMs < 0) {
    // health_sessions CHECKs end_at >= start_at and duration_seconds >= 0, so
    // an inverted interval could only ever be a failed INSERT. Rejecting it
    // here keeps it a counted rejection rather than a dead-lettered batch.
    return fail("session_interval_inverted", `${def.metric}.interval`, endAtIso);
  }
  // Instants are millisecond-precision; the column is whole seconds. Rounding
  // the ELAPSED span is not a precision loss in the sense that matters -- both
  // endpoints are stored exactly, so the span is always re-derivable.
  const durationSeconds = Math.round(elapsedMs / 1000);

  // Axis from the catalog, never a metric-name comparison -- the sweep in
  // apps/worker reads the same field, so the two cannot drift apart.
  const attributedLocalDate =
    def.attributionAxis === "civil_end"
      ? attributeSleepLocalDate(civilEnd)
      : attributeExerciseLocalDate(civilStart);

  const dataPointName = readDataPointName(record);
  const sourceIdentity = readSourceIdentity(record);
  const sessionType = pickString(container, RESPONSE_FIELDS.sessionType);
  const sessionSubtype = pickString(container, RESPONSE_FIELDS.sessionSubtype);

  const key = sessionKey({
    dataPointName,
    metric: def.metric,
    startTime: startAtIso,
    endTime: endAtIso,
    sessionType,
    sessionSubtype,
    ...sourceIdentity,
  });

  return {
    ok: true,
    row: {
      metric: def.metric,
      externalKey: key.key,
      externalKeySource: key.source,
      dataPointName,
      attributedLocalDate,
      civilStartLocal: civilDateTimeToNaiveDate(civilStart),
      civilEndLocal: civilDateTimeToNaiveDate(civilEnd),
      startAt,
      endAt,
      startUtcOffsetSeconds,
      endUtcOffsetSeconds,
      durationSeconds,
      // Allowlisted scalars only. The raw record never reaches jsonb.
      detail: { source: sourceIdentity, sessionType, sessionSubtype },
      providerCreatedAt: normalizeInstant(pickString(record, RESPONSE_FIELDS.createTime)),
      providerUpdatedAt: normalizeInstant(pickString(record, RESPONSE_FIELDS.updateTime)),
    },
  };
}

// ---------------------------------------------------------------------------
// Content-hash inputs
// ---------------------------------------------------------------------------

/** A naive Date's wall clock, read back through its UTC getters. */
function naiveLocalString(date: Date): string {
  return date.toISOString().slice(0, 19);
}

/**
 * The exact object to hash for a daily row.
 *
 * Exists so the worker cannot drift from this definition by hashing "the row"
 * and quietly including or excluding a field. Identity (connection, metric,
 * local date) is the lookup key rather than content, but metric and localDate
 * are still included: they are cheap, and a hash that is meaningless outside
 * its own key is a hash that cannot be compared across a bug.
 */
export function dailyContentInput(row: DailyMetricRow): Record<string, unknown> {
  return {
    metric: row.metric,
    localDate: row.localDate,
    hasData: row.hasData,
    value: row.value,
    breakdown: row.breakdown,
    sourceCount: row.sourceCount,
  };
}

/**
 * The exact object to hash for a session row.
 *
 * TWO THINGS THIS GETS RIGHT THAT ARE EASY TO GET WRONG:
 *
 *  1. PROVIDER TIMESTAMPS ARE PART OF THE CONTENT. createTime/updateTime are
 *     stored on the row, so excluding them from the hash would let a session
 *     whose only upstream change was an updateTime bump register as unchanged
 *     -- leaving a stale provider timestamp in the database forever while the
 *     run reports rows_unchanged. Including them means an identical payload
 *     writes nothing and an updateTime-only change writes exactly one update.
 *
 *  2. EVERY Date IS FLATTENED TO A STRING FIRST. contentHash's stable
 *     stringifier walks objects with Object.entries, and a Date has no own
 *     enumerable properties -- so a Date reaching it hashes as `{}`, silently
 *     collapsing every distinct timestamp into one value. That failure is
 *     invisible: hashes still compute, rows still compare, and changes are
 *     simply never noticed. This conversion is the guard, and it is pinned by
 *     a test.
 *
 * externalKey and externalKeySource are excluded: they are the identity under
 * which the row is looked up, not part of what changed.
 */
export function sessionContentInput(row: SessionRow): Record<string, unknown> {
  return {
    metric: row.metric,
    attributedLocalDate: row.attributedLocalDate,
    civilStartLocal: naiveLocalString(row.civilStartLocal),
    civilEndLocal: naiveLocalString(row.civilEndLocal),
    startAt: row.startAt.toISOString(),
    endAt: row.endAt.toISOString(),
    startUtcOffsetSeconds: row.startUtcOffsetSeconds,
    endUtcOffsetSeconds: row.endUtcOffsetSeconds,
    durationSeconds: row.durationSeconds,
    detail: row.detail,
    providerCreatedAt: row.providerCreatedAt,
    providerUpdatedAt: row.providerUpdatedAt,
  };
}
