import type { MonitorTargetStatus } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  describeLastCheck,
  describeMonitorSummary,
  monitorStateText,
  monitorStateToneClass,
  resolveMonitorTargetState,
} from "./target-state";

const NOW = Date.parse("2026-09-01T12:00:00.000Z");

function target(overrides: Record<string, unknown> = {}): MonitorTargetStatus["target"] {
  return {
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
    ...overrides,
  } as MonitorTargetStatus["target"];
}

function check(overrides: Record<string, unknown> = {}): MonitorTargetStatus["latest_check"] {
  return {
    status: "up",
    http_status: 200,
    latency_ms: 12,
    failure_class: null,
    tls_expires_at: null,
    tls_days_remaining: null,
    heartbeat_age_seconds: null,
    checked_at: "2026-09-01T11:59:00.000Z",
    ...overrides,
  } as MonitorTargetStatus["latest_check"];
}

function incident(overrides: Record<string, unknown> = {}): MonitorTargetStatus["active_incident"] {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    target_id: "11111111-1111-4111-8111-111111111111",
    status: "open",
    failure_class: "unreachable",
    opened_at: "2026-09-01T11:00:00.000Z",
    acknowledged_at: null,
    resolved_at: null,
    last_failure_at: "2026-09-01T11:59:00.000Z",
    ...overrides,
  } as MonitorTargetStatus["active_incident"];
}

function status(overrides: Partial<MonitorTargetStatus> = {}): MonitorTargetStatus {
  return {
    target: target(),
    latest_check: null,
    active_incident: null,
    ...overrides,
  };
}

