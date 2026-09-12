import { describe, expect, it } from "vitest";
import {
  MonitorCheckSchema,
  MonitorTargetCreateSchema,
  MonitorTargetListQuerySchema,
  MonitorTargetUpdateSchema,
  MonitorUptimePointSchema,
  sanitizeMonitorFailureClass,
  MonitorIncidentListQuerySchema,
  MonitorLatestCheckSchema,
  MonitorOverviewResponseSchema,
  MonitorTargetStatusSchema,
} from "./monitor.js";

const AT = "2026-09-01T12:00:00.000Z";

describe("MonitorUptimePointSchema", () => {
  // THE REFINE IS THE POINT. ADR-055 requires a three-state uptime model
  // precisely so a window in which the monitor was NOT RUNNING can never render
  // as 0% -- the same failure `HealthMetricPoint` was designed against, where a
  // missing measurement is presented as a real zero.

  it("accepts a measured window with a ratio", () => {
    for (const [state, ratio] of [
      ["up", 1],
      ["up", 0.98],
      ["down", 0],
    ] as const) {
      expect(MonitorUptimePointSchema.safeParse({ at: AT, state, ratio }).success).toBe(true);
    }
  });

  it("accepts an unmeasured window with a null ratio", () => {
    expect(
      MonitorUptimePointSchema.safeParse({ at: AT, state: "not_checked", ratio: null }).success,
    ).toBe(true);
  });

  it("REJECTS a not_checked window carrying a ratio, including 0", () => {
    // This is the exact defect the model exists to prevent: an hour nobody
    // monitored, reported as an hour of total downtime.
    for (const ratio of [0, 1, 0.5]) {
      const result = MonitorUptimePointSchema.safeParse({ at: AT, state: "not_checked", ratio });
      expect(result.success).toBe(false);
    }
  });

  it("REJECTS a measured window with no ratio", () => {
    // The other direction matters too: claiming a state without the number
    // behind it invites a renderer to substitute one.
    for (const state of ["up", "down"] as const) {
      expect(MonitorUptimePointSchema.safeParse({ at: AT, state, ratio: null }).success).toBe(
        false,
      );
    }
  });

  it("REJECTS a ratio outside 0..1", () => {
    for (const ratio of [-0.01, 1.01, 100]) {
      expect(MonitorUptimePointSchema.safeParse({ at: AT, state: "up", ratio }).success).toBe(
        false,
      );
    }
  });
});

describe("sanitizeMonitorFailureClass", () => {
  it("passes a bare token through unchanged", () => {
    for (const token of ["timeout", "unreachable", "tls_expiring", "worker_heartbeat_stale"]) {
      expect(sanitizeMonitorFailureClass(token)).toBe(token);
    }
  });

  it("passes a qualified token through unchanged", () => {
    expect(sanitizeMonitorFailureClass("http_status:503")).toBe("http_status:503");
    expect(sanitizeMonitorFailureClass("tls_error:UNABLE_TO_VERIFY")).toBe(
      "tls_error:UNABLE_TO_VERIFY",
    );
  });

  it("collapses PROSE to probe_error", () => {
    // The whole reason the shape is constrained: prose has spaces, capitals and
    // punctuation, so a writer reaching for `err.message` fails here rather than
    // in a durable column. Note the first two carry a URL and a token -- exactly
    // what a fetch failure's message looks like.
    for (const prose of [
      "fetch failed for https://internal.example/health?token=SUPERSECRET",
      "Error: connect ECONNREFUSED 10.0.0.4:3000",
      "Failing row contains (...)",
      "Timeout",
      " timeout",
    ]) {
      expect(sanitizeMonitorFailureClass(prose)).toBe("probe_error");
    }
  });

  it("collapses an over-long token rather than storing it", () => {
    expect(sanitizeMonitorFailureClass("a".repeat(200))).toBe("probe_error");
    expect(sanitizeMonitorFailureClass(`http_status:${"9".repeat(200)}`)).toBe("probe_error");
  });

  it("maps absent and empty to null, never to a token", () => {
    // Null means "this check did not fail". Turning it into `probe_error` would
    // invent a failure on every healthy check.
    expect(sanitizeMonitorFailureClass(null)).toBeNull();
    expect(sanitizeMonitorFailureClass(undefined)).toBeNull();
    expect(sanitizeMonitorFailureClass("")).toBeNull();
  });

  it("is what MonitorCheckSchema will accept, so the two cannot drift", () => {
    // A sanitizer that produced something the wire schema rejects would turn a
    // defensive measure into an outage of its own.
    for (const raw of ["timeout", "prose with spaces", "a".repeat(200), "http_status:503"]) {
      const sanitized = sanitizeMonitorFailureClass(raw);
      const result = MonitorCheckSchema.shape.failure_class.safeParse(sanitized);
      expect(result.success).toBe(true);
    }
  });
});

