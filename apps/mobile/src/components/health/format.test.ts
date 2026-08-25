import { describe, expect, it } from "vitest";
import {
  METRIC_LABELS,
  METRIC_SHORT_LABELS,
  formatDuration,
  formatHealthValue,
  metricLabel,
  metricShortLabel,
} from "./format";

// The 19 metric ids in packages/health-providers/src/google-health-catalog.ts,
// transcribed rather than imported: that package is server-side and must never
// enter the mobile bundle. Divergence surfaces as a failing label test here,
// which is exactly where a missing label should be caught.
const CATALOG_METRICS = [
  "steps",
  "distance",
  "active-zone-minutes",
  "active-energy-burned",
  "total-calories",
  "sedentary-period",
  "floors",
  "heart-rate",
  "heart-rate-intraday",
  "daily-resting-heart-rate",
  "daily-heart-rate-variability",
  "daily-oxygen-saturation",
  "daily-respiratory-rate",
  "daily-sleep-temperature-derivations",
  "daily-vo2-max",
  "weight",
  "body-fat",
  "sleep",
  "exercise",
] as const;

// Every distinct `unit` string the catalog emits.
const CATALOG_UNITS = [
  "count",
  "millimeters",
  "minutes",
  "caloriesKcal",
  "seconds",
  "beatsPerMinute",
  "rootMeanSquareOfSuccessiveDifferencesMilliseconds",
  "percentage",
  "breathsPerMinute",
  "celsiusDelta",
  "vo2Max",
  "weightGrams",
] as const;

describe("formatHealthValue", () => {
  it("groups whole counts", () => {
    expect(formatHealthValue("8421", "count")).toEqual({ text: "8,421", unitLabel: "" });
    expect(formatHealthValue("421", "count")).toEqual({ text: "421", unitLabel: "" });
    expect(formatHealthValue("1234567", "count")).toEqual({ text: "1,234,567", unitLabel: "" });
  });

  it("renders a genuine zero as zero, for every unit", () => {
    for (const unit of CATALOG_UNITS) {
      const { text } = formatHealthValue("0", unit);
      expect(text, unit).not.toBe("");
      expect(text, unit).not.toContain("NaN");
    }
    expect(formatHealthValue("0", "count").text).toBe("0");
    expect(formatHealthValue("0", "seconds").text).toBe("0m");
  });

  it("scales millimetres to kilometres and never to an imperial unit", () => {
    expect(formatHealthValue("5420000", "millimeters")).toEqual({ text: "5.42", unitLabel: "km" });
    expect(formatHealthValue("12345678", "millimeters")).toEqual({
      text: "12.35",
      unitLabel: "km",
    });
  });

  it("scales grams to kilograms", () => {
    expect(formatHealthValue("81400", "weightGrams")).toEqual({ text: "81.4", unitLabel: "kg" });
  });

  it("renders seconds as a duration with no separate unit word", () => {
    expect(formatHealthValue("27720", "seconds")).toEqual({ text: "7h 42m", unitLabel: "" });
  });

  it("rounds rate-like units to whole numbers and level-like units to one decimal", () => {
    expect(formatHealthValue("62.4", "beatsPerMinute")).toEqual({ text: "62", unitLabel: "bpm" });
    expect(formatHealthValue("41.7", "rootMeanSquareOfSuccessiveDifferencesMilliseconds")).toEqual({
      text: "42",
      unitLabel: "ms",
    });
    expect(formatHealthValue("96.75", "percentage")).toEqual({ text: "96.8", unitLabel: "%" });
    expect(formatHealthValue("14.22", "breathsPerMinute")).toEqual({
      text: "14.2",
      unitLabel: "br/min",
    });
    expect(formatHealthValue("43.61", "vo2Max")).toEqual({
      text: "43.6",
      unitLabel: "mL/kg/min",
    });
    expect(formatHealthValue("512", "caloriesKcal")).toEqual({ text: "512", unitLabel: "kcal" });
    expect(formatHealthValue("38", "minutes")).toEqual({ text: "38", unitLabel: "min" });
  });

  it("always signs a temperature delta so +0.3 and -0.3 cannot be confused", () => {
    expect(formatHealthValue("0.34", "celsiusDelta")).toEqual({ text: "+0.3", unitLabel: "°C" });
    expect(formatHealthValue("-0.34", "celsiusDelta")).toEqual({ text: "-0.3", unitLabel: "°C" });
    expect(formatHealthValue("0", "celsiusDelta")).toEqual({ text: "0.0", unitLabel: "°C" });
  });

  it("returns the raw string, never NaN and never 0, for unreadable input", () => {
    for (const bad of ["", "  ", "abc", "1,234", "0x10", "Infinity", "NaN", "12px"]) {
      const { text, unitLabel } = formatHealthValue(bad, "count");
      expect(text, bad).toBe(bad.trim());
      expect(text, bad).not.toBe("0");
      expect(unitLabel, bad).toBe("");
    }
  });

  it("prints an unknown unit's number with no invented unit word", () => {
    expect(formatHealthValue("42", "furlongsPerFortnight")).toEqual({
      text: "42",
      unitLabel: "",
    });
  });
});

