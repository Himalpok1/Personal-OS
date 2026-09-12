// SYNTHETIC payloads only. Not one byte here came from a real account.
//
// Real health data must never enter this repository -- not in a fixture, not in
// a snapshot, not "anonymized". Every value below is invented, and the civil
// dates are chosen to exercise boundaries (month ends, DST weekends) rather
// than to resemble anyone's week.
//
// AND THE HONEST CAVEAT, because it decides what a green suite is worth: these
// shapes are transcribed from the same documentation as value-spec.ts. They are
// therefore fixture/spec SELF-CONSISTENCY, not evidence about Google -- except
// where a builder says otherwise. The rollup builders and the sleep session
// follow shapes observed live at 6.3L, and heartRateVariabilityRecord follows
// the shape observed at 9.0. No body-sample payload has been observed at all.

/** A google.type.Date from "YYYY-MM-DD". */
export function googleDate(localDate: string): { year: number; month: number; day: number } {
  const [y, m, d] = localDate.split("-").map(Number);
  return { year: y!, month: m!, day: d! };
}

/** A CivilDateTime from "YYYY-MM-DD" plus an optional wall clock. */
export function civilDateTime(
  localDate: string,
  hours = 0,
  minutes = 0,
  seconds = 0,
): { date: { year: number; month: number; day: number }; time: Record<string, number> } {
  return { date: googleDate(localDate), time: { hours, minutes, seconds } };
}

/** A dailyRollUp bucket. int64 leaves arrive as STRINGS, per protobuf JSON. */
// Leaf names below are the OBSERVED live rollup shapes (Checkpoint 6.3L):
// dailyRollUp appends an aggregation suffix, and the prefix is the bare unit
// noun -- `total-calories` has unit `caloriesKcal` but leaf `kcalSum`.
export function stepsBucket(localDate: string, count: string): Record<string, unknown> {
  return {
    civilStartTime: civilDateTime(localDate),
    civilEndTime: civilDateTime(localDate, 24),
    steps: { countSum: count },
  };
}

/** A dailyRollUp bucket for a double-typed metric. */
export function caloriesBucket(localDate: string, kcal: number): Record<string, unknown> {
  return {
    civilStartTime: civilDateTime(localDate),
    civilEndTime: civilDateTime(localDate, 24),
    totalCalories: { kcalSum: kcal },
  };
}

/** A dailyRollUp bucket carrying an allowlisted zone breakdown. */
export function zoneMinutesBucket(
  localDate: string,
  total: string,
  zones: Record<string, unknown>,
): Record<string, unknown> {
  return {
    civilStartTime: civilDateTime(localDate),
    civilEndTime: civilDateTime(localDate, 24),
    activeZoneMinutes: { minutesSum: total, ...zones },
  };
}

/** A Google-precomputed Daily record, which carries its own bare date. */
export function restingHeartRateRecord(
  localDate: string,
  bpm: number | string,
): Record<string, unknown> {
  return {
    dailyRestingHeartRate: { date: googleDate(localDate), beatsPerMinute: bpm },
  };
}

/**
 * A Google-precomputed DailyHeartRateVariability record, in the EXACT shape
 * observed live on 2026-09-12 (Checkpoint 9.0) -- field names and JSON kinds
 * only; every value below is invented.
 *
 * The observed record carried `averageHeartRateVariabilityMilliseconds` and
 * `deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds`, both JSON
 * numbers, plus a `dataSource` whose `platform` sits at the dataSource ROOT
 * (not under `application`, where readSourceIdentity looks) alongside
 * `application.packageName` and `device.manufacturer`. The dataSource is
 * reproduced faithfully so a test can prove the daily path ignores it, and
 * so the observed provenance shape is on record for the session/sample paths
 * that do read it. `deepSleepRmssd` may be omitted to model a record carrying
 * the average alone.
 */
