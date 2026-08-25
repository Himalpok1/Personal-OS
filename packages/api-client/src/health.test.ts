import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import {
  getHealthMetricSeries,
  getHealthSleepSessions,
  getHealthSummary,
  getHealthWorkoutSessions,
  listHealthConnections,
  listHealthMetricStreams,
  syncHealthConnectionNow,
} from "./health.js";

const BASE = "http://localhost:3000";
const CONNECTION_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

// Every numeric below is invented for the fixture. Nothing here is a real
// measurement from any account.

const capability = {
  metric: "steps",
  unit: "count",
  aggregation: "sum",
  sync_enabled: true,
  capability_status: "available_in_window",
  capability_checked_at: "2026-08-25T09:00:00.000Z",
  verified_through_date: "2026-08-24",
  earliest_verified_date: "2026-07-01",
  first_data_date: "2026-07-01",
  last_successful_sync_at: "2026-08-25T09:00:00.000Z",
  backfill_status: "idle",
};

const freshness = {
  last_successful_sync_at: "2026-08-25T09:00:00.000Z",
  last_attempted_sync_at: "2026-08-25T09:00:00.000Z",
  last_attempt_status: "succeeded",
  verified_through_date: "2026-08-24",
  days_behind: 1,
  is_stale: false,
  staleness_threshold_days: 35,
  sync_in_progress: false,
};

const connectionSummary = {
  id: CONNECTION_ID,
  provider: "google_health",
  status: "active",
  identity_verified_at: "2026-08-24T23:57:45.000Z",
  granted_scopes: ["activity_and_fitness.readonly"],
  missing_scopes: [],
  has_partial_scope: false,
  needs_reconnect: false,
  has_sync_error: false,
  last_sync_error_at: null,
};

const sourceIdentity = {
  recording_method: "PASSIVELY_MEASURED",
  device_form_factor: "PHONE",
  application_platform: "HEALTH_KIT",
};

const sleepSession = {
  id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  wake_local_date: "2026-08-25",
  start_at: "2026-08-25T04:00:00.000Z",
  end_at: "2026-08-25T11:00:00.000Z",
  start_utc_offset_seconds: -18000,
  end_utc_offset_seconds: -18000,
  duration_seconds: 25200,
  session_type: "SLEEP",
  session_subtype: null,
  source: sourceIdentity,
  // Always null today -- the 6.3 sync engine stores no stage breakdown. The
  // fields exist so a client renders an honest "not available" from the
  // contract rather than hardcoding the absence.
  stages: null,
  asleep_seconds: null,
  awake_seconds: null,
};

const workoutSession = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  start_local_date: "2026-08-24",
  start_at: "2026-08-24T17:00:00.000Z",
  end_at: "2026-08-24T17:30:00.000Z",
  start_utc_offset_seconds: -18000,
  end_utc_offset_seconds: -18000,
  duration_seconds: 1800,
  session_type: "WALKING",
  session_subtype: null,
  source: sourceIdentity,
  distance_meters: null,
  calories_kcal: null,
  heart_rate_zones: null,
};

const tile = {
  metric: "steps",
  unit: "count",
  aggregation: "sum",
  point: { local_date: "2026-08-25", state: "value", value: "1234", source_count: 1 },
};

const summaryResponse = {
  configured: true,
  connection: connectionSummary,
  timezone: "America/Chicago",
  local_date: "2026-08-25",
  freshness,
  today: [tile],
  latest: [tile],
  latest_sleep: sleepSession,
  sleep_7d_average_seconds: 25200,
  latest_workout: workoutSession,
  capabilities: [capability],
};

const seriesResponse = {
  metric: "steps",
  unit: "count",
  aggregation: "sum",
  from: "2026-08-23",
  to: "2026-08-25",
  capability,
  points: [
    { local_date: "2026-08-23", state: "value", value: "1234", source_count: 1 },
    { local_date: "2026-08-24", state: "verified_absent", value: null, source_count: null },
    { local_date: "2026-08-25", state: "unknown", value: null, source_count: null },
  ],
  summary: {
    days_in_range: 3,
    days_with_value: 1,
    days_verified_absent: 1,
    days_unknown: 1,
    min: "1234",
    max: "1234",
    average: "1234",
    total: "1234",
  },
};

