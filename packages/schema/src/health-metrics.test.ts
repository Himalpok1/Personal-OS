import { describe, expect, it } from "vitest";
import type { z } from "zod";
import {
  ConnectGoogleHealthRequestSchema,
  HEALTH_MAX_RANGE_DAYS,
  HealthAuthorizeUrlQuerySchema,
  HealthBackfillRequestSchema,
  HealthConnectionSchema,
  HealthMetricPointSchema,
  HealthMetricsQuerySchema,
  HealthSeriesQuerySchema,
  HealthSessionRangeQuerySchema,
  HealthStreamUpdateSchema,
  HealthSummaryQuerySchema,
  HealthSummaryResponseSchema,
  HealthSyncRequestSchema,
} from "./health-metrics.js";

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "google_health",
  health_user_id: "hu-abc",
  legacy_user_id: null,
  granted_scope: "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  source_family: "users/me/dataSourceFamilies/all-sources",
  status: "active",
  identity_verified_at: null,
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-08-24T00:00:00.000Z",
  updated_at: "2026-08-24T00:00:00.000Z",
};

describe("HealthConnectionSchema is structurally credential-free", () => {
  it("parses a valid connection", () => {
    expect(HealthConnectionSchema.parse(CONNECTION).health_user_id).toBe("hu-abc");
  });

  // The security property is structural, not a matter of remembering to omit
  // fields at the call site: the shape simply has no key that could carry a
  // secret. Same guarantee ai-provider.ts and calendar-connections.ts rely on.
  it("has no key for any token, ciphertext, iv or auth tag", () => {
    const keys = Object.keys(HealthConnectionSchema.shape);
    for (const forbidden of [
      "access_token",
      "refresh_token",
      "ciphertext",
      "iv",
      "auth_tag",
      "state",
      "client_secret",
    ]) {
      expect(keys.some((k) => k.includes(forbidden))).toBe(false);
    }
  });

  // The three approved read scopes return no email and no id_token, so an
  // account email is not merely absent -- it is not obtainable. Asserting its
  // absence stops a future change quietly promising one.
  it("exposes no account email", () => {
    const keys = Object.keys(HealthConnectionSchema.shape);
    expect(keys.some((k) => k.includes("email"))).toBe(false);
  });
});

describe("request schemas are strict", () => {
  it("rejects an unknown key on the connect request", () => {
    expect(() =>
      ConnectGoogleHealthRequestSchema.parse({
        auth_code: "code",
        redirect_uri: "https://example.test/cb",
        state: "s",
        extra: true,
      }),
    ).toThrow();
  });

  it("requires state on the connect request", () => {
    expect(() =>
      ConnectGoogleHealthRequestSchema.parse({
        auth_code: "code",
        redirect_uri: "https://example.test/cb",
      }),
    ).toThrow();
  });

  it("rejects a non-URL redirect_uri", () => {
    expect(() => HealthAuthorizeUrlQuerySchema.parse({ redirect_uri: "not-a-url" })).toThrow();
  });

  it("rejects an unknown key on a stream update", () => {
    expect(() =>
      HealthStreamUpdateSchema.parse({ metric: "steps", sync_enabled: true, force: true }),
    ).toThrow();
  });

  it("rejects a non-date backfill target", () => {
    expect(() => HealthBackfillRequestSchema.parse({ target_date: "2026-08" })).toThrow();
  });

  it("defaults a sync request to the authoritative warm kind", () => {
    expect(HealthSyncRequestSchema.parse({}).kind).toBe("warm");
  });

  it("does not accept backfill as an on-demand sync kind", () => {
    // Backfill has its own endpoint, its own queue and its own cursor; letting
    // it be requested here would bypass all three.
    expect(() => HealthSyncRequestSchema.parse({ kind: "backfill" })).toThrow();
  });
});