describe("resolveMonitorTargetState", () => {
  it("reports NOT_CHECKED rather than up when nothing has run", () => {
    // The single most important case. Defaulting to "up" would manufacture a
    // clean bill of health from an absence of evidence -- and since no target
    // has ever been seeded in any environment, this is what every reader sees
    // first.
    expect(resolveMonitorTargetState(status(), NOW).state).toBe("not_checked");
  });

  it("reports disabled above everything, even a live incident", () => {
    // "Down" for a target nobody is checking would be a claim about a service
    // from evidence that stopped being collected.
    const view = resolveMonitorTargetState(
      status({
        target: target({ enabled: false }),
        latest_check: check({ status: "down" }),
        active_incident: incident(),
      }),
      NOW,
    );
    expect(view.state).toBe("disabled");
  });

  it("reports muted while the mute is in the future, and stops when it passes", () => {
    const future = new Date(NOW + 600_000).toISOString();
    expect(
      resolveMonitorTargetState(status({ target: target({ muted_until: future }) }), NOW).state,
    ).toBe("muted");

    const past = new Date(NOW - 600_000).toISOString();
    expect(
      resolveMonitorTargetState(
        status({ target: target({ muted_until: past }), latest_check: check() }),
        NOW,
    ).state,
    ).toBe("up");
  });

  it("reports maintenance when the newest check was a deliberate skip", () => {
    const view = resolveMonitorTargetState(
      status({ latest_check: check({ status: "skipped", failure_class: "maintenance_window" }) }),
      NOW,
    );
    expect(view.state).toBe("maintenance");
  });

  it("keeps ACKNOWLEDGED above open, and carries the incident id", () => {
    // "Someone is on this" is what a second person opening the screen needs.
    const view = resolveMonitorTargetState(
      status({
        latest_check: check({ status: "down" }),
        active_incident: incident({ status: "acknowledged", acknowledged_at: "2026-09-01T11:30:00.000Z" }),
      }),
      NOW,
    );
    expect(view.state).toBe("incident_acknowledged");
    expect(view.incidentId).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("prefers an incident over a bare down, because the incident is actionable", () => {
    const view = resolveMonitorTargetState(
      status({ latest_check: check({ status: "down" }), active_incident: incident() }),
      NOW,
    );
    expect(view.state).toBe("incident_open");
    expect(view.incidentId).not.toBeNull();
  });

  it("reports a bare down with NO incident id", () => {
    // Below the failure threshold: failing, but nothing to acknowledge yet.
    const view = resolveMonitorTargetState(status({ latest_check: check({ status: "down" }) }), NOW);
    expect(view.state).toBe("down");
    expect(view.incidentId).toBeNull();
  });

  it("reports up only when the newest check actually succeeded", () => {
    expect(resolveMonitorTargetState(status({ latest_check: check() }), NOW).state).toBe("up");
  });
});

describe("monitorStateText — the heartbeat wording is not interchangeable", () => {
  it("says HEARTBEAT RECEIVED and never 'worker healthy'", () => {
    // The heartbeat proves a process wrote a row on its beat cron. It does NOT
    // prove the worker is completing jobs -- ADR-055 records that a hung or
    // fast-crash-looping worker still looks alive here. "Worker healthy" would
    // assert exactly what the evidence does not support.
    const text = monitorStateText("up", "worker_heartbeat");
    expect(text).toBe("Heartbeat received.");
    expect(text.toLowerCase()).not.toContain("healthy");
  });

  it("never says 'healthy' in ANY heartbeat state", () => {
    const states = [
      "not_checked",
      "disabled",
      "muted",
      "maintenance",
      "down",
      "incident_open",
      "incident_acknowledged",
      "up",
    ] as const;
    for (const state of states) {
      expect(monitorStateText(state, "worker_heartbeat").toLowerCase()).not.toContain("healthy");
    }
  });

  it("never claims 'healthy' or 'operational' for an http target either", () => {
    const states = ["not_checked", "down", "up", "incident_open"] as const;
    for (const state of states) {
      const text = monitorStateText(state, "http").toLowerCase();
      expect(text).not.toContain("healthy");
      expect(text).not.toContain("operational");
    }
  });

  it("distinguishes 'no heartbeat yet' from 'heartbeat too old'", () => {
    // A deployment where the worker never started, versus one where it died.
    expect(monitorStateText("not_checked", "worker_heartbeat")).toMatch(/yet/);
    expect(monitorStateText("down", "worker_heartbeat")).toMatch(/too old/);
  });

  it("has words for every state and both kinds", () => {
    const states = [
      "not_checked",
      "disabled",
      "muted",
      "maintenance",
      "down",
      "incident_open",
      "incident_acknowledged",
      "up",
    ] as const;
    for (const state of states) {
      for (const kind of ["http", "worker_heartbeat"] as const) {
        expect(monitorStateText(state, kind).length, `${state}/${kind}`).toBeGreaterThan(5);
      }
      expect(monitorStateToneClass(state)).toContain("text-");
    }
  });

  it("does not present not_checked as either success or failure", () => {
    const text = monitorStateText("not_checked", "http").toLowerCase();
    expect(text).not.toContain("failed");
    expect(text).not.toContain("responding normally");
  });
});

describe("describeLastCheck", () => {
  it("returns null when nothing has been checked", () => {
    // So a caller cannot render "Checked never ago". Phrasing the absence is
    // the caller's job.
    expect(describeLastCheck(status(), NOW)).toBeNull();
  });

  it("scales from seconds to days", () => {
    const at = (iso: string) => status({ latest_check: check({ checked_at: iso }) });
    expect(describeLastCheck(at("2026-09-01T11:59:40.000Z"), NOW)).toBe("Checked just now");
    expect(describeLastCheck(at("2026-09-01T11:55:00.000Z"), NOW)).toBe("Checked 5 minutes ago");
    expect(describeLastCheck(at("2026-09-01T11:59:00.000Z"), NOW)).toBe("Checked 1 minute ago");
    expect(describeLastCheck(at("2026-09-01T09:00:00.000Z"), NOW)).toBe("Checked 3 hours ago");
    expect(describeLastCheck(at("2026-08-30T12:00:00.000Z"), NOW)).toBe("Checked 2 days ago");
  });

  it("never reports a negative age from a clock skew", () => {
    const future = status({ latest_check: check({ checked_at: "2026-09-01T12:05:00.000Z" }) });
    expect(describeLastCheck(future, NOW)).toBe("Checked just now");
  });
});

describe("describeMonitorSummary", () => {
  it("says nothing is monitored when nothing is configured", () => {
    // NOT "0 open incidents" -- a deployment that was never given targets is not
    // being monitored, and must not read as a clean bill of health.
    expect(describeMonitorSummary(false, 0)).toBe("No services are being monitored yet.");
  });

  it("distinguishes configured-and-quiet from unconfigured", () => {
    expect(describeMonitorSummary(true, 0)).toBe("No open incidents.");
  });

  it("pluralises honestly", () => {
    expect(describeMonitorSummary(true, 1)).toBe("1 open incident.");
    expect(describeMonitorSummary(true, 3)).toBe("3 open incidents.");
  });
});
