import { describe, expect, it } from "vitest";
import { getHealthMetric, HEALTH_METRICS } from "../google-health-catalog.js";
import { heartRateVariabilityRecord } from "./__fixtures__/payloads.js";
import { extractValue } from "./extract.js";
import {
  camelCase,
  getValueSpec,
  HEALTH_VALUE_SPECS,
  IN_SCOPE_METRICS,
  OBSERVED_LEAF_METRICS,
} from "./value-spec.js";

describe("coverage", () => {
  // THE LOAD-BEARING TEST. Adding a metric to the catalog without deciding its
  // value leaf here must fail the build rather than ship a metric the extractor
  // silently cannot read.
  it("covers exactly the in-scope catalog metrics", () => {
    expect(Object.keys(HEALTH_VALUE_SPECS).sort()).toEqual([...IN_SCOPE_METRICS].sort());
  });

  it("covers exactly 18 metrics", () => {
    expect(IN_SCOPE_METRICS).toHaveLength(18);
    expect(HEALTH_METRICS).toHaveLength(19);
  });

  it("excludes heart-rate-intraday, which is out of scope for 6.3", () => {
    expect(HEALTH_METRICS).toContain("heart-rate-intraday");
    expect(IN_SCOPE_METRICS).not.toContain("heart-rate-intraday");
    expect(HEALTH_VALUE_SPECS).not.toHaveProperty("heart-rate-intraday");
  });

  it("throws rather than improvising for heart-rate-intraday", () => {
    expect(() => getValueSpec("heart-rate-intraday")).toThrow(/out of scope/);
  });

  it("throws for an unknown metric", () => {
    expect(() => getValueSpec("blood-pressure")).toThrow(/no value spec/);
  });

  // Excluding by MODE rather than by name, so a second reconcile stream would
  // also be excluded automatically instead of quietly gaining a guessed spec.
  it("excludes by acquisition mode, not by hardcoded name", () => {
    for (const metric of IN_SCOPE_METRICS) {
      expect(getHealthMetric(metric).mode).not.toBe("sample_reconcile");
    }
  });
});

describe("derivation", () => {
  it("camelCases kebab dataTypes", () => {
    expect(camelCase("steps")).toBe("steps");
    expect(camelCase("body-fat")).toBe("bodyFat");
    expect(camelCase("active-zone-minutes")).toBe("activeZoneMinutes");
    expect(camelCase("daily-resting-heart-rate")).toBe("dailyRestingHeartRate");
    expect(camelCase("daily-vo2-max")).toBe("dailyVo2Max");
  });

  it("derives the container from the metric's googleDataType, not its metric id", () => {
    // heart-rate-intraday shares heart-rate's dataType; only the daily stream
    // has a spec, and its container is the shared dataType camelCased.
    expect(getValueSpec("heart-rate").container).toBe("heartRate");
    for (const metric of IN_SCOPE_METRICS) {
      expect(getValueSpec(metric).container).toBe(
        camelCase(getHealthMetric(metric).googleDataType),
      );
    }
  });

  // This assertion previously read "derives the leaf from the catalog unit for
  // every metric", on the ADR-047 reasoning that units are baked into field
  // names. The Checkpoint 6.3L live proof disproved it: every record of all
  // four metrics with real data was rejected. dailyRollUp returns a ROLLUP and
  // appends Sum/Avg/Min/Max, and the prefix is the bare unit noun rather than
  // the catalog's unit string (`total-calories` has unit `caloriesKcal` but
  // leaf `kcalSum`). The leaf is declared per metric now; the CONTAINER
  // derivation was correct and still holds.
  it("derives the container from the dataType for every metric", () => {
    for (const metric of IN_SCOPE_METRICS) {
      expect(getValueSpec(metric).container).toBe(
        camelCase(getHealthMetric(metric).googleDataType),
      );
    }
  });

  it("a rollup leaf is never the bare catalog unit", () => {
    for (const metric of IN_SCOPE_METRICS) {
      if (getHealthMetric(metric).mode !== "daily_rollup") continue;
      expect(getValueSpec(metric).leaf).not.toBe(getHealthMetric(metric).unit);
    }
  });

  it("declares a leaf type for every metric", () => {
    for (const metric of IN_SCOPE_METRICS) {
      expect(["int64", "double"]).toContain(getValueSpec(metric).leafType);
    }
  });

  it("pins the spot-checked declarations", () => {
    // The four rollup shapes below are OBSERVED, not inferred (6.3L).
    expect(getValueSpec("steps")).toMatchObject({
      container: "steps",
      leaf: "countSum",
      leafType: "int64",
    });
    expect(getValueSpec("distance")).toMatchObject({ leaf: "millimetersSum", leafType: "int64" });
    expect(getValueSpec("total-calories")).toMatchObject({
      container: "totalCalories",
      leaf: "kcalSum",
      leafType: "double",
    });
    // `weight` was int64 at merge; the reference types `weightGrams` as
    // `number`, so it is double (9.0 review). See the dedicated block below.
    expect(getValueSpec("weight")).toMatchObject({ leaf: "weightGrams", leafType: "double" });
    expect(getValueSpec("body-fat")).toMatchObject({
      container: "bodyFat",
      leaf: "percentage",
      leafType: "double",
    });
  });
});

