import { describe, expect, it } from "vitest";
import {
  MonitorCheckSchema,
  MonitorTargetCreateSchema,
  MonitorUptimePointSchema,
  sanitizeMonitorFailureClass,
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
});