describe("MonitorTargetCreateSchema", () => {
  const http = { name: "api", kind: "http", url: "http://api:3000/health" } as const;

  it("accepts a minimal http target and a minimal heartbeat target", () => {
    expect(MonitorTargetCreateSchema.safeParse(http).success).toBe(true);
    expect(
      MonitorTargetCreateSchema.safeParse({ name: "worker", kind: "worker_heartbeat" }).success,
    ).toBe(true);
  });

  it("REJECTS an http target with no url", () => {
    // An unmonitorable target is worse than no target: it looks configured.
    expect(MonitorTargetCreateSchema.safeParse({ name: "api", kind: "http" }).success).toBe(false);
    expect(
      MonitorTargetCreateSchema.safeParse({ name: "api", kind: "http", url: null }).success,
    ).toBe(false);
  });

  it("REJECTS a worker_heartbeat target that carries a url", () => {
    // It observes a table, not an endpoint. A URL here would mean somebody
    // expected an HTTP probe and will not get one.
    expect(
      MonitorTargetCreateSchema.safeParse({
        name: "worker",
        kind: "worker_heartbeat",
        url: "http://worker:3000/health",
      }).success,
    ).toBe(false);
  });

  it("REJECTS tls_warn_days on a plaintext url", () => {
    // Would produce a probe that can never succeed and an alert nobody can act
    // on -- and, worse, teaches an operator to ignore TLS alerts.
    expect(MonitorTargetCreateSchema.safeParse({ ...http, tls_warn_days: 21 }).success).toBe(false);
    expect(
      MonitorTargetCreateSchema.safeParse({
        name: "tailnet",
        kind: "http",
        url: "https://host.example/health",
        tls_warn_days: 21,
      }).success,
    ).toBe(true);
  });

  it("enforces the maintenance triple as all-or-nothing", () => {
    const complete = {
      maintenance_start: "01:00",
      maintenance_end: "02:00",
      maintenance_timezone: "America/Chicago",
    };
    expect(MonitorTargetCreateSchema.safeParse({ ...http, ...complete }).success).toBe(true);

    for (const key of Object.keys(complete) as (keyof typeof complete)[]) {
      const partial: Record<string, unknown> = { ...http, ...complete };
      delete partial[key];
      expect(MonitorTargetCreateSchema.safeParse(partial).success).toBe(false);
    }
  });

  it("REJECTS an unknown maintenance timezone", () => {
    expect(
      MonitorTargetCreateSchema.safeParse({
        ...http,
        maintenance_start: "01:00",
        maintenance_end: "02:00",
        maintenance_timezone: "America/Nowhere",
      }).success,
    ).toBe(false);
  });

  it("REJECTS a non-positive threshold or interval", () => {
    for (const key of [
      "timeout_ms",
      "interval_seconds",
      "failure_threshold",
      "recovery_threshold",
    ]) {
      expect(MonitorTargetCreateSchema.safeParse({ ...http, [key]: 0 }).success).toBe(false);
      expect(MonitorTargetCreateSchema.safeParse({ ...http, [key]: -1 }).success).toBe(false);
    }
  });

  it("is STRICT, so a typo fails rather than being silently ignored", () => {
    // `consecutive_failures` is the specific typo worth catching: ADR-055
    // forbids storing a failure counter at all, and a silently-dropped field
    // would let someone believe they had configured one.
    expect(MonitorTargetCreateSchema.safeParse({ ...http, consecutive_failures: 3 }).success).toBe(
      false,
    );
    expect(MonitorTargetCreateSchema.safeParse({ ...http, timeoutMs: 5000 }).success).toBe(false);
  });

  // ---------------------------------------------------------------------
  // URL SAFETY (Checkpoint 8.6D) -- narrow, not a general SSRF blacklist.
  // ---------------------------------------------------------------------

  it("REJECTS a non-http(s) scheme", () => {
    for (const url of ["ftp://x/", "file:///etc/passwd", "javascript:alert(1)"]) {
      expect(MonitorTargetCreateSchema.safeParse({ ...http, url }).success, url).toBe(false);
    }
  });

  it("REJECTS the cloud-metadata endpoint and the wider link-local range", () => {
    for (const host of ["169.254.169.254", "169.254.0.1", "169.254.255.255"]) {
      expect(
        MonitorTargetCreateSchema.safeParse({ ...http, url: `http://${host}/health` }).success,
        host,
      ).toBe(false);
    }
  });

  it("does NOT reject in-cluster Docker hostnames or a tailnet https host -- production's own seeded targets need these", () => {
    // The exact shapes `defaultMonitorTargets` produces: plain http:// to a
    // bare Docker service name, and https:// to a *.ts.net host. A validator
    // that rejected either would break the system's own real configuration.
    for (const url of [
      "http://api:3000/health",
      "http://web:8080/",
      "https://host.tailnet.ts.net/health",
      "http://localhost:3000/health",
      "http://10.0.0.4:3000/health",
      "http://192.168.1.1/health",
    ]) {
      expect(MonitorTargetCreateSchema.safeParse({ ...http, url }).success, url).toBe(true);
    }
  });
});

