import { describe, expect, it } from "vitest";
import {
  ACTIVITY_SCOPE,
  getHealthMetric,
  HEALTH_METRIC_CATALOG,
  HEALTH_METRICS,
  METRICS_SCOPE,
  metricsForGrantedScopes,
  PHASE_6A_SCOPES,
  SLEEP_SCOPE,
} from "./google-health-catalog.js";

const ALL = Object.values(HEALTH_METRIC_CATALOG);

describe("scope discipline", () => {
  it("requests exactly three scopes, all read-only", () => {
    expect(PHASE_6A_SCOPES).toHaveLength(3);
    for (const s of PHASE_6A_SCOPES) expect(s.endsWith(".readonly")).toBe(true);
  });

  // A fourth scope is the exact cost that got paired-device discovery cut, so
  // this asserts no metric can quietly reintroduce one.
  it("has no metric requiring a scope outside the approved three", () => {
    for (const def of ALL) expect(PHASE_6A_SCOPES).toContain(def.scope);
  });

  it("never requests settings, location, profile, nutrition, ecg or irn", () => {
    const joined = PHASE_6A_SCOPES.join(" ");
    for (const forbidden of ["settings", "location", "profile", "nutrition", "ecg", "irn"]) {
      expect(joined).not.toContain(forbidden);
    }
  });

  // vo2-max FEELS like a vital but the data-types table puts it under activity.
  // Verified against the docs rather than inferred; pinned so it stays right.
  it("puts daily-vo2-max under activity_and_fitness, not health_metrics", () => {
    expect(getHealthMetric("daily-vo2-max").scope).toBe(ACTIVITY_SCOPE);
  });

  it("assigns the documented scope for a spot-check of each family", () => {
    expect(getHealthMetric("steps").scope).toBe(ACTIVITY_SCOPE);
    expect(getHealthMetric("sleep").scope).toBe(SLEEP_SCOPE);
    expect(getHealthMetric("weight").scope).toBe(METRICS_SCOPE);
    expect(getHealthMetric("heart-rate").scope).toBe(METRICS_SCOPE);
  });
});

describe("partial consent is resolved from granted scopes", () => {
  it("enables only metrics whose scope was actually granted", () => {
    const enabled = metricsForGrantedScopes(ACTIVITY_SCOPE);
    expect(enabled).toContain("steps");
    expect(enabled).not.toContain("sleep");
    expect(enabled).not.toContain("weight");
  });

  it("enables everything when all three are granted", () => {
    expect(metricsForGrantedScopes(PHASE_6A_SCOPES.join(" "))).toHaveLength(HEALTH_METRICS.length);
  });

  it("enables nothing for an empty grant", () => {
    expect(metricsForGrantedScopes("")).toEqual([]);
  });

  it("ignores unrelated granted scopes", () => {
    expect(metricsForGrantedScopes("https://www.googleapis.com/auth/calendar.events")).toEqual([]);
  });
});

describe("method and parameter correctness", () => {
  // The error Revision 1 made: `list` accepts only pageSize/pageToken/filter.
  it("never claims list supports dataSourceFamily", () => {
    for (const def of ALL) {
      if (def.method === "list") expect(def.supportsDataSourceFamily).toBe(false);
    }
  });

  it("allows dataSourceFamily on reconcile and dailyRollUp", () => {
    for (const def of ALL) {
      if (def.method === "reconcile" || def.method === "dailyRollUp") {
        expect(def.supportsDataSourceFamily).toBe(true);
      }
    }
  });

  it("gives dailyRollUp metrics no filter path (they take a range object)", () => {
    for (const def of ALL) {
      if (def.method === "dailyRollUp") expect(def.filterPath).toBeNull();
      else expect(def.filterPath).not.toBeNull();
    }
  });

  // Sleep is the documented exception: filtered on its civil END time, and
  // explicitly excluded from the generic session-start filter. That axis is
  // also its attribution axis (ADR-049).
  it("filters sleep on civil_end_time, never on start_time", () => {
    const sleep = getHealthMetric("sleep");
    expect(sleep.filterPath).toBe("sleep.interval.civil_end_time");
    expect(sleep.filterPath).not.toContain("start_time");
  });

  it("filters exercise on civil_start_time", () => {
    expect(getHealthMetric("exercise").filterPath).toBe("exercise.interval.civil_start_time");
  });

  it("snake-cases the filter field while the path stays kebab-case", () => {
    const d = getHealthMetric("daily-resting-heart-rate");
    expect(d.googleDataType).toBe("daily-resting-heart-rate");
    expect(d.filterField).toBe("daily_resting_heart_rate");
    expect(d.filterPath).toBe("daily_resting_heart_rate.date");
  });
});

