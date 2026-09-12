import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import {
  acknowledgeMonitorIncident,
  archiveMonitorTarget,
  createMonitorTarget,
  disableMonitorTarget,
  enableMonitorTarget,
  getMonitorOverview,
  getMonitorTarget,
  listMonitorIncidents,
  updateMonitorTarget,
} from "./monitor.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = f;
  return f;
}

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

const INCIDENT = {
  id: "22222222-2222-4222-8222-222222222222",
  target_id: TARGET.id,
  status: "open",
  failure_class: "http_status:503",
  opened_at: "2026-09-01T12:00:00Z",
  acknowledged_at: null,
  resolved_at: null,
  last_failure_at: "2026-09-01T12:05:00Z",
};

describe("getMonitorTarget (Checkpoint 8.6D)", () => {
  it("fetches a single target by id", async () => {
    const f = stub(TARGET);
    const result = await getMonitorTarget(BASE, TARGET.id);
    expect(result.name).toBe("api-internal-health");
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets/${TARGET.id}`);
  });

  it("surfaces a 404 as a typed ApiClientError", async () => {
    stub({ error: "not_found" }, 404);
    const error = await getMonitorTarget(BASE, TARGET.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("not_found");
  });
});

describe("createMonitorTarget (Checkpoint 8.6D)", () => {
  it("validates the input BEFORE sending -- rejects locally on a bad shape", async () => {
    const f = stub(TARGET, 201);
    await expect(
      createMonitorTarget(BASE, { name: "bad", kind: "http" } as never),
    ).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("POSTs the validated body and parses the created target", async () => {
    const f = stub(TARGET, 201);
    const result = await createMonitorTarget(BASE, {
      name: "api-internal-health",
      kind: "http",
      url: "http://api:3000/health",
    });
    expect(result.id).toBe(TARGET.id);
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ name: "api-internal-health" });
  });

  it("surfaces a 409 duplicate name as a typed ApiClientError", async () => {
    stub({ error: "name_already_exists" }, 409);
    const error = await createMonitorTarget(BASE, {
      name: "dup",
      kind: "http",
      url: "http://x/",
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("name_already_exists");
  });
});

describe("updateMonitorTarget (Checkpoint 8.6D)", () => {
  it("PATCHes only the given fields", async () => {
    const f = stub({ ...TARGET, name: "renamed" });
    const result = await updateMonitorTarget(BASE, TARGET.id, { name: "renamed" });
    expect(result.name).toBe("renamed");
    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ name: "renamed" });
  });

  it("rejects an empty patch locally, before sending", async () => {
    const f = stub(TARGET);
    await expect(updateMonitorTarget(BASE, TARGET.id, {})).rejects.toThrow();
    expect(f).not.toHaveBeenCalled();
  });

  it("surfaces a 409 active-incident refusal as a typed ApiClientError", async () => {
    stub({ error: "target_has_active_incident" }, 409);
    const error = await updateMonitorTarget(BASE, TARGET.id, { url: "http://y/" }).catch(
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("target_has_active_incident");
  });
});

describe("enableMonitorTarget / disableMonitorTarget (Checkpoint 8.6D)", () => {
  it("enable POSTs to /enable with no body", async () => {
    const f = stub({ ...TARGET, enabled: true });
    await enableMonitorTarget(BASE, TARGET.id);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets/${TARGET.id}/enable`);
    expect((f.mock.calls[0]![1] as RequestInit).body).toBeUndefined();
  });

  it("disable POSTs to /disable and parses enabled:false", async () => {
    const f = stub({ ...TARGET, enabled: false });
    const result = await disableMonitorTarget(BASE, TARGET.id);
    expect(result.enabled).toBe(false);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets/${TARGET.id}/disable`);
  });
});

describe("archiveMonitorTarget (Checkpoint 8.6D)", () => {
  it("POSTs to /archive and parses the archived target", async () => {
    const f = stub({ ...TARGET, enabled: false, archived_at: "2026-09-11T12:00:00Z" });
    const result = await archiveMonitorTarget(BASE, TARGET.id);
    expect(result.archived_at).not.toBeNull();
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets/${TARGET.id}/archive`);
  });
});