describe("MonitorTargetUpdateSchema", () => {
  it("accepts a single-field patch", () => {
    expect(MonitorTargetUpdateSchema.safeParse({ name: "renamed" }).success).toBe(true);
    expect(MonitorTargetUpdateSchema.safeParse({ timeout_ms: 8000 }).success).toBe(true);
  });

  it("REJECTS an empty patch", () => {
    expect(MonitorTargetUpdateSchema.safeParse({}).success).toBe(false);
  });

  it("is STRICT, so a typo fails rather than being silently ignored", () => {
    expect(MonitorTargetUpdateSchema.safeParse({ nam: "x" }).success).toBe(false);
  });

  it("does NOT accept enabled or archived_at -- those are dedicated action endpoints", () => {
    expect(MonitorTargetUpdateSchema.safeParse({ enabled: false }).success).toBe(false);
    expect(
      MonitorTargetUpdateSchema.safeParse({ archived_at: "2026-09-01T00:00:00Z" }).success,
    ).toBe(false);
  });

  it("still rejects a per-field malformed value (structural validation runs on a partial patch)", () => {
    expect(MonitorTargetUpdateSchema.safeParse({ timeout_ms: 0 }).success).toBe(false);
    expect(MonitorTargetUpdateSchema.safeParse({ url: "not a url" }).success).toBe(false);
    expect(MonitorTargetUpdateSchema.safeParse({ kind: "tcp" }).success).toBe(false);
  });

  it("does NOT enforce cross-field rules on its own -- that is updateMonitorTarget's job, against the merged row", () => {
    // A patch setting only tls_warn_days, with no url in the same patch, must
    // pass THIS schema's structural check; whether it is actually valid
    // depends on the target's EXISTING url, which this schema cannot see.
    expect(MonitorTargetUpdateSchema.safeParse({ tls_warn_days: 21 }).success).toBe(true);
  });
});

