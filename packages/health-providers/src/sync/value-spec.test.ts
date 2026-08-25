import { describe, expect, it } from "vitest";
import { getHealthMetric, HEALTH_METRICS } from "../google-health-catalog.js";
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
    expect(getValueSpec("weight")).toMatchObject({ leaf: "weightGrams", leafType: "int64" });
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
    // Honest epistemic status: five observed live, the rest documentation-derived.
    expect([...OBSERVED_LEAF_METRICS].sort()).toEqual([
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