describe("formatDuration", () => {
  it("formats the documented shapes", () => {
    expect(formatDuration(27720)).toBe("7h 42m");
    expect(formatDuration(2880)).toBe("48m");
    expect(formatDuration(0)).toBe("0m");
  });

  it("keeps the minute component on a whole hour so a column stays even", () => {
    expect(formatDuration(25200)).toBe("7h 0m");
  });

  it("rounds to whole minutes before splitting, so 3599s is an hour", () => {
    expect(formatDuration(3599)).toBe("1h 0m");
    expect(formatDuration(29)).toBe("0m");
    expect(formatDuration(31)).toBe("1m");
  });

  it("clamps corrupt negative or non-finite input rather than printing it", () => {
    expect(formatDuration(-60)).toBe("0m");
    expect(formatDuration(Number.NaN)).toBe("0m");
  });
});

describe("metric labels", () => {
  it("has an explicit long label for every catalog metric", () => {
    for (const metric of CATALOG_METRICS) {
      expect(Object.prototype.hasOwnProperty.call(METRIC_LABELS, metric), metric).toBe(true);
      expect(metricLabel(metric), metric).not.toBe("");
    }
  });

  it("has an explicit short label for every catalog metric", () => {
    for (const metric of CATALOG_METRICS) {
      expect(Object.prototype.hasOwnProperty.call(METRIC_SHORT_LABELS, metric), metric).toBe(true);
    }
  });

  it("defines no label for a metric the catalog does not have", () => {
    // Guards the other direction: a stale label left behind after a metric is
    // removed would quietly claim support for something that no longer exists.
    const known = new Set<string>(CATALOG_METRICS);
    expect(Object.keys(METRIC_LABELS).filter((m) => !known.has(m))).toEqual([]);
    expect(Object.keys(METRIC_SHORT_LABELS).filter((m) => !known.has(m))).toEqual([]);
  });

  it("keeps short labels no longer than the long ones for the 480px layout", () => {
    for (const metric of CATALOG_METRICS) {
      expect(metricShortLabel(metric).length, metric).toBeLessThanOrEqual(
        metricLabel(metric).length,
      );
    }
  });

  it("uses the provider's own vocabulary rather than a consumer-app synonym", () => {
    expect(metricLabel("daily-oxygen-saturation")).toBe("Oxygen saturation");
  });

  it("falls back to a title-cased split for an unknown metric instead of throwing", () => {
    expect(metricLabel("some-future-metric")).toBe("Some future metric");
    expect(metricShortLabel("some-future-metric")).toBe("Some future metric");
    expect(metricLabel("")).toBe("");
  });

  it("does not resolve an inherited Object property as a label", () => {
    expect(metricLabel("constructor")).toBe("Constructor");
    expect(metricLabel("toString")).toBe("ToString");
  });
});