describe("range caps distinguish documented limits from our own choices", () => {
  // The 14-day figure is a DOCUMENTED rollup cap. Applying it to list/reconcile
  // would be inventing an API limit that does not exist.
  it("marks the 14-day rollup caps as documented", () => {
    for (const m of ["total-calories", "heart-rate"]) {
      const def = getHealthMetric(m);
      expect(def.maxRangeDays).toBe(14);
      expect(def.capSource).toBe("documented_rollup_cap");
    }
  });

  it("marks every list/reconcile cap as self-imposed", () => {
    for (const def of ALL) {
      if (def.method !== "dailyRollUp") expect(def.capSource).toBe("self_imposed");
    }
  });

  it("caps sessions at the API's hard 25-per-page limit", () => {
    expect(getHealthMetric("sleep").pageSize).toBe(25);
    expect(getHealthMetric("exercise").pageSize).toBe(25);
  });
});

describe("true zero", () => {
  // Only these types can report a genuine recorded zero distinct from absence.
  it("flags exactly the documented true-zero types in scope", () => {
    const trueZero = ALL.filter((d) => d.trueZeroCapable)
      .map((d) => d.metric)
      .sort();
    expect(trueZero).toEqual(["distance", "floors", "steps", "total-calories"]);
  });
});

describe("heart rate has two streams over one dataType", () => {
  it("separates the daily rollup from the intraday reconcile stream", () => {
    const daily = getHealthMetric("heart-rate");
    const intraday = getHealthMetric("heart-rate-intraday");
    expect(daily.googleDataType).toBe("heart-rate");
    expect(intraday.googleDataType).toBe("heart-rate");
    expect(daily.method).toBe("dailyRollUp");
    expect(intraday.method).toBe("reconcile");
  });

  it("keys them separately so both can be enabled independently", () => {
    expect(getHealthMetric("heart-rate").metric).not.toBe(
      getHealthMetric("heart-rate-intraday").metric,
    );
  });
});

describe("catalog integrity", () => {
  it("keys every entry by its own metric name", () => {
    for (const [key, def] of Object.entries(HEALTH_METRIC_CATALOG)) {
      expect(def.metric).toBe(key);
    }
  });

  it("throws a named error for an unknown metric rather than returning undefined", () => {
    expect(() => getHealthMetric("nope")).toThrow(/unknown health metric/);
  });

  it("gives every metric a positive range cap and page size", () => {
    for (const def of ALL) {
      expect(def.maxRangeDays).toBeGreaterThan(0);
      expect(def.pageSize).toBeGreaterThan(0);
    }
  });
});

describe("session attribution axis is declared once, as data (ADR-049)", () => {
  // Before this was a catalog field, the axis was re-decided by
  // `metric === "sleep"` in the translator AND again in the worker's tombstone
  // sweep. Adding a second end-attributed session metric could have updated one
  // and missed the other, leaving the sweep bounding on a column the fetch
  // never filtered on -- silently tombstoning sessions the query had no chance
  // to return.
  it("sleep is attributed on its civil END, matching its sleep-exclusive filter", () => {
    const def = getHealthMetric("sleep");
    expect(def.attributionAxis).toBe("civil_end");
    expect(def.filterPath).toBe("sleep.interval.civil_end_time");
  });

  it("exercise is attributed on its civil START", () => {
    const def = getHealthMetric("exercise");
    expect(def.attributionAxis).toBe("civil_start");
    expect(def.filterPath).toBe("exercise.interval.civil_start_time");
  });

  it("every session metric's axis agrees with the axis its filter uses", () => {
    for (const metric of HEALTH_METRICS) {
      const def = getHealthMetric(metric);
      if (def.mode !== "session_list") continue;
      expect(def.attributionAxis).not.toBeNull();
      const expected = def.attributionAxis === "civil_end" ? "civil_end_time" : "civil_start_time";
      expect(def.filterPath).toContain(expected);
    }
  });

  it("no non-session metric declares an axis", () => {
    for (const metric of HEALTH_METRICS) {
      const def = getHealthMetric(metric);
      if (def.mode === "session_list") continue;
      expect(def.attributionAxis).toBeNull();
    }
  });
});