export function heartRateVariabilityRecord(opts: {
  localDate: string;
  averageRmssd: number | string;
  deepSleepRmssd?: number | string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const container: Record<string, unknown> = {
    date: googleDate(opts.localDate),
    averageHeartRateVariabilityMilliseconds: opts.averageRmssd,
  };
  if (opts.deepSleepRmssd !== undefined) {
    container["deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds"] = opts.deepSleepRmssd;
  }
  return {
    dailyHeartRateVariability: { ...container, ...(opts.extra ?? {}) },
    dataSource: {
      application: { packageName: "com.example.wearable" },
      device: { manufacturer: "Example" },
      platform: "ANDROID",
      recordingMethod: "AUTOMATICALLY_RECORDED",
    },
  };
}

export interface SourceFixture {
  recordingMethod?: string;
  formFactor?: string;
  platform?: string;
}

function dataSource(source: SourceFixture): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (source.recordingMethod !== undefined) out["recordingMethod"] = source.recordingMethod;
  if (source.formFactor !== undefined) out["device"] = { formFactor: source.formFactor };
  if (source.platform !== undefined) out["application"] = { platform: source.platform };
  return out;
}

/** An episodic weight sample. */
export function weightSample(opts: {
  localDate: string;
  hours?: number;
  minutes?: number;
  physicalTime: string;
  utcOffset: string;
  grams: string | number;
  source?: SourceFixture;
  dataPointName?: string;
  extra?: Record<string, unknown>;
}): Record<string, unknown> {
  const record: Record<string, unknown> = {
    weight: {
      weightGrams: opts.grams,
      sampleTime: {
        physicalTime: opts.physicalTime,
        civilTime: civilDateTime(opts.localDate, opts.hours ?? 7, opts.minutes ?? 0),
        utcOffset: opts.utcOffset,
      },
      ...(opts.extra ?? {}),
    },
    dataSource: dataSource(opts.source ?? {}),
  };
  if (opts.dataPointName !== undefined) record["dataPointName"] = opts.dataPointName;
  return record;
}

/** A sleep session. Offsets use the primary candidate spelling. */
export function sleepSession(opts: {
  startLocalDate: string;
  endLocalDate: string;
  startHours?: number;
  endHours?: number;
  startTime: string;
  endTime: string;
  startUtcOffset?: string;
  endUtcOffset?: string;
  type?: string;
  source?: SourceFixture;
  dataPointName?: string;
  name?: string;
  createTime?: string;
  updateTime?: string;
}): Record<string, unknown> {
  const interval: Record<string, unknown> = {
    startTime: opts.startTime,
    endTime: opts.endTime,
    civilStartTime: civilDateTime(opts.startLocalDate, opts.startHours ?? 22, 41),
    civilEndTime: civilDateTime(opts.endLocalDate, opts.endHours ?? 6, 52),
  };
  if (opts.startUtcOffset !== undefined) interval["startTimeUtcOffset"] = opts.startUtcOffset;
  if (opts.endUtcOffset !== undefined) interval["endTimeUtcOffset"] = opts.endUtcOffset;

  const sleep: Record<string, unknown> = { interval };
  if (opts.type !== undefined) sleep["type"] = opts.type;

  const record: Record<string, unknown> = { sleep, dataSource: dataSource(opts.source ?? {}) };
  if (opts.dataPointName !== undefined) record["dataPointName"] = opts.dataPointName;
  if (opts.name !== undefined) record["name"] = opts.name;
  if (opts.createTime !== undefined) record["createTime"] = opts.createTime;
  if (opts.updateTime !== undefined) record["updateTime"] = opts.updateTime;
  return record;
}

/** An exercise session, attributed by its civil START date (ADR-049). */
export function exerciseSession(opts: {
  startLocalDate: string;
  endLocalDate: string;
  startHours?: number;
  endHours?: number;
  startTime: string;
  endTime: string;
  startUtcOffset?: string;
  endUtcOffset?: string;
  activityType?: string;
  source?: SourceFixture;
}): Record<string, unknown> {
  const interval: Record<string, unknown> = {
    startTime: opts.startTime,
    endTime: opts.endTime,
    civilStartTime: civilDateTime(opts.startLocalDate, opts.startHours ?? 23, 10),
    civilEndTime: civilDateTime(opts.endLocalDate, opts.endHours ?? 0, 5),
  };
  if (opts.startUtcOffset !== undefined) interval["startTimeUtcOffset"] = opts.startUtcOffset;
  if (opts.endUtcOffset !== undefined) interval["endTimeUtcOffset"] = opts.endUtcOffset;

  const exercise: Record<string, unknown> = { interval };
  if (opts.activityType !== undefined) exercise["activityType"] = opts.activityType;

  return { exercise, dataSource: dataSource(opts.source ?? {}) };
}