const sleepListResponse = { items: [sleepSession], limit: 50, offset: 0, total: 1 };
const workoutListResponse = { items: [workoutSession], limit: 50, offset: 0, total: 1 };

const connectionListResponse = {
  items: [
    {
      id: CONNECTION_ID,
      provider: "google_health",
      health_user_id: "health-user-id",
      legacy_user_id: null,
      granted_scope: "activity_and_fitness.readonly",
      source_family: "all-sources",
      status: "active",
      identity_verified_at: "2026-08-24T23:57:45.000Z",
      last_sync_error: null,
      last_sync_error_at: null,
      created_at: "2026-08-24T23:57:45.000Z",
      updated_at: "2026-08-25T09:00:00.000Z",
    },
  ],
};

const streamListResponse = {
  items: [
    {
      id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
      connection_id: CONNECTION_ID,
      metric: "steps",
      sync_enabled: true,
      capability_status: "available_in_window",
      capability_checked_at: "2026-08-25T09:00:00.000Z",
      verified_through_date: "2026-08-24",
      earliest_verified_date: "2026-07-01",
      first_data_date: "2026-07-01",
      last_successful_sync_at: "2026-08-25T09:00:00.000Z",
      last_full_sync_at: null,
      backfill_status: "idle",
      backfill_target_date: null,
      backfill_cursor_date: null,
      backfill_cancel_requested: false,
      last_sync_error: null,
    },
  ],
};

function okResponse(body: unknown) {
  return vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}

function calledUrl(fetchMock: ReturnType<typeof vi.fn>): string {
  const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
  return url.toString();
}

function calledInit(fetchMock: ReturnType<typeof vi.fn>): RequestInit {
  const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
  return init;
}