describe("MonitorTargetListQuerySchema", () => {
  it("defaults include_archived to false", () => {
    expect(MonitorTargetListQuerySchema.parse({}).include_archived).toBe(false);
  });

  it("parses the STRING 'true'/'false' correctly, not via truthy coercion", () => {
    expect(MonitorTargetListQuerySchema.parse({ include_archived: "true" }).include_archived).toBe(
      true,
    );
    expect(MonitorTargetListQuerySchema.parse({ include_archived: "false" }).include_archived).toBe(
      false,
    );
  });

  it("is STRICT", () => {
    expect(MonitorTargetListQuerySchema.safeParse({ includeArchived: true }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// READ CONTRACTS (Checkpoint 7.6)
// ---------------------------------------------------------------------------

const TARGET = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "api-internal-health",
  kind: "http",
  url: "http://api:3000/health",
  expected_status: 200,
  expect_healthy_payload: true,
  timeout_ms: 5000,
  interval_seconds: 60,
  failure_threshold: 3,
  recovery_threshold: 2,
  tls_warn_days: null,
  heartbeat_max_age_seconds: null,
  enabled: true,
  maintenance_start: null,
  maintenance_end: null,
  maintenance_timezone: null,
  muted_until: null,
  archived_at: null,
};

const CHECK = {
  status: "up",
  http_status: 200,
  latency_ms: 12,
  failure_class: null,
  tls_expires_at: null,
  tls_days_remaining: null,
  heartbeat_age_seconds: null,
  checked_at: "2026-09-01T12:00:00Z",
};

describe("MonitorLatestCheckSchema", () => {
  it("accepts a healthy check", () => {
    expect(MonitorLatestCheckSchema.safeParse(CHECK).success).toBe(true);
  });

  it("accepts a SKIPPED check -- a deliberate non-look is a real outcome", () => {
    expect(
      MonitorLatestCheckSchema.safeParse({
        ...CHECK,
        status: "skipped",
        failure_class: "maintenance_window",
      }).success,
    ).toBe(true);
  });

  it("REJECTS a failure class that is prose", () => {
    // The boundary guard: a probe error names the URL it failed against, and a
    // target URL may legitimately carry a token.
    expect(
      MonitorLatestCheckSchema.safeParse({
        ...CHECK,
        failure_class: "fetch failed for https://host/?token=SUPERSECRET",
      }).success,
    ).toBe(false);
  });

  it("REJECTS a status outside the closed vocabulary", () => {
    expect(MonitorLatestCheckSchema.safeParse({ ...CHECK, status: "unknown" }).success).toBe(false);
  });

  it("REJECTS a negative latency but accepts a null one", () => {
    // Null is "we never got a response"; zero would be an impossibly fast one.
    expect(MonitorLatestCheckSchema.safeParse({ ...CHECK, latency_ms: -1 }).success).toBe(false);
    expect(MonitorLatestCheckSchema.safeParse({ ...CHECK, latency_ms: null }).success).toBe(true);
  });
});

describe("MonitorTargetStatusSchema", () => {
  it("accepts a NULL latest check -- never checked is a real state", () => {
    expect(
      MonitorTargetStatusSchema.safeParse({
        target: TARGET,
        latest_check: null,
        active_incident: null,
      }).success,
    ).toBe(true);
  });

  it("requires the three fields to be present, even as null", () => {
    // An omitted `latest_check` would let a consumer read `undefined` and treat
    // it as something other than "never checked".
    expect(MonitorTargetStatusSchema.safeParse({ target: TARGET }).success).toBe(false);
  });
});

describe("MonitorOverviewResponseSchema", () => {
  it("carries `configured` separately from an empty list", () => {
    // "Nothing is monitored" and "everything is up" are different claims.
    const empty = MonitorOverviewResponseSchema.safeParse({
      configured: false,
      items: [],
      active_incident_count: 0,
    });
    expect(empty.success).toBe(true);
  });

  it("REJECTS a negative incident count", () => {
    expect(
      MonitorOverviewResponseSchema.safeParse({
        configured: true,
        items: [],
        active_incident_count: -1,
      }).success,
    ).toBe(false);
  });
});

describe("MonitorIncidentListQuerySchema", () => {
  it("defaults limit and offset", () => {
    const parsed = MonitorIncidentListQuerySchema.parse({});
    expect(parsed).toMatchObject({ limit: 50, offset: 0, active_only: false });
  });

  it("parses the STRING 'false' as false, not as truthy", () => {
    // `z.coerce.boolean()` would make "false" true -- the repo-wide defect
    // Checkpoint 4.2 found and `booleanQueryParam` exists to prevent.
    expect(MonitorIncidentListQuerySchema.parse({ active_only: "false" }).active_only).toBe(false);
    expect(MonitorIncidentListQuerySchema.parse({ active_only: "true" }).active_only).toBe(true);
  });

  it("is STRICT, so a typo fails rather than being silently ignored", () => {
    expect(MonitorIncidentListQuerySchema.safeParse({ activeOnly: true }).success).toBe(false);
  });

  it("rejects a non-uuid target id", () => {
    expect(MonitorIncidentListQuerySchema.safeParse({ target_id: "nope" }).success).toBe(false);
  });
});
