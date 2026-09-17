import type {
  HealthMetricCapability,
  HealthMetricPoint,
  HealthMetricTile,
} from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import { MAX_HEADLINE_METRICS, pickHeadlineMetrics } from "./headline-metrics";

// Fixtures -- every value invented, mirroring health-components.test.tsx.
const TODAY = "2026-08-25";

function point(overrides: Partial<HealthMetricPoint> = {}): HealthMetricPoint {
  return { local_date: TODAY, state: "unknown", value: null, source_count: null, ...overrides };
}

function tile(overrides: Partial<HealthMetricTile> = {}): HealthMetricTile {
  return { metric: "steps", unit: "count", aggregation: "sum", point: point(), ...overrides };
}

function capability(overrides: Partial<HealthMetricCapability> = {}): HealthMetricCapability {
  return {
    metric: "steps",
    unit: "count",
    aggregation: "sum",
    sync_enabled: true,
    capability_status: "available_in_window",
    capability_checked_at: "2026-08-25T04:00:00.000Z",
    verified_through_date: "2026-08-24",
    earliest_verified_date: "2026-07-01",
    first_data_date: "2026-07-01",
    last_successful_sync_at: "2026-08-25T04:00:00.000Z",
    backfill_status: "idle",
    ...overrides,
  };
}

describe("pickHeadlineMetrics", () => {
  it("lists only metrics with a real recorded value today, formatted", () => {
    const headlines = pickHeadlineMetrics(
      [
        tile({ metric: "steps", point: point({ state: "value", value: "8140" }) }),
        tile({ metric: "floors", point: point({ state: "verified_absent" }) }),
        tile({ metric: "sleep", unit: "seconds", point: point({ state: "unknown" }) }),
        tile({
          metric: "daily-resting-heart-rate",
          unit: "beatsPerMinute",
          point: point({ state: "value", value: "58" }),
        }),
      ],
      [
        capability({ metric: "steps" }),
        capability({ metric: "floors" }),
        capability({ metric: "sleep", first_data_date: null }),
        capability({ metric: "daily-resting-heart-rate", sync_enabled: false }),
      ],
      TODAY,
    );

    // Resting heart rate carries a value but its stream is DISABLED, and the
    // frozen precedence ranks that above a stored number -- so it is not a
    // headline either. The picker must share the tiles' rule, not invent one.
    expect(headlines).toEqual([{ metric: "steps", text: "8,140", unitLabel: "" }]);
  });

  it("never lists a metric without a capability record", () => {
    const headlines = pickHeadlineMetrics(
      [tile({ metric: "steps", point: point({ state: "value", value: "10" }) })],
      [],
      TODAY,
    );
    expect(headlines).toEqual([]);
  });

  it("caps the list at MAX_HEADLINE_METRICS, in the server's own order", () => {
    const metrics = ["steps", "distance", "total-calories", "floors", "active-zone-minutes"];
    const headlines = pickHeadlineMetrics(
      metrics.map((metric) =>
        tile({ metric, unit: "count", point: point({ state: "value", value: "10" }) }),
      ),
      metrics.map((metric) => capability({ metric })),
      TODAY,
    );
    expect(headlines).toHaveLength(MAX_HEADLINE_METRICS);
    expect(headlines.map((h) => h.metric)).toEqual(metrics.slice(0, MAX_HEADLINE_METRICS));
  });

  it("keeps a genuine recorded zero -- it is data, not an absence", () => {
    const headlines = pickHeadlineMetrics(
      [tile({ metric: "steps", point: point({ state: "value", value: "0" }) })],
      [capability({ metric: "steps" })],
      TODAY,
    );
    expect(headlines.map((h) => h.text)).toEqual(["0"]);
  });
});