describe("breakdown allowlists", () => {
  it("declares no breakdown leaves for a plain scalar metric", () => {
    expect(getValueSpec("steps").breakdownLeaves).toEqual([]);
  });

  it("declares the zone split for active-zone-minutes", () => {
    // UNVERIFIED: this account has never returned active-zone-minutes data, so
    // the aggregation suffix follows the observed rollup pattern rather than an
    // observation. A wrong declaration fails the run; it cannot store a wrong
    // number.
    expect(getValueSpec("active-zone-minutes").breakdownLeaves.map((l) => l.name)).toEqual([
      "fatBurnMinutesSum",
      "cardioMinutesSum",
      "peakMinutesSum",
    ]);
  });

  it("never lets a breakdown leaf duplicate the value leaf", () => {
    for (const metric of IN_SCOPE_METRICS) {
      const spec = getValueSpec(metric);
      expect(spec.breakdownLeaves.map((l) => l.name)).not.toContain(spec.leaf);
    }
  });
});

describe("rollup leaves carry an aggregation suffix (Checkpoint 6.3L live finding)", () => {
  // An earlier draft derived the leaf from the catalog `unit`. The live proof
  // rejected every record of all four metrics that actually have data:
  // dailyRollUp returns a ROLLUP, so it appends Sum/Avg/Min/Max, and the prefix
  // is the bare unit noun rather than the catalog's unit string.
  //
  // These are SYNTHETIC records built from the observed SHAPE. No real payload
  // and no real value was copied into this repository.
  it("uses the observed leaf for each metric that has live data", () => {
    expect(getValueSpec("steps")).toMatchObject({ container: "steps", leaf: "countSum" });
    expect(getValueSpec("distance")).toMatchObject({
      container: "distance",
      leaf: "millimetersSum",
    });
    expect(getValueSpec("floors")).toMatchObject({ container: "floors", leaf: "countSum" });
    expect(getValueSpec("total-calories")).toMatchObject({
      container: "totalCalories",
      leaf: "kcalSum",
    });
  });

  it("total-calories proves the leaf is NOT the catalog unit", () => {
    // unit is `caloriesKcal`; the leaf is `kcalSum`. A derivation from `unit`
    // cannot produce this, which is why the leaf is declared.
    expect(getHealthMetric("total-calories").unit).toBe("caloriesKcal");
    expect(getValueSpec("total-calories").leaf).toBe("kcalSum");
  });

  it("heart-rate rolls up as an AVERAGE, keeping min and max in the breakdown", () => {
    const spec = getValueSpec("heart-rate");
    expect(spec).toMatchObject({ container: "heartRate", leaf: "beatsPerMinuteAvg" });
    expect(spec.breakdownLeaves.map((l) => l.name)).toEqual([
      "beatsPerMinuteMin",
      "beatsPerMinuteMax",
    ]);
  });

  it("no rollup metric declares a bare unit as its leaf", () => {
    for (const metric of IN_SCOPE_METRICS) {
      const def = getHealthMetric(metric);
      if (def.mode !== "daily_rollup") continue;
      expect(getValueSpec(metric).leaf).not.toBe(def.unit);
      expect(getValueSpec(metric).leaf).toMatch(/(Sum|Avg|Min|Max)$/);
    }
  });

  it("records which leaves were actually observed, and which remain declarations", () => {
    // Honest epistemic status: six observed live, the rest documentation-derived.
    // daily-heart-rate-variability joined at Checkpoint 9.0, after its
    // documentation-derived guess met the first real record and was rejected.
    expect([...OBSERVED_LEAF_METRICS].sort()).toEqual([
      "daily-heart-rate-variability",
      "distance",
      "floors",
      "heart-rate",
      "steps",
      "total-calories",
    ]);
  });
});