describe("range and timezone validation", () => {
  it("rejects an inverted range", () => {
    expect(() =>
      HealthMetricsQuerySchema.parse({ metric: "steps", from: "2026-08-24", to: "2026-08-20" }),
    ).toThrow();
  });

  it("rejects an empty range", () => {
    expect(() =>
      HealthMetricsQuerySchema.parse({ metric: "steps", from: "2026-08-24", to: "2026-08-24" }),
    ).toThrow();
  });

  it("accepts a valid range and defaults include_empty to true", () => {
    const q = HealthMetricsQuerySchema.parse({
      metric: "steps",
      from: "2026-08-20",
      to: "2026-08-24",
    });
    expect(q.include_empty).toBe(true);
  });

  // booleanQueryParam, not z.coerce.boolean() -- Boolean("false") is true, the
  // bug that silently inverted include_archived API-wide in Phase 2.
  it("honours an explicit include_empty=false", () => {
    const q = HealthMetricsQuerySchema.parse({
      metric: "steps",
      from: "2026-08-20",
      to: "2026-08-24",
      include_empty: "false",
    });
    expect(q.include_empty).toBe(false);
  });

  it("rejects an unknown IANA timezone", () => {
    expect(() => HealthSummaryQuerySchema.parse({ tz: "Mars/Olympus" })).toThrow();
    expect(HealthSummaryQuerySchema.parse({ tz: "Pacific/Kiritimati" }).tz).toBe(
      "Pacific/Kiritimati",
    );
  });
});

// ---------------------------------------------------------------------------
// 6.4 read-surface contracts
// ---------------------------------------------------------------------------
// The four shapes below are what every 6.4 client -- web, Rabbit, and any
// future one -- is allowed to assume. They are asserted here, directly against
// the schemas, rather than only through a route: a route test proves what one
// handler happens to emit today, while these prove what the CONTRACT permits,
// which is the thing a second consumer would rely on.

describe("HealthMetricPointSchema -- the missing-is-not-zero refine", () => {
  // This is the invariant the whole checkpoint exists to protect. A genuine
  // recorded zero and an absence are different facts, and the point shape is
  // where they stop being confusable: `value` is non-null EXACTLY when state
  // is "value", so "no value" cannot be spelled as a number and a real zero
  // cannot be spelled as absence.
  it("accepts a genuine recorded zero as a value", () => {
    const parsed = HealthMetricPointSchema.parse({
      local_date: "2026-08-24",
      state: "value",
      value: "0",
      source_count: 1,
    });
    expect(parsed.state).toBe("value");
    expect(parsed.value).toBe("0");
  });

  it("rejects a 'value' point carrying no value", () => {
    expect(() =>
      HealthMetricPointSchema.parse({
        local_date: "2026-08-24",
        state: "value",
        value: null,
        source_count: null,
      }),
    ).toThrow(/value must be non-null exactly when state is 'value'/);
  });

  it("rejects an 'unknown' point carrying a value", () => {
    // The dangerous direction: a number smuggled onto a day we never verified
    // would render as fact.
    expect(() =>
      HealthMetricPointSchema.parse({
        local_date: "2026-08-24",
        state: "unknown",
        value: "5",
        source_count: null,
      }),
    ).toThrow(/value must be non-null exactly when state is 'value'/);
  });

  it("rejects a 'verified_absent' point carrying a value", () => {
    expect(() =>
      HealthMetricPointSchema.parse({
        local_date: "2026-08-24",
        state: "verified_absent",
        value: "0",
        source_count: null,
      }),
    ).toThrow(/value must be non-null exactly when state is 'value'/);
  });

  it("accepts a verified absence with no value", () => {
    const parsed = HealthMetricPointSchema.parse({
      local_date: "2026-08-24",
      state: "verified_absent",
      value: null,
      source_count: null,
    });
    expect(parsed.value).toBeNull();
  });

  it("rejects a state outside the three-member vocabulary", () => {
    expect(() =>
      HealthMetricPointSchema.parse({
        local_date: "2026-08-24",
        state: "no_wearable_paired",
        value: null,
        source_count: null,
      }),
    ).toThrow();
  });
});