describe("getMonitorOverview", () => {
  it("parses an empty, unconfigured overview", async () => {
    stub({ configured: false, items: [], active_incident_count: 0 });
    const result = await getMonitorOverview(BASE);
    expect(result.configured).toBe(false);
    expect(result.items).toEqual([]);
  });

  it("sends no query string by default -- includeArchived is off", async () => {
    const f = stub({ configured: false, items: [], active_incident_count: 0 });
    await getMonitorOverview(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets`);
  });

  it("sends include_archived=true when requested (Checkpoint 8.6D)", async () => {
    const f = stub({ configured: false, items: [], active_incident_count: 0 });
    await getMonitorOverview(BASE, true);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/targets?include_archived=true`);
  });

  it("parses a target with a null latest check", async () => {
    stub({
      configured: true,
      items: [{ target: TARGET, latest_check: null, active_incident: null }],
      active_incident_count: 0,
    });
    const result = await getMonitorOverview(BASE);
    expect(result.items[0]!.latest_check).toBeNull();
  });

  it("REJECTS a failure class that is prose", async () => {
    // The boundary guard. A server regression that leaked a probe error's text
    // -- which names the URL it failed against, and a target URL may carry a
    // token -- must fail HERE rather than reach a screen.
    stub({
      configured: true,
      items: [
        {
          target: TARGET,
          latest_check: {
            status: "down",
            http_status: null,
            latency_ms: null,
            failure_class: "fetch failed for https://host/?token=SUPERSECRET",
            tls_expires_at: null,
            tls_days_remaining: null,
            heartbeat_age_seconds: null,
            checked_at: "2026-09-01T12:00:00Z",
          },
          active_incident: null,
        },
      ],
      active_incident_count: 0,
    });
    await expect(getMonitorOverview(BASE)).rejects.toThrow();
  });

  it("REJECTS a check status outside the closed vocabulary", async () => {
    stub({
      configured: true,
      items: [
        {
          target: TARGET,
          latest_check: {
            status: "unknown",
            http_status: null,
            latency_ms: null,
            failure_class: null,
            tls_expires_at: null,
            tls_days_remaining: null,
            heartbeat_age_seconds: null,
            checked_at: "2026-09-01T12:00:00Z",
          },
          active_incident: null,
        },
      ],
      active_incident_count: 0,
    });
    await expect(getMonitorOverview(BASE)).rejects.toThrow();
  });
});

describe("listMonitorIncidents", () => {
  const EMPTY = { items: [], limit: 50, offset: 0, total: 0 };

  it("sends no query string when given no params", async () => {
    const f = stub(EMPTY);
    await listMonitorIncidents(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/monitor/incidents`);
  });

  it("builds the query without pre-encoding", async () => {
    // buildQuery runs URLSearchParams, which percent-encodes already --
    // hand-encoding here would double-escape.
    const f = stub(EMPTY);
    await listMonitorIncidents(BASE, { targetId: TARGET.id, activeOnly: true, limit: 20 });
    const url = String(f.mock.calls[0]![0]);
    expect(url).toContain(`target_id=${TARGET.id}`);
    expect(url).toContain("active_only=true");
    expect(url).toContain("limit=20");
  });

  it("sends active_only=false EXPLICITLY rather than omitting it", async () => {
    // `Boolean("false")` is true, which is the repo-wide defect Checkpoint 4.2
    // found. The server's `booleanQueryParam` handles the string correctly, so
    // the client must actually send it.
    const f = stub(EMPTY);
    await listMonitorIncidents(BASE, { activeOnly: false });
    expect(String(f.mock.calls[0]![0])).toContain("active_only=false");
  });

  it("parses a page with an honest total larger than the page", async () => {
    stub({ items: [{ incident: INCIDENT, target_name: "api" }], limit: 1, offset: 0, total: 7 });
    const result = await listMonitorIncidents(BASE, { limit: 1 });
    expect(result.items).toHaveLength(1);
    expect(result.total).toBe(7);
  });
});

describe("acknowledgeMonitorIncident", () => {
  it("sends NO Content-Type, because it sends no body", async () => {
    // A bodyless POST that declares a JSON body is rejected 400 by Fastify.
    // Route tests cannot catch this: `.inject()` never goes through fetchJson,
    // so this assertion is the only thing standing between the app and a
    // repeat of the Phase 2 defect.
    const f = stub({
      ...INCIDENT,
      status: "acknowledged",
      acknowledged_at: "2026-09-01T12:10:00Z",
    });
    await acknowledgeMonitorIncident(BASE, INCIDENT.id);

    const init = f.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("encodes the id into the path", async () => {
    const f = stub({
      ...INCIDENT,
      status: "acknowledged",
      acknowledged_at: "2026-09-01T12:10:00Z",
    });
    await acknowledgeMonitorIncident(BASE, INCIDENT.id);
    expect(String(f.mock.calls[0]![0])).toBe(
      `${BASE}/monitor/incidents/${INCIDENT.id}/acknowledge`,
    );
  });

  it("surfaces a 409 already-resolved as a typed ApiClientError", async () => {
    stub({ error: "incident_already_resolved" }, 409);
    await expect(acknowledgeMonitorIncident(BASE, INCIDENT.id)).rejects.toMatchObject({
      status: 409,
      code: "incident_already_resolved",
    });
  });

  it("surfaces a 404 distinctly, so a screen can tell the two apart", async () => {
    stub({ error: "not_found" }, 404);
    const error = await acknowledgeMonitorIncident(BASE, INCIDENT.id).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect((error as ApiClientError).code).toBe("not_found");
  });
});