describe("extractValue against the observed rollup shapes (synthetic)", () => {
  it("accepts an int64-as-string countSum, as steps and floors return", () => {
    const r = extractValue({ steps: { countSum: "8421" } }, getValueSpec("steps"));
    expect(r).toEqual({ ok: true, value: "8421", breakdown: null });
  });

  it("accepts a double kcalSum, as total-calories returns", () => {
    const r = extractValue({ totalCalories: { kcalSum: 2130.5 } }, getValueSpec("total-calories"));
    expect(r).toMatchObject({ ok: true, value: "2130.5" });
  });

  it("keeps heart-rate min and max in the allowlisted breakdown", () => {
    const r = extractValue(
      { heartRate: { beatsPerMinuteAvg: 68, beatsPerMinuteMin: 51, beatsPerMinuteMax: 142 } },
      getValueSpec("heart-rate"),
    );
    expect(r).toMatchObject({
      ok: true,
      value: "68",
      breakdown: { beatsPerMinuteMin: "51", beatsPerMinuteMax: "142" },
    });
  });

  it("still REJECTS the pre-fix shape, so the regression cannot return", () => {
    const r = extractValue({ steps: { count: "8421" } }, getValueSpec("steps"));
    expect(r.ok).toBe(false);
  });
});

describe("daily-heart-rate-variability against the observed list shape (Checkpoint 9.0)", () => {
  // THE FAILURE THIS BLOCK PREVENTS. The original declaration copied the
  // catalog unit string (`rootMeanSquareOfSuccessiveDifferencesMilliseconds`)
  // as the leaf name. The first real HRV record the account ever produced
  // (2026-09-11) matched nothing, every hot run was rejected with
  // `value_shape_violation`, and the breaker disabled the stream after five.
  // A live read-only shape probe on 2026-09-12 observed the real record:
  //
  //     dailyHeartRateVariability: {
  //       date: { year, month, day },
  //       averageHeartRateVariabilityMilliseconds: number,
  //       deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: number,
  //     }
  //
  // These records are SYNTHETIC, built from that observed SHAPE. No real
  // payload and no real value was copied into this repository.
  const spec = getValueSpec("daily-heart-rate-variability");

  it("declares the observed primary leaf, with deep-sleep RMSSD in the breakdown", () => {
    expect(spec).toMatchObject({
      container: "dailyHeartRateVariability",
      leaf: "averageHeartRateVariabilityMilliseconds",
      leafType: "double",
    });
    expect(spec.breakdownLeaves).toEqual([
      { name: "deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds", type: "double" },
    ]);
    expect(OBSERVED_LEAF_METRICS).toContain("daily-heart-rate-variability");
  });

  it("accepts the exact observed record shape", () => {
    const r = extractValue(
      heartRateVariabilityRecord({
        localDate: "2026-09-11",
        averageRmssd: 38.2,
        deepSleepRmssd: 41.9,
      }),
      spec,
    );
    expect(r).toEqual({
      ok: true,
      value: "38.2",
      breakdown: { deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: "41.9" },
    });
  });

  it("accepts a record carrying the daily average alone (deep sleep is optional)", () => {
    const r = extractValue(
      heartRateVariabilityRecord({ localDate: "2026-09-11", averageRmssd: 38 }),
      spec,
    );
    expect(r).toEqual({ ok: true, value: "38", breakdown: null });
  });

  it("accepts a double sent as a numeric string, as protobuf JSON may do", () => {
    const r = extractValue(
      heartRateVariabilityRecord({ localDate: "2026-09-11", averageRmssd: "38.20" }),
      spec,
    );
    expect(r).toMatchObject({ ok: true, value: "38.2" });
  });

  it("still REJECTS the pre-fix shape, so the regression cannot return", () => {
    // The old leaf name, as the old fixture-less spec imagined it. It is NOT
    // an alias: matching it would mean guessing, which extractValue never does.
    const r = extractValue(
      {
        dailyHeartRateVariability: {
          date: { year: 2026, month: 9, day: 11 },
          rootMeanSquareOfSuccessiveDifferencesMilliseconds: 38.2,
        },
      },
      spec,
    );
    expect(r).toMatchObject({
      ok: false,
      rejection: {
        code: "leaf_missing",
        keyPath: "dailyHeartRateVariability.averageHeartRateVariabilityMilliseconds",
      },
    });
  });

  it("reproduces the production rejection: the real record against the OLD declaration", () => {
    // This is the exact pairing that produced five `value_shape_violation`
    // runs: the observed shape read through the superseded spec. It pins the
    // rejection CODE the sync engine folded into that class, so the next
    // wrong declaration is recognisable from its run row alone.
    const oldSpec = {
      ...spec,
      leaf: "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
      breakdownLeaves: [],
    };
    const r = extractValue(
      heartRateVariabilityRecord({
        localDate: "2026-09-11",
        averageRmssd: 38.2,
        deepSleepRmssd: 41.9,
      }),
      oldSpec,
    );
    expect(r).toMatchObject({ ok: false, rejection: { code: "leaf_missing" } });
  });

  it("rejects a non-numeric primary leaf rather than coercing it", () => {
    const r = extractValue(
      heartRateVariabilityRecord({ localDate: "2026-09-11", averageRmssd: "high" }),
      spec,
    );
    expect(r).toMatchObject({
      ok: false,
      rejection: { code: "leaf_type_mismatch", sawType: "string" },
    });
  });

  it("rejects a deep-sleep breakdown leaf of the wrong kind, never storing half a record", () => {
    const r = extractValue(
      heartRateVariabilityRecord({
        localDate: "2026-09-11",
        averageRmssd: 38.2,
        deepSleepRmssd: "n/a",
      }),
      spec,
    );
    expect(r).toMatchObject({
      ok: false,
      rejection: {
        code: "breakdown_leaf_type_mismatch",
        keyPath:
          "dailyHeartRateVariability.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds",
      },
    });
  });

  it("ignores the documented-but-unobserved siblings rather than storing them", () => {
    // `entropy` and `nonRemHeartRateBeatsPerMinute` are documented optional
    // fields the live record did not carry. They are not allowlisted, so they
    // neither reach `breakdown` nor cause a rejection whatever their type --
    // which is the safe direction until they are observed.
    const r = extractValue(
      heartRateVariabilityRecord({
        localDate: "2026-09-11",
        averageRmssd: 38.2,
        extra: { entropy: 2.1, nonRemHeartRateBeatsPerMinute: "52" },
      }),
      spec,
    );
    expect(r).toEqual({ ok: true, value: "38.2", breakdown: null });
  });

  it("documents the known loud gap: a record with only deep-sleep RMSSD is rejected", () => {
    // Google documents "at least one of" four value fields must be set, so a
    // record without the daily average is expressible upstream. The spec model
    // has one primary leaf and cannot express "one of"; such a record fails
    // as `leaf_missing` -- loudly, via the breaker -- rather than storing the
    // deep-sleep figure under the daily average's name.
    const r = extractValue(
      {
        dailyHeartRateVariability: {
          date: { year: 2026, month: 9, day: 11 },
          deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds: 41.9,
        },
      },
      spec,
    );
    expect(r).toMatchObject({ ok: false, rejection: { code: "leaf_missing" } });
  });
});