describe("HealthSeriesQuerySchema", () => {
  const base = { metric: "steps", from: "2026-01-01", to: "2026-01-07" };

  it("accepts exactly HEALTH_MAX_RANGE_DAYS inclusive days", () => {
    // 2026-01-01 .. 2027-01-01 inclusive is 366 days (2026 is not a leap year,
    // so this is 365 + the inclusive endpoint).
    const parsed = HealthSeriesQuerySchema.parse({
      metric: "steps",
      from: "2026-01-01",
      to: "2027-01-01",
    });
    expect(parsed.to).toBe("2027-01-01");
    expect(HEALTH_MAX_RANGE_DAYS).toBe(366);
  });

  it("rejects one day beyond the cap", () => {
    expect(() =>
      HealthSeriesQuerySchema.parse({ metric: "steps", from: "2026-01-01", to: "2027-01-02" }),
    ).toThrow(/range must not exceed 366 days/);
  });

  it("rejects an inverted range by name, not as a generic failure", () => {
    expect(() =>
      HealthSeriesQuerySchema.parse({ metric: "steps", from: "2026-01-07", to: "2026-01-01" }),
    ).toThrow(/from must not be after to/);
  });

  it("accepts a single-day range, because `to` is inclusive", () => {
    // The half-open windows the sync engine uses internally would make this
    // empty; a user-facing query must not inherit that off-by-one.
    expect(
      HealthSeriesQuerySchema.parse({ metric: "steps", from: "2026-01-01", to: "2026-01-01" }).from,
    ).toBe("2026-01-01");
  });

  it("is strict about unknown keys", () => {
    expect(() => HealthSeriesQuerySchema.parse({ ...base, connection_id: "x" })).toThrow();
  });

  it("requires a non-empty metric", () => {
    expect(() => HealthSeriesQuerySchema.parse({ ...base, metric: "" })).toThrow();
  });

  it("rejects a date that is not a calendar date", () => {
    expect(() => HealthSeriesQuerySchema.parse({ ...base, from: "2026-01" })).toThrow();
    expect(() => HealthSeriesQuerySchema.parse({ ...base, from: "2026-02-30" })).toThrow();
  });

  it("defaults include_empty to true and honours both explicit strings", () => {
    // booleanQueryParam, never z.coerce.boolean(): Boolean("false") is true,
    // the bug that silently inverted include_archived API-wide in Phase 2.
    expect(HealthSeriesQuerySchema.parse(base).include_empty).toBe(true);
    expect(HealthSeriesQuerySchema.parse({ ...base, include_empty: "true" }).include_empty).toBe(
      true,
    );
    expect(HealthSeriesQuerySchema.parse({ ...base, include_empty: "false" }).include_empty).toBe(
      false,
    );
  });

  it("rejects a boolean-ish string that is not exactly true or false", () => {
    expect(() => HealthSeriesQuerySchema.parse({ ...base, include_empty: "0" })).toThrow();
  });
});

describe("HealthSessionRangeQuerySchema", () => {
  const base = { from: "2026-01-01", to: "2026-01-07" };

  it("applies the documented pagination defaults", () => {
    const parsed = HealthSessionRangeQuerySchema.parse(base);
    expect(parsed.limit).toBe(50);
    expect(parsed.offset).toBe(0);
  });

  it("shares the series range rules rather than inventing its own", () => {
    expect(HealthSessionRangeQuerySchema.parse({ from: "2026-01-01", to: "2027-01-01" }).to).toBe(
      "2027-01-01",
    );
    expect(() =>
      HealthSessionRangeQuerySchema.parse({ from: "2026-01-01", to: "2027-01-02" }),
    ).toThrow(/range must not exceed 366 days/);
    expect(() =>
      HealthSessionRangeQuerySchema.parse({ from: "2026-01-07", to: "2026-01-01" }),
    ).toThrow(/from must not be after to/);
  });

  it("bounds limit at both ends", () => {
    expect(HealthSessionRangeQuerySchema.parse({ ...base, limit: "200" }).limit).toBe(200);
    expect(() => HealthSessionRangeQuerySchema.parse({ ...base, limit: "201" })).toThrow();
    expect(HealthSessionRangeQuerySchema.parse({ ...base, limit: "1" }).limit).toBe(1);
    expect(() => HealthSessionRangeQuerySchema.parse({ ...base, limit: "0" })).toThrow();
    expect(() => HealthSessionRangeQuerySchema.parse({ ...base, limit: "1.5" })).toThrow();
  });

  it("rejects a negative offset", () => {
    expect(() => HealthSessionRangeQuerySchema.parse({ ...base, offset: "-1" })).toThrow();
  });

  it("is strict about unknown keys", () => {
    expect(() => HealthSessionRangeQuerySchema.parse({ ...base, metric: "sleep" })).toThrow();
  });
});

