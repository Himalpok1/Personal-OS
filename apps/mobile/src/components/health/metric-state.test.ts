import { describe, expect, it } from "vitest";
import type { HealthMetricCapability, HealthMetricTile } from "@personal-os/schema";
import {
  METRIC_EXPLANATIONS,
  isMetricMissing,
  resolveMetricDisplay,
  type HealthMetricDisplayState,
} from "./metric-state";

const TODAY = "2026-08-24";

function capability(over: Partial<HealthMetricCapability> = {}): HealthMetricCapability {
  return {
    metric: "steps",
    unit: "count",
    aggregation: "sum",
    sync_enabled: true,
    capability_status: "available_in_window",
    capability_checked_at: "2026-08-24T10:00:00Z",
    verified_through_date: "2026-08-23",
    earliest_verified_date: "2026-07-01",
    first_data_date: "2026-07-01",
    last_successful_sync_at: "2026-08-24T10:00:00Z",
    backfill_status: "idle",
    ...over,
  };
}

function tile(
  point: Partial<HealthMetricTile["point"]> = {},
  over: Partial<HealthMetricTile> = {},
): HealthMetricTile {
  return {
    metric: "steps",
    unit: "count",
    aggregation: "sum",
    point: {
      local_date: TODAY,
      state: "value",
      value: "8421",
      source_count: 1,
      ...point,
    },
    ...over,
  };
}

describe("resolveMetricDisplay precedence", () => {
  it("puts sync_disabled first, ahead of a stored value", () => {
    const result = resolveMetricDisplay({
      tile: tile(),
      capability: capability({ sync_enabled: false }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("sync_disabled");
    expect(result.value).toBeNull();
  });

  it("puts missing_scope ahead of a stored value", () => {
    const result = resolveMetricDisplay({
      tile: tile(),
      capability: capability({ capability_status: "missing_scope" }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("needs_scope");
  });

  it("puts not_supported ahead of a stored value", () => {
    const result = resolveMetricDisplay({
      tile: tile(),
      capability: capability({ capability_status: "not_supported" }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("unsupported");
  });

  it("keeps a stored value visible even when the last probe errored", () => {
    const result = resolveMetricDisplay({
      tile: tile(),
      capability: capability({ capability_status: "provider_error" }),
      todayLocalDate: TODAY,
    });
    expect(result).toEqual({
      state: "value",
      value: "8421",
      localDate: TODAY,
      explanation: null,
    });
  });

  it("reports a provider issue only when there is no stored value", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "unknown", value: null }),
      capability: capability({ capability_status: "provider_error" }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("provider_issue");
  });

  it("reports verified_absent as recorded_none", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "verified_absent", value: null, local_date: "2026-08-23" }),
      capability: capability(),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("recorded_none");
    expect(result.localDate).toBe("2026-08-23");
  });

  it("reports a never-populated stream as awaiting_first_data, never unsupported", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "unknown", value: null }),
      capability: capability({
        capability_status: "supported_empty_in_window",
        first_data_date: null,
        verified_through_date: "2026-08-23",
      }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("awaiting_first_data");
    expect(result.explanation).toBe("awaiting_first_data");
  });

  it("prefers awaiting_first_data over not_checked when nothing has ever arrived", () => {
    // Both branches match an `unknown` point; step 7 must win so the more
    // informative sentence is the one shown.
    const result = resolveMetricDisplay({
      tile: tile({ state: "unknown", value: null }),
      capability: capability({ first_data_date: null }),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("awaiting_first_data");
  });

  it("falls through to not_checked for a past day on a stream that has data", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "unknown", value: null, local_date: "2026-06-01" }),
      capability: capability(),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("not_checked");
    expect(result.explanation).toBe("not_checked");
  });

  it("uses the today-specific explanation when the unchecked day is today", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "unknown", value: null, local_date: TODAY }),
      capability: capability(),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("not_checked");
    expect(result.explanation).toBe("not_checked_today");
  });
});

describe("resolveMetricDisplay zero handling", () => {
  it("treats a genuine recorded zero as a value, not as absence", () => {
    const result = resolveMetricDisplay({
      tile: tile({ state: "value", value: "0" }),
      capability: capability(),
      todayLocalDate: TODAY,
    });
    expect(result.state).toBe("value");
    expect(result.value).toBe("0");
    expect(isMetricMissing(result.state)).toBe(false);
  });

  it("never returns a value for any missing state", () => {
    const missingCapabilities: HealthMetricCapability[] = [
      capability({ sync_enabled: false }),
      capability({ capability_status: "missing_scope" }),
      capability({ capability_status: "not_supported" }),
      capability({ capability_status: "provider_error" }),
      capability({ first_data_date: null }),
      capability(),
    ];
    for (const cap of missingCapabilities) {
      const result = resolveMetricDisplay({
        tile: tile({ state: "unknown", value: null }),
        capability: cap,
        todayLocalDate: TODAY,
      });
      expect(result.value).toBeNull();
      expect(isMetricMissing(result.state)).toBe(true);
    }
  });
});

describe("METRIC_EXPLANATIONS copy", () => {
  it("has a non-empty sentence for every key", () => {
    for (const [key, sentence] of Object.entries(METRIC_EXPLANATIONS)) {
      expect(sentence.length, key).toBeGreaterThan(0);
    }
  });

  it("never calls an empty or unverified metric unsupported or unavailable", () => {
    for (const key of [
      "awaiting_first_data",
      "recorded_none",
      "not_checked",
      "not_checked_today",
    ] as const) {
      const sentence = METRIC_EXPLANATIONS[key].toLowerCase();
      expect(sentence, key).not.toContain("unsupported");
      expect(sentence, key).not.toContain("unavailable");
      expect(sentence, key).not.toContain("not supported");
    }
  });

  it("never claims to know about paired devices or a wearable's last sync", () => {
    // pairedDevices.list needs googlehealth.settings.readonly, a scope this
    // project deliberately never requested -- so no copy may imply we can see
    // a device inventory or a wearable's sync time.
    for (const [key, sentence] of Object.entries(METRIC_EXPLANATIONS)) {
      const lower = sentence.toLowerCase();
      expect(lower, key).not.toContain("your watch");
      expect(lower, key).not.toContain("your device");
      expect(lower, key).not.toContain("paired");
      expect(lower, key).not.toContain("last synced");
    }
  });

  it("offers no medical interpretation, recommendation or premium-feature claim", () => {
    const forbidden = [
      "should",
      "recommend",
      "healthy",
      "risk",
      "normal range",
      "diagnos",
      "premium",
      "coaching",
    ];
    for (const [key, sentence] of Object.entries(METRIC_EXPLANATIONS)) {
      const lower = sentence.toLowerCase();
      for (const word of forbidden) {
        expect(lower, `${key} / ${word}`).not.toContain(word);
      }
    }
  });
});

describe("isMetricMissing", () => {
  it("is false only for a real value", () => {
    const states: HealthMetricDisplayState[] = [
      "value",
      "recorded_none",
      "awaiting_first_data",
      "not_checked",
      "sync_disabled",
      "needs_scope",
      "unsupported",
      "provider_issue",
    ];
    const notMissing = states.filter((state) => !isMetricMissing(state));
    expect(notMissing).toEqual(["value"]);
  });
});