describe("documentation-corrected declarations (Checkpoint 9.0 review, still unobserved)", () => {
  // THE FAILURE THIS BLOCK PREVENTS. After the HRV leaf was corrected, the
  // review re-read Google's reference for every remaining unobserved entry
  // and found three more that copied the catalog UNIT string as the leaf
  // name, plus one wrong type. Each would have replayed the HRV incident on
  // its first real record: five identical `value_shape_violation` runs, the
  // breaker, an alert, and a live probe to learn what this block pins today.
  //
  // Every record below is SYNTHETIC, built from the DOCUMENTED shape. None
  // has been observed; the declarations remain `observed: false`.
  it("keeps every corrected entry honest: documented, not observed", () => {
    for (const metric of [
      "daily-oxygen-saturation",
      "daily-respiratory-rate",
      "daily-sleep-temperature-derivations",
      "weight",
    ]) {
      expect(OBSERVED_LEAF_METRICS).not.toContain(metric);
    }
  });

  it("daily-oxygen-saturation reads the documented averagePercentage, not the unit", () => {
    const spec = getValueSpec("daily-oxygen-saturation");
    expect(spec).toMatchObject({
      container: "dailyOxygenSaturation",
      leaf: "averagePercentage",
      leafType: "double",
      breakdownLeaves: [],
    });
    const r = extractValue(
      {
        dailyOxygenSaturation: {
          date: { year: 2026, month: 9, day: 11 },
          averagePercentage: 96.4,
          lowerBoundPercentage: 93.1,
          upperBoundPercentage: 98.9,
        },
      },
      spec,
    );
    // The documented bounds are ignored, not stored and not rejected: they are
    // unobserved, and an undeclared field costs nothing.
    expect(r).toEqual({ ok: true, value: "96.4", breakdown: null });
    // The merge-time shape -- the catalog unit as the leaf -- is still a
    // rejection, so the regression cannot return as an alias.
    expect(
      extractValue(
        { dailyOxygenSaturation: { date: { year: 2026, month: 9, day: 11 }, percentage: 96.4 } },
        spec,
      ),
    ).toMatchObject({ ok: false, rejection: { code: "leaf_missing" } });
  });

  it("daily-respiratory-rate reads the documented averageBreathsPerMinute", () => {
    const spec = getValueSpec("daily-respiratory-rate");
    expect(spec).toMatchObject({
      container: "dailyRespiratoryRate",
      leaf: "averageBreathsPerMinute",
      leafType: "double",
    });
    // Documented int64, so protobuf JSON encodes it as a string; double
    // accepts that encoding, and would also accept a fractional average
    // rather than failing a run over a type annotation.
    expect(
      extractValue(
        {
          dailyRespiratoryRate: {
            date: { year: 2026, month: 9, day: 11 },
            averageBreathsPerMinute: "14",
            standardDeviationBreathsPerMinute: 1.2,
          },
        },
        spec,
      ),
    ).toEqual({ ok: true, value: "14", breakdown: null });
    expect(
      extractValue(
        { dailyRespiratoryRate: { date: { year: 2026, month: 9, day: 11 }, breathsPerMinute: 14 } },
        spec,
      ),
    ).toMatchObject({ ok: false, rejection: { code: "leaf_missing" } });
  });

  it("weight accepts a fractional gram, as the reference types weightGrams as number", () => {
    const spec = getValueSpec("weight");
    expect(spec).toMatchObject({ leaf: "weightGrams", leafType: "double" });
    // At merge this was int64 and would have rejected the record below as
    // `leaf_type_mismatch`. A fractional gram is a correct value at full
    // precision, not a shape defect.
    expect(extractValue({ weight: { weightGrams: 70500.5 } }, spec)).toMatchObject({
      ok: true,
      value: "70500.5",
    });
    expect(extractValue({ weight: { weightGrams: "70500" } }, spec)).toMatchObject({
      ok: true,
      value: "70500",
    });
  });

  it("daily-sleep-temperature-derivations is left matching NOTHING, on purpose", () => {
    // The documented value is `nightlyTemperatureCelsius`, an ABSOLUTE mean
    // skin temperature. The catalog unit `celsiusDelta` is the display key the
    // mobile formatter renders as a signed delta, so pointing the leaf at the
    // documented field would store ~33 °C and show "+33.4 °C". Until the
    // product decides between deriving nightly-minus-baseline and storing the
    // absolute under a different display key, the first real record must
    // fail loudly (`leaf_missing`, then the breaker) rather than render a
    // wrong-looking number. This test pins that choice so it is not "fixed"
    // by the next reader who compares the leaf to the documentation.
    const spec = getValueSpec("daily-sleep-temperature-derivations");
    expect(spec).toMatchObject({ leaf: "celsiusDelta", leafType: "double" });
    expect(
      extractValue(
        {
          dailySleepTemperatureDerivations: {
            date: { year: 2026, month: 9, day: 11 },
            nightlyTemperatureCelsius: 33.4,
            baselineTemperatureCelsius: 33.1,
          },
        },
        spec,
      ),
    ).toMatchObject({
      ok: false,
      rejection: {
        code: "leaf_missing",
        keyPath: "dailySleepTemperatureDerivations.celsiusDelta",
      },
    });
  });
});