/**
 * Every key name reachable anywhere in a schema's shape, at any depth.
 *
 * Walking the SCHEMA rather than a sample instance is the point: a fixture can
 * only prove that one payload happened to carry no secret, whereas the shape
 * proves that no payload CAN. Objects recurse through `.shape`, arrays through
 * `.element`, and nullable/optional/default wrappers through `.unwrap()`.
 */
function schemaKeyNames(schema: unknown, seen = new Set<unknown>()): Set<string> {
  const keys = new Set<string>();
  const visit = (node: unknown): void => {
    if (node === null || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);

    const candidate = node as {
      shape?: Record<string, unknown>;
      element?: unknown;
      unwrap?: () => unknown;
    };

    if (candidate.shape !== undefined && typeof candidate.shape === "object") {
      for (const [key, child] of Object.entries(candidate.shape)) {
        keys.add(key);
        visit(child);
      }
      return;
    }
    if (candidate.element !== undefined) {
      visit(candidate.element);
      return;
    }
    if (typeof candidate.unwrap === "function") {
      visit(candidate.unwrap());
    }
  };
  visit(schema);
  return keys;
}

describe("HealthSummaryResponseSchema", () => {
  // `as const` so `state` narrows to the enum member rather than widening to
  // string -- without it the MINIMAL payload below is not assignable to
  // z.input<...>, and typing it loosely would defeat the point of asserting
  // against the real input type.
  const POINT = {
    local_date: "2026-08-24",
    state: "unknown",
    value: null,
    source_count: null,
  } as const;

  const MINIMAL: z.input<typeof HealthSummaryResponseSchema> = {
    configured: true,
    connection: null,
    timezone: "America/Chicago",
    local_date: "2026-08-24",
    freshness: {
      last_successful_sync_at: null,
      last_attempted_sync_at: null,
      last_attempt_status: null,
      verified_through_date: null,
      days_behind: null,
      is_stale: true,
      staleness_threshold_days: 35,
      sync_in_progress: false,
    },
    today: [{ metric: "steps", unit: "count", aggregation: "sum", point: POINT }],
    latest: [],
    latest_sleep: null,
    sleep_7d_average_seconds: null,
    latest_workout: null,
    capabilities: [],
  };

  it("parses a minimal honest-empty payload", () => {
    const parsed = HealthSummaryResponseSchema.parse(MINIMAL);
    expect(parsed.connection).toBeNull();
    expect(parsed.today[0]?.point.state).toBe("unknown");
    // Nothing verified is not the same as up to date.
    expect(parsed.freshness.is_stale).toBe(true);
  });

  it("rejects a tile whose point violates the missing-is-not-zero refine", () => {
    expect(() =>
      HealthSummaryResponseSchema.parse({
        ...MINIMAL,
        today: [
          {
            metric: "steps",
            unit: "count",
            aggregation: "sum",
            point: { ...POINT, state: "unknown", value: "1200" },
          },
        ],
      }),
    ).toThrow(/value must be non-null exactly when state is 'value'/);
  });

  it("rejects an aggregation outside the declared vocabulary", () => {
    expect(() =>
      HealthSummaryResponseSchema.parse({
        ...MINIMAL,
        today: [{ metric: "steps", unit: "count", aggregation: "median", point: POINT }],
      }),
    ).toThrow();
  });

  // The structural claim, made about the contract rather than about a fixture:
  // there is no key ANYWHERE in this response -- at any depth, inside any
  // nested object or array -- that could carry credential material or the raw
  // provider error message. A screen cannot leak what the shape cannot spell.
  it("has no key anywhere that could carry a secret or a raw provider error", () => {
    const keys = schemaKeyNames(HealthSummaryResponseSchema);
    for (const forbidden of [
      "last_sync_error",
      "access_token",
      "refresh_token",
      "ciphertext",
      "iv",
      "auth_tag",
    ]) {
      expect(
        [...keys].filter((k) => k === forbidden),
        forbidden,
      ).toEqual([]);
    }
    // Positive control: the walker really did descend into the nested shapes,
    // so the absences above are evidence rather than an empty set.
    expect(keys.has("last_sync_error_at")).toBe(true); // HealthConnectionSummary
    expect(keys.has("source_count")).toBe(true); // HealthMetricPoint, two levels down
    expect(keys.has("wake_local_date")).toBe(true); // HealthSleepSession, nullable
    expect(keys.has("first_data_date")).toBe(true); // HealthMetricCapability, in an array
  });
});