describe("health api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("getHealthSummary", () => {
    it("percent-encodes the IANA timezone's slash in the query string", async () => {
      const fetchMock = okResponse(summaryResponse);
      global.fetch = fetchMock;

      await getHealthSummary(BASE, "America/Chicago");

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-summary?tz=America%2FChicago`);
    });

    it("parses the full summary shape and sends no Content-Type on the bodyless GET", async () => {
      const fetchMock = okResponse(summaryResponse);
      global.fetch = fetchMock;

      const res = await getHealthSummary(BASE, "America/Chicago");

      expect(res).toEqual(summaryResponse);
      expect((calledInit(fetchMock).headers as Record<string, string>)["Content-Type"]).toBe(
        undefined,
      );
    });
  });

  describe("getHealthMetricSeries", () => {
    it("builds /health-metrics with metric, from and inclusive to", async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await getHealthMetricSeries(BASE, {
        metric: "heart-rate",
        from: "2026-08-23",
        to: "2026-08-25",
      });

      expect(calledUrl(fetchMock)).toBe(
        `${BASE}/health-metrics?metric=heart-rate&from=2026-08-23&to=2026-08-25`,
      );
    });

    it('serialises include_empty: false as the literal string "false"', async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await getHealthMetricSeries(BASE, {
        metric: "steps",
        from: "2026-08-23",
        to: "2026-08-25",
        include_empty: false,
      });

      // Asserted on the URL rather than on the parsed params because the wire
      // spelling is the whole point: the server reads this through
      // booleanQueryParam, which accepts only the exact strings "true" and
      // "false". The Phase 2 defect was `z.coerce.boolean()` running
      // Boolean("false") -- which is true -- so any client that explicitly
      // sent the flag got the opposite of what it asked for.
      expect(calledUrl(fetchMock)).toBe(
        `${BASE}/health-metrics?metric=steps&from=2026-08-23&to=2026-08-25&include_empty=false`,
      );
    });

    it('serialises include_empty: true as the literal string "true"', async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await getHealthMetricSeries(BASE, {
        metric: "steps",
        from: "2026-08-23",
        to: "2026-08-25",
        include_empty: true,
      });

      expect(calledUrl(fetchMock)).toContain("include_empty=true");
    });

    it("omits include_empty entirely when the caller states no opinion", async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await getHealthMetricSeries(BASE, {
        metric: "steps",
        from: "2026-08-23",
        to: "2026-08-25",
      });

      expect(calledUrl(fetchMock)).not.toContain("include_empty");
    });

    it("rejects a range over 366 days client-side, before any request is made", async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await expect(
        getHealthMetricSeries(BASE, {
          metric: "steps",
          from: "2026-01-01",
          // Inclusive span 367 -- one day past HEALTH_MAX_RANGE_DAYS.
          to: "2027-01-02",
        }),
      ).rejects.toThrow(/366/);

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("accepts a range of exactly 366 days", async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await getHealthMetricSeries(BASE, {
        metric: "steps",
        from: "2026-01-01",
        to: "2027-01-01",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    it("rejects an inverted range client-side, before any request is made", async () => {
      const fetchMock = okResponse(seriesResponse);
      global.fetch = fetchMock;

      await expect(
        getHealthMetricSeries(BASE, {
          metric: "steps",
          from: "2026-08-25",
          to: "2026-08-23",
        }),
      ).rejects.toThrow();

      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("parses all three value states, keeping a true zero distinct from missing", async () => {
      const trueZeroResponse = {
        ...seriesResponse,
        points: [
          // has_data = true with an exact zero. This is a recorded fact, not
          // absence, and it must survive the boundary parse as `state:
          // "value"` -- collapsing it into verified_absent or unknown is the
          // "missing is never zero" violation ADR-047 exists to prevent.
          { local_date: "2026-08-23", state: "value", value: "0", source_count: 1 },
          { local_date: "2026-08-24", state: "verified_absent", value: null, source_count: null },
          { local_date: "2026-08-25", state: "unknown", value: null, source_count: null },
        ],
      };
      global.fetch = okResponse(trueZeroResponse);

      const res = await getHealthMetricSeries(BASE, {
        metric: "steps",
        from: "2026-08-23",
        to: "2026-08-25",
      });

      expect(res.points[0]).toEqual({
        local_date: "2026-08-23",
        state: "value",
        value: "0",
        source_count: 1,
      });
      expect(res.points[1]?.value).toBeNull();
      expect(res.points[2]?.value).toBeNull();
    });

    it("rejects a point whose state is 'unknown' but which still carries a value", async () => {
      // The frozen refine says `value` is non-null exactly when
      // `state === "value"`. A server regression that zero-filled a gap while
      // leaving the state as unknown is precisely the shape that would make a
      // dashboard render a fabricated number, so it must fail loudly at the
      // client boundary rather than being displayed.
      const contradictoryResponse = {
        ...seriesResponse,
        points: [{ local_date: "2026-08-23", state: "unknown", value: "1234", source_count: 1 }],
      };
      global.fetch = okResponse(contradictoryResponse);

      await expect(
        getHealthMetricSeries(BASE, {
          metric: "steps",
          from: "2026-08-23",
          to: "2026-08-25",
        }),
      ).rejects.toThrow();
    });

    it("rejects a point whose state is 'value' but whose value is null", async () => {
      const contradictoryResponse = {
        ...seriesResponse,
        points: [{ local_date: "2026-08-23", state: "value", value: null, source_count: null }],
      };
      global.fetch = okResponse(contradictoryResponse);

      await expect(
        getHealthMetricSeries(BASE, {
          metric: "steps",
          from: "2026-08-23",
          to: "2026-08-25",
        }),
      ).rejects.toThrow();
    });

    it("throws ApiClientError carrying the status and error code on a non-2xx", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "health_not_configured" }), {
          status: 409,
        }),
      );

      await expect(
        getHealthMetricSeries(BASE, {
          metric: "steps",
          from: "2026-08-23",
          to: "2026-08-25",
        }),
      ).rejects.toSatisfy((err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(409);
        expect((err as ApiClientError).code).toBe("health_not_configured");
        return true;
      });
    });
  });

  describe("getHealthSleepSessions", () => {
    it("builds /health-sleep with from, to, limit and offset", async () => {
      const fetchMock = okResponse(sleepListResponse);
      global.fetch = fetchMock;

      await getHealthSleepSessions(BASE, {
        from: "2026-08-01",
        to: "2026-08-25",
        limit: 10,
        offset: 20,
      });

      expect(calledUrl(fetchMock)).toBe(
        `${BASE}/health-sleep?from=2026-08-01&to=2026-08-25&limit=10&offset=20`,
      );
    });

    it("omits limit and offset when absent, leaving the server's defaults to apply", async () => {
      const fetchMock = okResponse(sleepListResponse);
      global.fetch = fetchMock;

      const res = await getHealthSleepSessions(BASE, { from: "2026-08-01", to: "2026-08-25" });

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-sleep?from=2026-08-01&to=2026-08-25`);
      expect(res).toEqual(sleepListResponse);
    });

    it("rejects a range over 366 days client-side, before any request is made", async () => {
      const fetchMock = okResponse(sleepListResponse);
      global.fetch = fetchMock;

      await expect(
        getHealthSleepSessions(BASE, { from: "2026-01-01", to: "2027-01-02" }),
      ).rejects.toThrow(/366/);

      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("getHealthWorkoutSessions", () => {
    it("builds /health-workouts with from and to", async () => {
      const fetchMock = okResponse(workoutListResponse);
      global.fetch = fetchMock;

      const res = await getHealthWorkoutSessions(BASE, { from: "2026-08-01", to: "2026-08-25" });

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-workouts?from=2026-08-01&to=2026-08-25`);
      expect(res).toEqual(workoutListResponse);
    });
  });

  describe("listHealthConnections", () => {
    it("requests /health-connections and parses the items envelope", async () => {
      const fetchMock = okResponse(connectionListResponse);
      global.fetch = fetchMock;

      const res = await listHealthConnections(BASE);

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-connections`);
      expect(res).toEqual(connectionListResponse);
    });
  });

  describe("listHealthMetricStreams", () => {
    it("interpolates the connection id into the streams path", async () => {
      const fetchMock = okResponse(streamListResponse);
      global.fetch = fetchMock;

      const res = await listHealthMetricStreams(BASE, CONNECTION_ID);

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-connections/${CONNECTION_ID}/streams`);
      expect(res).toEqual(streamListResponse);
    });

    it("percent-encodes a connection id that is not path-safe", async () => {
      const fetchMock = okResponse(streamListResponse);
      global.fetch = fetchMock;

      await listHealthMetricStreams(BASE, "a/b");

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-connections/a%2Fb/streams`);
    });
  });

  describe("syncHealthConnectionNow", () => {
    it("defaults to kind 'warm' and sends a real JSON body with Content-Type", async () => {
      const fetchMock = okResponse({ queued: 1 });
      global.fetch = fetchMock;

      const res = await syncHealthConnectionNow(BASE, CONNECTION_ID);

      expect(calledUrl(fetchMock)).toBe(`${BASE}/health-connections/${CONNECTION_ID}/sync`);
      const init = calledInit(fetchMock);
      expect(init.method).toBe("POST");
      expect(init.body).toBe(JSON.stringify({ kind: "warm" }));
      // Unlike the bodyless action POSTs in this package, this request really
      // does carry JSON, so the header is correct here rather than a 400.
      expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
      expect(res).toEqual({ queued: 1 });
    });

    it("sends kind 'hot' when explicitly requested", async () => {
      const fetchMock = okResponse({ queued: 1 });
      global.fetch = fetchMock;

      await syncHealthConnectionNow(BASE, CONNECTION_ID, "hot");

      expect(calledInit(fetchMock).body).toBe(JSON.stringify({ kind: "hot" }));
    });

    it("throws ApiClientError when the connection needs reauth", async () => {
      global.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "health_connection_needs_reauth" }), {
          status: 409,
        }),
      );

      await expect(syncHealthConnectionNow(BASE, CONNECTION_ID)).rejects.toSatisfy(
        (err: unknown) => {
          expect(err).toBeInstanceOf(ApiClientError);
          expect((err as ApiClientError).code).toBe("health_connection_needs_reauth");
          return true;
        },
      );
    });
  });
});
