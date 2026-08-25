import { describe, expect, it } from "vitest";
import { getHealthMetric, HEALTH_METRICS } from "../google-health-catalog.js";
import { camelCase, getValueSpec, HEALTH_VALUE_SPECS, IN_SCOPE_METRICS } from "./value-spec.js";

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

  // ADR-047: units are baked into field names, which is why no unit column
  // exists. Deriving the leaf from the catalog unit keeps the two in lockstep.
  it("derives the leaf from the catalog unit for every metric", () => {
    for (const metric of IN_SCOPE_METRICS) {
      expect(getValueSpec(metric).leaf).toBe(getHealthMetric(metric).unit);
    }
  });

  it("declares a leaf type for every metric", () => {
    for (const metric of IN_SCOPE_METRICS) {
      expect(["int64", "double"]).toContain(getValueSpec(metric).leafType);
    }
  });

  it("pins the spot-checked declarations", () => {
    expect(getValueSpec("steps")).toMatchObject({
      container: "steps",
      leaf: "count",
      leafType: "int64",
    });
    expect(getValueSpec("distance")).toMatchObject({ leaf: "millimeters", leafType: "int64" });
    expect(getValueSpec("total-calories")).toMatchObject({
      container: "totalCalories",
      leaf: "caloriesKcal",
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
    expect(getValueSpec("active-zone-minutes").breakdownLeaves.map((l) => l.name)).toEqual([
      "fatBurnMinutes",
      "cardioMinutes",
      "peakMinutes",
    ]);
  });

  it("never lets a breakdown leaf duplicate the value leaf", () => {
    for (const metric of IN_SCOPE_METRICS) {
      const spec = getValueSpec(metric);
      expect(spec.breakdownLeaves.map((l) => l.name)).not.toContain(spec.leaf);
    }
  });
});
