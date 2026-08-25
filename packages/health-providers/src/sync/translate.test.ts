import { describe, expect, it } from "vitest";
import { getHealthMetric } from "../google-health-catalog.js";
import { contentHash } from "../identity.js";
import {
  caloriesBucket,
  exerciseSession,
  restingHeartRateRecord,
  sleepSession,
  stepsBucket,
  weightSample,
  zoneMinutesBucket,
} from "./__fixtures__/payloads.js";
import {
  civilFromInstant,
  collapseSamplesToDays,
  dailyContentInput,
  sessionContentInput,
  translateDailyListRecord,
  translateRollupBucket,
  translateSampleRecord,
  translateSession,
  type SampleRow,
} from "./translate.js";
import { getValueSpec } from "./value-spec.js";

const STEPS = getHealthMetric("steps");
const CALORIES = getHealthMetric("total-calories");
const ZONES = getHealthMetric("active-zone-minutes");
const RHR = getHealthMetric("daily-resting-heart-rate");
const WEIGHT = getHealthMetric("weight");
const SLEEP = getHealthMetric("sleep");
const EXERCISE = getHealthMetric("exercise");

function unwrap<T>(result: { ok: true; row: T } | { ok: false; rejection: unknown }): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result.rejection)}`);
  return result.row;
}

// ---------------------------------------------------------------------------

describe("translateRollupBucket", () => {
  it("takes local_date verbatim from civilStartTime (ADR-048)", () => {
    const row = unwrap(
      translateRollupBucket(stepsBucket("2026-08-18", "8123"), STEPS, getValueSpec("steps")),
    );
    expect(row).toEqual({
      metric: "steps",
      localDate: "2026-08-18",
      hasData: true,
      value: "8123",
      breakdown: null,
      sourceCount: null,
    });
  });

  // No instant is ever converted to a date -- a rollup bucket carries none at
  // all, which is exactly why health data stores no IANA timezone.
  it("never derives the date from an instant, so the process timezone is irrelevant", () => {
    const bucket = stepsBucket("2026-01-01", "1");
    expect(JSON.stringify(bucket)).not.toContain("Z");
    expect(unwrap(translateRollupBucket(bucket, STEPS, getValueSpec("steps"))).localDate).toBe(
      "2026-01-01",
    );
  });

  it("pads single-digit calendar components", () => {
    const row = unwrap(
      translateRollupBucket(stepsBucket("2026-01-05", "7"), STEPS, getValueSpec("steps")),
    );
    expect(row.localDate).toBe("2026-01-05");
  });

  it("carries a true zero through as a value", () => {
    const row = unwrap(
      translateRollupBucket(stepsBucket("2026-08-24", "0"), STEPS, getValueSpec("steps")),
    );
    expect(row).toMatchObject({ hasData: true, value: "0" });
  });

  it("reads a double metric", () => {
    const row = unwrap(
      translateRollupBucket(
        caloriesBucket("2026-08-18", 2143.5),
        CALORIES,
        getValueSpec("total-calories"),
      ),
    );
    expect(row).toMatchObject({ metric: "total-calories", value: "2143.5" });
  });

  it("carries an allowlisted breakdown", () => {
    const row = unwrap(
      translateRollupBucket(
        zoneMinutesBucket("2026-08-18", "42", { fatBurnMinutesSum: "30", peakMinutesSum: "2" }),
        ZONES,
        getValueSpec("active-zone-minutes"),
      ),
    );
    expect(row.breakdown).toEqual({ fatBurnMinutesSum: "30", peakMinutesSum: "2" });
  });

  it("rejects a bucket with no civil start date", () => {
    const spec = getValueSpec("steps");
    expect(translateRollupBucket({ steps: { countSum: "1" } }, STEPS, spec)).toMatchObject({
      ok: false,
      rejection: { code: "rollup_civil_start_missing", keyPath: "civilStartTime.date" },
    });
    expect(
      translateRollupBucket({ civilStartTime: {}, steps: { countSum: "1" } }, STEPS, spec),
    ).toMatchObject({ ok: false, rejection: { code: "rollup_civil_start_missing" } });
    expect(
      translateRollupBucket(
        { civilStartTime: { date: { year: 2026, month: 13, day: 1 } }, steps: { countSum: "1" } },
        STEPS,
        spec,
      ),
    ).toMatchObject({ ok: false, rejection: { code: "rollup_civil_start_missing" } });
  });

  it("propagates an extraction rejection unchanged", () => {
    expect(
      translateRollupBucket(stepsBucket("2026-08-18", "8.5"), STEPS, getValueSpec("steps")),
    ).toMatchObject({ ok: false, rejection: { code: "leaf_type_mismatch" } });
  });

  it("reports no source count, because a rollup reports no contributors", () => {
    expect(
      unwrap(translateRollupBucket(stepsBucket("2026-08-18", "1"), STEPS, getValueSpec("steps")))
        .sourceCount,
    ).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("translateDailyListRecord", () => {
  it("takes local_date from the record's own bare date", () => {
    const row = unwrap(
      translateDailyListRecord(
        restingHeartRateRecord("2026-08-20", 58.4),
        RHR,
        getValueSpec("daily-resting-heart-rate"),
      ),
    );
    expect(row).toEqual({
      metric: "daily-resting-heart-rate",
      localDate: "2026-08-20",
      hasData: true,
      value: "58.4",
      breakdown: null,
      sourceCount: null,
    });
  });

  it("accepts a double sent as a string", () => {
    expect(
      unwrap(
        translateDailyListRecord(
          restingHeartRateRecord("2026-08-20", "58.40"),
          RHR,
          getValueSpec("daily-resting-heart-rate"),
        ),
      ).value,
    ).toBe("58.4");
  });

  it("rejects a record with no date", () => {
    expect(
      translateDailyListRecord(
        { dailyRestingHeartRate: { beatsPerMinute: 58 } },
        RHR,
        getValueSpec("daily-resting-heart-rate"),
      ),
    ).toMatchObject({
      ok: false,
      rejection: { code: "daily_date_missing", keyPath: "dailyRestingHeartRate.date" },
    });
  });

  it("rejects a record with no container", () => {
    expect(
      translateDailyListRecord({}, RHR, getValueSpec("daily-resting-heart-rate")),
    ).toMatchObject({ ok: false, rejection: { code: "container_not_object" } });
  });

  // A record dated outside the chunk is the sync engine's rejection to count,
  // not something to clamp silently into range here.
  it("reports the record's own date even when it lies outside a requested window", () => {
    expect(
      unwrap(
        translateDailyListRecord(
          restingHeartRateRecord("2025-01-01", 58),
          RHR,
          getValueSpec("daily-resting-heart-rate"),
        ),
      ).localDate,
    ).toBe("2025-01-01");
  });
});

// ---------------------------------------------------------------------------

const SPEC_WEIGHT = getValueSpec("weight");

describe("translateSampleRecord", () => {
  const base = {
    localDate: "2026-08-24",
    physicalTime: "2026-08-24T12:30:00Z",
    utcOffset: "-18000s",
    grams: "70500",
  };

  it("reads value, civil date, instant, offset and source", () => {
    const row = unwrap(
      translateSampleRecord(
        weightSample({
          ...base,
          source: { recordingMethod: "AUTOMATICALLY_RECORDED", formFactor: "SCALE" },
        }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    expect(row).toMatchObject({
      metric: "weight",
      localDate: "2026-08-24",
      physicalTime: "2026-08-24T12:30:00.000Z",
      utcOffsetSeconds: -18000,
      value: "70500",
      sourceIdentity: {
        recordingMethod: "AUTOMATICALLY_RECORDED",
        deviceFormFactor: "SCALE",
        applicationPlatform: null,
      },
      externalKeySource: "list_derived",
    });
    expect(row.externalKey).toMatch(/^[0-9a-f]{64}$/);
  });

  // ADR-048 in miniature: a late-evening weigh-in belongs to its LOCAL day even
  // when UTC has already rolled over.
  it("dates a sample by its civil time, never by its instant", () => {
    const row = unwrap(
      translateSampleRecord(
        weightSample({
          localDate: "2026-08-24",
          hours: 23,
          minutes: 30,
          physicalTime: "2026-08-25T04:30:00Z",
          utcOffset: "-18000s",
          grams: "70500",
        }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    expect(row.localDate).toBe("2026-08-24");
    expect(row.physicalTime).toBe("2026-08-25T04:30:00.000Z");
  });

  it("normalizes equivalent instant spellings to one key", () => {
    const a = unwrap(
      translateSampleRecord(
        weightSample({ ...base, physicalTime: "2026-08-24T12:30:00Z" }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    const b = unwrap(
      translateSampleRecord(
        weightSample({ ...base, physicalTime: "2026-08-24T07:30:00-05:00" }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    expect(a.physicalTime).toBe(b.physicalTime);
    expect(a.externalKey).toBe(b.externalKey);
  });

  it("prefers a provider resource name over a derived key", () => {
    const row = unwrap(
      translateSampleRecord(
        weightSample({ ...base, dataPointName: "users/me/dataTypes/weight/dataPoints/q" }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    expect(row.externalKey).toBe("users/me/dataTypes/weight/dataPoints/q");
    expect(row.externalKeySource).toBe("data_point_name");
  });

  it("handles sub-hour offsets in whole seconds", () => {
    expect(
      unwrap(
        translateSampleRecord(weightSample({ ...base, utcOffset: "20700s" }), WEIGHT, SPEC_WEIGHT),
      ).utcOffsetSeconds,
    ).toBe(20700); // +05:45, Kathmandu
  });

  it("rejects a sample missing its civil time, instant or offset", () => {
    const strip = (path: string[]): Record<string, unknown> => {
      const record = weightSample(base);
      const container = record["weight"] as Record<string, unknown>;
      const sampleTime = container["sampleTime"] as Record<string, unknown>;
      for (const key of path) delete sampleTime[key];
      return record;
    };
    expect(translateSampleRecord(strip(["civilTime"]), WEIGHT, SPEC_WEIGHT)).toMatchObject({
      ok: false,
      rejection: { code: "sample_civil_time_missing" },
    });
    expect(translateSampleRecord(strip(["physicalTime"]), WEIGHT, SPEC_WEIGHT)).toMatchObject({
      ok: false,
      rejection: { code: "sample_physical_time_missing" },
    });
    expect(translateSampleRecord(strip(["utcOffset"]), WEIGHT, SPEC_WEIGHT)).toMatchObject({
      ok: false,
      rejection: { code: "sample_utc_offset_missing" },
    });
  });

  it("rejects an unparseable offset rather than defaulting it to zero", () => {
    expect(
      translateSampleRecord(weightSample({ ...base, utcOffset: "-5 hours" }), WEIGHT, SPEC_WEIGHT),
    ).toMatchObject({ ok: false, rejection: { code: "sample_utc_offset_invalid" } });
  });

  it("rejects an unparseable instant", () => {
    expect(
      translateSampleRecord(
        weightSample({ ...base, physicalTime: "yesterday morning" }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    ).toMatchObject({ ok: false, rejection: { code: "sample_physical_time_missing" } });
  });

  it("never copies an unexpected provider field into the row", () => {
    const row = unwrap(
      translateSampleRecord(
        weightSample({ ...base, extra: { access_token: "ya29.NOPE", note: "NOPE" } }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
    expect(JSON.stringify(row)).not.toContain("NOPE");
    expect(JSON.stringify(row)).not.toContain("access_token");
  });
});

// ---------------------------------------------------------------------------

describe("collapseSamplesToDays", () => {
  function sample(
    localDate: string,
    physicalTime: string,
    grams: string,
    source: { recordingMethod?: string; formFactor?: string } = {},
  ): SampleRow {
    return unwrap(
      translateSampleRecord(
        weightSample({ localDate, physicalTime, utcOffset: "-18000s", grams, source }),
        WEIGHT,
        SPEC_WEIGHT,
      ),
    );
  }

  const morning = sample("2026-08-24", "2026-08-24T12:30:00Z", "70500");
  const evening = sample("2026-08-24", "2026-08-24T23:30:00Z", "70100");
  const nextDay = sample("2026-08-25", "2026-08-25T12:30:00Z", "70300");

  it("keeps the last reading of the civil day", () => {
    const { rows } = collapseSamplesToDays([morning, evening], WEIGHT);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      metric: "weight",
      localDate: "2026-08-24",
      hasData: true,
      value: "70100",
      sourceCount: 2,
    });
  });

  it("emits one row per civil day, ordered by date", () => {
    const { rows } = collapseSamplesToDays([nextDay, evening, morning], WEIGHT);
    expect(rows.map((r) => r.localDate)).toEqual(["2026-08-24", "2026-08-25"]);
  });

  // THE ORDER-INDEPENDENCE PROOF. If page arrival order could change the
  // output, the content hash would flap and every sync would rewrite unchanged
  // rows -- destroying the whole "identical re-fetch writes nothing" property.
  it("is byte-identical under any page arrival order, hash included", () => {
    const all = [morning, evening, nextDay, sample("2026-08-25", "2026-08-25T06:00:00Z", "70900")];
    const orders = [
      [0, 1, 2, 3],
      [3, 2, 1, 0],
      [2, 0, 3, 1],
      [1, 3, 0, 2],
    ];
    const results = orders.map((order) =>
      JSON.stringify(
        collapseSamplesToDays(
          order.map((i) => all[i]!),
          WEIGHT,
        ),
      ),
    );
    expect(new Set(results).size).toBe(1);

    const hashes = orders.map((order) =>
      collapseSamplesToDays(
        order.map((i) => all[i]!),
        WEIGHT,
      ).rows.map((r) => contentHash(dailyContentInput(r))),
    );
    for (const h of hashes) expect(h).toEqual(hashes[0]);
  });

  it("records the collapse rule and the contributing samples in order", () => {
    const { rows } = collapseSamplesToDays([evening, morning], WEIGHT);
    expect(rows[0]!.breakdown).toEqual({
      kind: "sample_collapse",
      rule: "last_of_civil_day",
      samples: [
        {
          t: "2026-08-24T12:30:00.000Z",
          o: -18000,
          v: "70500",
          src: { recordingMethod: null, deviceFormFactor: null, applicationPlatform: null },
        },
        {
          t: "2026-08-24T23:30:00.000Z",
          o: -18000,
          v: "70100",
          src: { recordingMethod: null, deviceFormFactor: null, applicationPlatform: null },
        },
      ],
    });
  });

  it("de-duplicates on the external key, not on timestamp and value", () => {
    const { rows, collapsed } = collapseSamplesToDays([morning, { ...morning }], WEIGHT);
    expect(collapsed).toBe(1);
    expect(rows[0]!.sourceCount).toBe(1);
  });

  // The counterpart, and the reason the key folds in source identity: two real
  // sources agreeing exactly must remain TWO samples.
  it("keeps two distinct sources that agree on timestamp and value", () => {
    const scale = sample("2026-08-24", "2026-08-24T12:30:00Z", "70500", { formFactor: "SCALE" });
    const phone = sample("2026-08-24", "2026-08-24T12:30:00Z", "70500", { formFactor: "PHONE" });
    const { rows, collapsed } = collapseSamplesToDays([scale, phone], WEIGHT);
    expect(collapsed).toBe(0);
    expect(rows[0]!.sourceCount).toBe(2);
  });

  // rows_collapsed means KEY COLLISIONS, per health-sync-runs.ts. Many samples
  // folding into one day is normal and is reported by sourceCount instead.
  it("never reports a normal multi-sample day as a collapse", () => {
    expect(collapseSamplesToDays([morning, evening, nextDay], WEIGHT).collapsed).toBe(0);
  });

  it("returns nothing for no samples", () => {
    expect(collapseSamplesToDays([], WEIGHT)).toEqual({ rows: [], collapsed: 0 });
  });

  it("does not mutate its input array", () => {
    const input = [nextDay, morning, evening];
    const snapshot = [...input];
    collapseSamplesToDays(input, WEIGHT);
    expect(input).toEqual(snapshot);
  });
});

// ---------------------------------------------------------------------------

describe("translateSession", () => {
  const NIGHT = {
    startLocalDate: "2026-08-23",
    endLocalDate: "2026-08-24",
    startTime: "2026-08-24T03:41:00Z",
    endTime: "2026-08-24T11:52:00Z",
    startUtcOffset: "-18000s",
    endUtcOffset: "-18000s",
  };

  it("attributes sleep to its civil END (wake) date, per ADR-049", () => {
    const row = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    expect(row.attributedLocalDate).toBe("2026-08-24");
    expect(row.metric).toBe("sleep");
  });

  it("attributes exercise to its civil START date", () => {
    const row = unwrap(
      translateSession(
        exerciseSession({
          startLocalDate: "2026-08-23",
          endLocalDate: "2026-08-24",
          startTime: "2026-08-24T04:10:00Z",
          endTime: "2026-08-24T05:05:00Z",
          startUtcOffset: "-18000s",
          endUtcOffset: "-18000s",
        }),
        EXERCISE,
      ),
    );
    // A run STARTED at 23:10 Sunday is a Sunday run, even though it ends Monday.
    expect(row.attributedLocalDate).toBe("2026-08-23");
  });

  it("stores both civil wall clocks and both physical instants", () => {
    const row = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    expect(row.civilStartLocal.toISOString()).toBe("2026-08-23T22:41:00.000Z");
    expect(row.civilEndLocal.toISOString()).toBe("2026-08-24T06:52:00.000Z");
    expect(row.startAt.toISOString()).toBe("2026-08-24T03:41:00.000Z");
    expect(row.endAt.toISOString()).toBe("2026-08-24T11:52:00.000Z");
    expect(row.startUtcOffsetSeconds).toBe(-18000);
  });

  it("derives duration from the physical instants", () => {
    expect(unwrap(translateSession(sleepSession(NIGHT), SLEEP)).durationSeconds).toBe(
      8 * 3600 + 11 * 60,
    );
  });

  // THE DST TEST. Civil-clock subtraction understates a fall-back night by an
  // hour; the physical instants are the only correct source. America/Chicago
  // fell back at 02:00 local on 2026-11-01.
  it("is correct across a DST fall-back, where civil subtraction understates by an hour", () => {
    const row = unwrap(
      translateSession(
        sleepSession({
          startLocalDate: "2026-10-31",
          endLocalDate: "2026-11-01",
          startHours: 23,
          endHours: 6,
          startTime: "2026-11-01T04:00:00Z", // 23:00 CDT (-05:00)
          endTime: "2026-11-01T12:00:00Z", // 06:00 CST (-06:00)
          startUtcOffset: "-18000s",
          endUtcOffset: "-21600s",
        }),
        SLEEP,
      ),
    );
    // Civil clocks read 23:00 -> 06:00, which looks like 7 hours. It was 8.
    expect(row.durationSeconds).toBe(8 * 3600);
    expect(row.startUtcOffsetSeconds).toBe(-18000);
    expect(row.endUtcOffsetSeconds).toBe(-21600);
  });

  it("is correct across a DST spring-forward, where civil subtraction overstates", () => {
    const row = unwrap(
      translateSession(
        sleepSession({
          startLocalDate: "2026-03-07",
          endLocalDate: "2026-03-08",
          startHours: 23,
          endHours: 6,
          startTime: "2026-03-08T05:00:00Z", // 23:00 CST (-06:00)
          endTime: "2026-03-08T11:00:00Z", // 06:00 CDT (-05:00)
          startUtcOffset: "-21600s",
          endUtcOffset: "-18000s",
        }),
        SLEEP,
      ),
    );
    // Civil clocks read 23:00 -> 06:00, which looks like 7 hours. It was 6.
    expect(row.durationSeconds).toBe(6 * 3600);
  });

  // PINS THE FIELD-NAME TRAP. ApiDataPoint declares `name`, but the live F5
  // capture reads `dataPointName`, and the index signature means TypeScript
  // cannot catch reading the wrong one. Both are accepted; dataPointName wins.
  it("reads dataPointName first, falling back to name", () => {
    expect(
      unwrap(translateSession(sleepSession({ ...NIGHT, dataPointName: "dpn/1" }), SLEEP)),
    ).toMatchObject({ externalKey: "dpn/1", externalKeySource: "data_point_name" });

    expect(unwrap(translateSession(sleepSession({ ...NIGHT, name: "nm/1" }), SLEEP))).toMatchObject(
      { externalKey: "nm/1", externalKeySource: "data_point_name" },
    );

    expect(
      unwrap(
        translateSession(sleepSession({ ...NIGHT, dataPointName: "dpn/1", name: "nm/1" }), SLEEP),
      ).externalKey,
    ).toBe("dpn/1");
  });

  it("derives a key when the provider supplies no name", () => {
    const row = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    expect(row.externalKeySource).toBe("list_derived");
    expect(row.externalKey).toMatch(/^[0-9a-f]{64}$/);
    expect(row.dataPointName).toBeNull();
  });

  it("separates two sources recording the identical interval", () => {
    const watch = unwrap(
      translateSession(sleepSession({ ...NIGHT, source: { formFactor: "WATCH" } }), SLEEP),
    );
    const phone = unwrap(
      translateSession(sleepSession({ ...NIGHT, source: { formFactor: "PHONE" } }), SLEEP),
    );
    expect(watch.externalKey).not.toBe(phone.externalKey);
  });

  // NEVER SYNTHESIZE. These four columns are NOT NULL, and offset 0 is not a
  // neutral placeholder -- it is a claim that the session happened in UTC.
  it("rejects a session missing a start, an end, or either offset", () => {
    const cases: [Record<string, unknown>, string][] = [
      [sleepSession({ ...NIGHT, startTime: "" }), "session_start_time_missing"],
      [sleepSession({ ...NIGHT, endTime: "" }), "session_end_time_missing"],
      [sleepSession({ ...NIGHT, startUtcOffset: undefined }), "session_start_offset_missing"],
      [sleepSession({ ...NIGHT, endUtcOffset: undefined }), "session_end_offset_missing"],
    ];
    for (const [record, code] of cases) {
      expect(translateSession(record, SLEEP)).toMatchObject({ ok: false, rejection: { code } });
    }
  });

  it("rejects an unparseable offset rather than defaulting it", () => {
    expect(
      translateSession(sleepSession({ ...NIGHT, startUtcOffset: "-5h" }), SLEEP),
    ).toMatchObject({ ok: false, rejection: { code: "session_utc_offset_invalid" } });
  });

  // This previously asserted that a session missing its civil bounds is
  // REJECTED. The Checkpoint 6.3L live proof disproved the premise: the one
  // real sleep record on this account carries startTime/startUtcOffset/
  // endTime/endUtcOffset and no civil times at all, so rejecting would have
  // discarded it. Instant + explicit offset is lossless arithmetic, not the
  // timezone guess ADR-048 forbids, and both inputs are stored on the row.
  it("derives the civil bounds when the provider omits them", () => {
    const record = sleepSession(NIGHT);
    const interval = (record["sleep"] as Record<string, unknown>)["interval"] as Record<
      string,
      unknown
    >;
    const withCivil = translateSession(sleepSession(NIGHT), SLEEP);
    delete interval["civilEndTime"];
    delete interval["civilStartTime"];
    const derived = translateSession(record, SLEEP);

    expect(derived.ok).toBe(true);
    expect(withCivil.ok).toBe(true);
    if (!derived.ok || !withCivil.ok) return;
    // The derivation reproduces exactly what the provider would have sent.
    expect(derived.row.attributedLocalDate).toBe(withCivil.row.attributedLocalDate);
    expect(derived.row.civilStartLocal.toISOString()).toBe(
      withCivil.row.civilStartLocal.toISOString(),
    );
    expect(derived.row.civilEndLocal.toISOString()).toBe(withCivil.row.civilEndLocal.toISOString());
  });

  it("rejects a session with no container or no interval", () => {
    expect(translateSession({}, SLEEP)).toMatchObject({
      ok: false,
      rejection: { code: "session_container_missing" },
    });
    expect(translateSession({ sleep: {} }, SLEEP)).toMatchObject({
      ok: false,
      rejection: { code: "session_interval_missing" },
    });
  });

  it("rejects an inverted interval, which the CHECK constraint would refuse anyway", () => {
    expect(
      translateSession(
        sleepSession({
          ...NIGHT,
          startTime: "2026-08-24T11:52:00Z",
          endTime: "2026-08-24T03:41:00Z",
        }),
        SLEEP,
      ),
    ).toMatchObject({ ok: false, rejection: { code: "session_interval_inverted" } });
  });

  it("accepts a zero-length session, which the CHECK permits", () => {
    const row = unwrap(
      translateSession(
        sleepSession({
          ...NIGHT,
          startTime: "2026-08-24T03:41:00Z",
          endTime: "2026-08-24T03:41:00Z",
        }),
        SLEEP,
      ),
    );
    expect(row.durationSeconds).toBe(0);
  });

  it("refuses a metric that is not a session", () => {
    expect(translateSession(sleepSession(NIGHT), STEPS)).toMatchObject({
      ok: false,
      rejection: { code: "unsupported_session_metric" },
    });
  });

  it("stores detail as an allowlist and never the raw payload", () => {
    const record = sleepSession({ ...NIGHT, type: "NAP", source: { platform: "ANDROID" } });
    (record["sleep"] as Record<string, unknown>)["access_token"] = "ya29.NOPE";
    record["secretNote"] = "NOPE";
    const row = unwrap(translateSession(record, SLEEP));
    expect(row.detail).toEqual({
      source: {
        recordingMethod: null,
        deviceFormFactor: null,
        applicationPlatform: "ANDROID",
      },
      sessionType: "NAP",
      sessionSubtype: null,
    });
    expect(JSON.stringify(row)).not.toContain("NOPE");
  });

  it("normalizes provider timestamps, or records their absence", () => {
    const row = unwrap(
      translateSession(
        sleepSession({
          ...NIGHT,
          createTime: "2026-08-24T12:00:00Z",
          updateTime: "2026-08-24T13:00:00.500Z",
        }),
        SLEEP,
      ),
    );
    expect(row.providerCreatedAt).toBe("2026-08-24T12:00:00.000Z");
    expect(row.providerUpdatedAt).toBe("2026-08-24T13:00:00.500Z");

    const bare = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    expect(bare.providerCreatedAt).toBeNull();
    expect(bare.providerUpdatedAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("content hashing input", () => {
  const NIGHT = {
    startLocalDate: "2026-08-23",
    endLocalDate: "2026-08-24",
    startTime: "2026-08-24T03:41:00Z",
    endTime: "2026-08-24T11:52:00Z",
    startUtcOffset: "-18000s",
    endUtcOffset: "-18000s",
    createTime: "2026-08-24T12:00:00Z",
    updateTime: "2026-08-24T12:00:00Z",
  };

  it("hashes an identical payload identically -- zero writes", () => {
    const a = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    const b = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    expect(contentHash(sessionContentInput(a))).toBe(contentHash(sessionContentInput(b)));
  });

  // THE USER-MANDATED CORRECTION. Provider timestamps must not be allowed to go
  // stale: an updateTime-only change is a real change and must write exactly
  // one update, not register as unchanged.
  it("changes when only updateTime changes", () => {
    const a = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    const b = unwrap(
      translateSession(sleepSession({ ...NIGHT, updateTime: "2026-08-25T09:00:00Z" }), SLEEP),
    );
    expect(a.externalKey).toBe(b.externalKey); // same row...
    expect(contentHash(sessionContentInput(a))).not.toBe(contentHash(sessionContentInput(b)));
  });

  it("changes when createTime changes", () => {
    const a = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    const b = unwrap(
      translateSession(sleepSession({ ...NIGHT, createTime: "2026-08-01T00:00:00Z" }), SLEEP),
    );
    expect(contentHash(sessionContentInput(a))).not.toBe(contentHash(sessionContentInput(b)));
  });

  // THE Date TRAP, PINNED. contentHash's stable stringifier walks objects with
  // Object.entries; a Date has no own enumerable properties, so a Date reaching
  // it hashes as `{}` -- silently collapsing every distinct timestamp into one
  // value, invisibly. Flattening to strings first is the guard.
  it("carries no Date, because a Date would hash as an empty object", () => {
    const row = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    for (const value of Object.values(sessionContentInput(row))) {
      expect(value).not.toBeInstanceOf(Date);
    }
    // The failure this prevents, demonstrated directly.
    expect(contentHash({ t: new Date("2026-01-01T00:00:00Z") })).toBe(
      contentHash({ t: new Date("2030-06-06T00:00:00Z") }),
    );
    expect(contentHash(sessionContentInput(row))).not.toBe(
      contentHash(
        sessionContentInput(
          unwrap(
            translateSession(sleepSession({ ...NIGHT, endTime: "2026-08-24T11:53:00Z" }), SLEEP),
          ),
        ),
      ),
    );
  });

  it("changes when a civil wall clock changes even though the instant does not", () => {
    const a = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    const b = unwrap(translateSession(sleepSession({ ...NIGHT, endHours: 7 }), SLEEP));
    expect(contentHash(sessionContentInput(a))).not.toBe(contentHash(sessionContentInput(b)));
  });

  it("excludes the external key, which is identity rather than content", () => {
    const row = unwrap(translateSession(sleepSession(NIGHT), SLEEP));
    const input = sessionContentInput(row);
    expect(input).not.toHaveProperty("externalKey");
    expect(input).not.toHaveProperty("externalKeySource");
  });

  it("hashes a daily row on exactly its stored fields", () => {
    const row = unwrap(
      translateRollupBucket(stepsBucket("2026-08-18", "8123"), STEPS, getValueSpec("steps")),
    );
    expect(Object.keys(dailyContentInput(row)).sort()).toEqual([
      "breakdown",
      "hasData",
      "localDate",
      "metric",
      "sourceCount",
      "value",
    ]);
    const same = unwrap(
      translateRollupBucket(stepsBucket("2026-08-18", "8123"), STEPS, getValueSpec("steps")),
    );
    expect(contentHash(dailyContentInput(row))).toBe(contentHash(dailyContentInput(same)));
    const changed = unwrap(
      translateRollupBucket(stepsBucket("2026-08-18", "8124"), STEPS, getValueSpec("steps")),
    );
    expect(contentHash(dailyContentInput(row))).not.toBe(contentHash(dailyContentInput(changed)));
  });

  // Numerically-equal representations must not churn the hash: a provider that
  // starts sending "8123.0" has not changed the user's step count.
  it("does not churn when only the numeric representation changes", () => {
    const a = unwrap(
      translateRollupBucket(
        caloriesBucket("2026-08-18", 2143.5),
        CALORIES,
        getValueSpec("total-calories"),
      ),
    );
    const b = unwrap(
      translateRollupBucket(
        { ...caloriesBucket("2026-08-18", 0), totalCalories: { kcalSum: "2143.50" } },
        CALORIES,
        getValueSpec("total-calories"),
      ),
    );
    expect(contentHash(dailyContentInput(a))).toBe(contentHash(dailyContentInput(b)));
  });
});

describe("sessions without civil times (Checkpoint 6.3L live finding)", () => {
  // The one real sleep record this account holds carries
  // interval.startTime / startUtcOffset / endTime / endUtcOffset and NO
  // civilStartTime or civilEndTime. Requiring them rejected it outright.
  //
  // SYNTHETIC record built from the observed SHAPE only.
  const SLEEP = getHealthMetric("sleep");

  function liveShapedSleep(): Record<string, unknown> {
    return {
      name: "users/me/dataTypes/sleep/dataPoints/synthetic-1",
      dataSource: { recordingMethod: "AUTOMATICALLY_RECORDED", platform: "ANDROID" },
      sleep: {
        interval: {
          startTime: "2026-04-29T04:12:00Z",
          startUtcOffset: "-18000s",
          endTime: "2026-04-29T12:40:00Z",
          endUtcOffset: "-18000s",
        },
        type: "SLEEP",
        createTime: "2026-04-29T13:00:00Z",
        updateTime: "2026-04-29T13:00:00Z",
      },
    };
  }

  it("derives the civil clock from the instant and its explicit offset", () => {
    const r = translateSession(liveShapedSleep(), SLEEP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // 04:12Z at -05:00 is 23:12 on the PREVIOUS local day; 12:40Z is 07:40 local.
    expect(r.row.attributedLocalDate).toBe("2026-04-29");
    expect(r.row.startUtcOffsetSeconds).toBe(-18000);
    expect(r.row.endUtcOffsetSeconds).toBe(-18000);
  });

  it("attributes the session to its WAKE date, which differs from its start date", () => {
    const r = translateSession(liveShapedSleep(), SLEEP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Started 2026-04-28 local, woke 2026-04-29 local (ADR-049).
    expect(r.row.civilStartLocal.toISOString().slice(0, 10)).toBe("2026-04-28");
    expect(r.row.attributedLocalDate).toBe("2026-04-29");
  });

  it("uses the provider's civil times verbatim when they ARE present", () => {
    const rec = liveShapedSleep();
    const interval = (rec["sleep"] as Record<string, unknown>)["interval"] as Record<
      string,
      unknown
    >;
    interval["civilStartTime"] = { date: { year: 2030, month: 1, day: 1 }, time: { hours: 1 } };
    interval["civilEndTime"] = { date: { year: 2030, month: 1, day: 2 }, time: { hours: 2 } };
    const r = translateSession(rec, SLEEP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Verbatim wins over derivation.
    expect(r.row.attributedLocalDate).toBe("2030-01-02");
  });

  it("takes the resource name as a STABLE key, so tombstoning is reachable", () => {
    const r = translateSession(liveShapedSleep(), SLEEP);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.externalKeySource).toBe("data_point_name");
  });

  it("still rejects when an offset is absent -- zero is never assumed", () => {
    const rec = liveShapedSleep();
    const interval = (rec["sleep"] as Record<string, unknown>)["interval"] as Record<
      string,
      unknown
    >;
    delete interval["startUtcOffset"];
    const r = translateSession(rec, SLEEP);
    expect(r.ok).toBe(false);
  });
});

describe("civilFromInstant", () => {
  it("shifts an instant by its offset and reads the local wall clock", () => {
    expect(civilFromInstant("2026-08-24T05:00:00Z", -18000)).toEqual({
      date: { year: 2026, month: 8, day: 24 },
      time: { hours: 0, minutes: 0, seconds: 0 },
    });
  });

  it("handles a positive offset that rolls the date forward", () => {
    expect(civilFromInstant("2026-08-24T23:30:00Z", 12 * 3600).date).toEqual({
      year: 2026,
      month: 8,
      day: 25,
    });
  });

  it("handles a 45-minute offset (Kathmandu +05:45)", () => {
    expect(civilFromInstant("2026-08-24T00:00:00Z", 5 * 3600 + 45 * 60).time).toMatchObject({
      hours: 5,
      minutes: 45,
    });
  });
});

describe("provider timestamps live on the container (Checkpoint 6.3L)", () => {
  const SLEEP2 = getHealthMetric("sleep");
  function rec(where: "container" | "root"): Record<string, unknown> {
    const sleep: Record<string, unknown> = {
      interval: {
        startTime: "2026-04-29T04:12:00Z",
        startUtcOffset: "-18000s",
        endTime: "2026-04-29T12:40:00Z",
        endUtcOffset: "-18000s",
      },
    };
    const base: Record<string, unknown> = { name: "users/me/x/1", sleep };
    if (where === "container") {
      sleep["createTime"] = "2026-04-29T13:00:00Z";
      sleep["updateTime"] = "2026-04-30T09:00:00Z";
    } else {
      base["createTime"] = "2026-04-29T13:00:00Z";
      base["updateTime"] = "2026-04-30T09:00:00Z";
    }
    return base;
  }

  it("reads them from the container, which is where the live payload puts them", () => {
    const r = translateSession(rec("container"), SLEEP2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.providerUpdatedAt).toBe("2026-04-30T09:00:00.000Z");
  });

  it("still reads them from the record root when they appear there", () => {
    const r = translateSession(rec("root"), SLEEP2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.row.providerUpdatedAt).toBe("2026-04-30T09:00:00.000Z");
  });

  it("keeps them in the hashed content, so an updateTime-only change is detected", () => {
    const a = translateSession(rec("container"), SLEEP2);
    const bRec = rec("container");
    (bRec["sleep"] as Record<string, unknown>)["updateTime"] = "2026-05-01T09:00:00Z";
    const b = translateSession(bRec, SLEEP2);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(JSON.stringify(sessionContentInput(a.row))).not.toBe(
      JSON.stringify(sessionContentInput(b.row)),
    );
  });
});
