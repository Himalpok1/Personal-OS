import { monitorChecks, monitorIncidents, monitorTargets } from "@personal-os/db";
import { createMonitorTarget } from "@personal-os/monitoring";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type {
  MonitorIncident,
  MonitorIncidentListResponse,
  MonitorOverviewResponse,
} from "@personal-os/schema";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

let app: FastifyInstance;
const NOW = new Date("2026-09-01T12:00:00.000Z");

async function seedTarget(name: string, overrides: Record<string, unknown> = {}) {
  return await createMonitorTarget(app.db, {
    name,
    kind: "http",
    url: "http://api:3000/health",
    ...overrides,
  });
}

async function seedCheck(targetId: string, values: Record<string, unknown> = {}) {
  await app.db.insert(monitorChecks).values({ targetId, status: "up", checkedAt: NOW, ...values });
}

async function seedIncident(targetId: string, values: Record<string, unknown> = {}) {
  const [row] = await app.db
    .insert(monitorIncidents)
    .values({ targetId, status: "open", openedAt: NOW, ...values })
    .returning({ id: monitorIncidents.id });
  return row!.id;
}

beforeEach(async () => {
  app ??= await buildTestApp();
  await truncateTestTables(app);
});

afterAll(async () => {
  await truncateTestTables(app);
  await app.close();
});

describe("GET /monitor/targets", () => {
  it("reports configured:false when nothing is seeded", async () => {
    // The state every environment is in today -- no target has ever been
    // seeded. Rendering an empty list as a clean bill of health would be the
    // strongest possible claim from the weakest possible evidence.
    const res = await app.inject({ method: "GET", url: "/monitor/targets" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, items: [], active_incident_count: 0 });
  });

  it("returns a target with a NULL latest check when nobody has checked it", async () => {
    await seedTarget("api");
    const body = overview(await app.inject({ method: "GET", url: "/monitor/targets" }));
    expect(body.configured).toBe(true);
    expect(body.items[0]!.latest_check).toBeNull();
    expect(body.items[0]!.active_incident).toBeNull();
  });

  it("projects the newest check with its facts", async () => {
    const target = await seedTarget("api");
    await seedCheck(target.id, { status: "down", failureClass: "timeout" });
    await seedCheck(target.id, {
      status: "up",
      httpStatus: 200,
      latencyMs: 42,
      checkedAt: new Date(NOW.getTime() + 60_000),
    });

    const body = overview(await app.inject({ method: "GET", url: "/monitor/targets" }));
    expect(body.items[0]!.latest_check).toMatchObject({
      status: "up",
      http_status: 200,
      latency_ms: 42,
      failure_class: null,
    });
  });

  it("projects the target URL, deliberately", async () => {
    // A monitoring view that cannot say WHICH endpoint is down is not worth
    // having. The thing that must never cross is a probe error's text -- and
    // there is no field for one.
    await seedTarget("api", { url: "https://host.example/health" });
    const body = overview(await app.inject({ method: "GET", url: "/monitor/targets" }));
    expect(body.items[0]!.target.url).toBe("https://host.example/health");
  });

  it("SANITIZES a failure class that is not token-shaped", async () => {
    // A row written by an older or buggier build must not put prose on the wire.
    const target = await seedTarget("api");
    await seedCheck(target.id, {
      status: "down",
      failureClass: "fetch failed for https://internal.example/health?token=SUPERSECRET",
    });

    const res = await app.inject({ method: "GET", url: "/monitor/targets" });
    expect(overview(res).items[0]!.latest_check?.failure_class).toBe("probe_error");
    expect(res.body).not.toContain("SUPERSECRET");
  });

  it("counts active incidents, including acknowledged ones", async () => {
    const first = await seedTarget("aaa");
    const second = await seedTarget("bbb");
    await seedIncident(first.id);
    await seedIncident(second.id, { status: "acknowledged", acknowledgedAt: NOW });

    const body = overview(await app.inject({ method: "GET", url: "/monitor/targets" }));
    expect(body.active_incident_count).toBe(2);
  });

  it("does not count a resolved incident", async () => {
    const target = await seedTarget("api");
    await seedIncident(target.id, { status: "resolved", resolvedAt: NOW });
    const body = overview(await app.inject({ method: "GET", url: "/monitor/targets" }));
    expect(body.active_incident_count).toBe(0);
    expect(body.items[0]!.active_incident).toBeNull();
  });

  it("carries no credential-shaped field anywhere in the payload", async () => {
    const target = await seedTarget("api");
    await seedCheck(target.id);
    await seedIncident(target.id);
    const res = await app.inject({ method: "GET", url: "/monitor/targets" });
    for (const forbidden of ["token", "secret", "ciphertext", "auth_tag", "password"]) {
      expect(res.body.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("GET /monitor/incidents", () => {
  it("is empty with an honest zero total", async () => {
    const body = incidents(await app.inject({ method: "GET", url: "/monitor/incidents" }));
    expect(body).toMatchObject({ items: [], total: 0, limit: 50, offset: 0 });
  });

  it("returns incidents newest first with the target name", async () => {
    const target = await seedTarget("api");
    await seedIncident(target.id, {
      status: "resolved",
      resolvedAt: NOW,
      openedAt: new Date(NOW.getTime() - 7200_000),
    });
    await seedIncident(target.id, { openedAt: new Date(NOW.getTime() - 60_000) });

    const body = incidents(await app.inject({ method: "GET", url: "/monitor/incidents" }));
    expect(body.total).toBe(2);
    expect(body.items[0]!.target_name).toBe("api");
    expect(body.items[0]!.incident.status).toBe("open");
  });

  it("reports the total before the limit", async () => {
    const target = await seedTarget("api");
    for (let i = 0; i < 4; i += 1) {
      await seedIncident(target.id, {
        status: "resolved",
        resolvedAt: NOW,
        openedAt: new Date(NOW.getTime() - i * 60_000),
      });
    }
    const body = incidents(await app.inject({ method: "GET", url: "/monitor/incidents?limit=2" }));
    expect(body.items).toHaveLength(2);
    expect(body.total).toBe(4);
  });

  it("filters by target", async () => {
    const first = await seedTarget("aaa");
    const second = await seedTarget("bbb");
    await seedIncident(first.id);
    await seedIncident(second.id);

    const body = incidents(
      await app.inject({ method: "GET", url: `/monitor/incidents?target_id=${first.id}` }),
    );
    expect(body.total).toBe(1);
    expect(body.items[0]!.target_name).toBe("aaa");
  });

  it("honours active_only=false explicitly, not just by omission", async () => {
    // `z.coerce.boolean()` would make the string "false" truthy -- the repo-wide
    // defect Checkpoint 4.2 found and `booleanQueryParam` exists to prevent.
    const target = await seedTarget("api");
    await seedIncident(target.id, { status: "resolved", resolvedAt: NOW });

    const included = incidents(
      await app.inject({ method: "GET", url: "/monitor/incidents?active_only=false" }),
    );
    const excluded = incidents(
      await app.inject({ method: "GET", url: "/monitor/incidents?active_only=true" }),
    );
    expect(included.total).toBe(1);
    expect(excluded.total).toBe(0);
  });

  it("rejects an unknown query parameter rather than ignoring it", async () => {
    const res = await app.inject({ method: "GET", url: "/monitor/incidents?bogus=1" });
    expect(res.statusCode).toBe(400);
  });
});

describe("POST /monitor/incidents/:id/acknowledge", () => {
  it("acknowledges an open incident without resolving it", async () => {
    // ACKNOWLEDGEMENT IS NOT RESOLUTION. The incident stays active; the target
    // is still down. An Ack that resolved would stop tracking a live outage.
    const target = await seedTarget("api");
    const id = await seedIncident(target.id);

    const res = await app.inject({ method: "POST", url: `/monitor/incidents/${id}/acknowledge` });

    expect(res.statusCode).toBe(200);
    const body = incident(res);
    expect(body).toMatchObject({ id, status: "acknowledged" });
    expect(body.acknowledged_at).not.toBeNull();
    expect(body.resolved_at).toBeNull();
  });

  it("is IDEMPOTENT on a second tap rather than 404ing", async () => {
    // The defect this route is written against. `acknowledgeIncident` is
    // idempotent by exclusion (`ne(status, "acknowledged")`), so it returns
    // undefined the second time -- and mapping that to 404 would fail on a
    // double-tap of a button that had just succeeded, which is the most likely
    // thing a user actually does.
    const target = await seedTarget("api");
    const id = await seedIncident(target.id);

    const first = await app.inject({ method: "POST", url: `/monitor/incidents/${id}/acknowledge` });
    const second = await app.inject({
      method: "POST",
      url: `/monitor/incidents/${id}/acknowledge`,
    });

    expect(first.statusCode).toBe(200);
    expect(second.statusCode).toBe(200);
    // And the original acknowledgement time is preserved, not overwritten.
    expect(incident(second).acknowledged_at).toBe(incident(first).acknowledged_at);
  });

  it("404s an incident that does not exist", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monitor/incidents/00000000-0000-0000-0000-000000000000/acknowledge",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("409s an incident that already resolved, distinctly from not-found", async () => {
    // Not the user's mistake -- the outage ended between rendering the list and
    // tapping. A screen can only say so if the two cases are distinguishable.
    const target = await seedTarget("api");
    const id = await seedIncident(target.id, { status: "resolved", resolvedAt: NOW });

    const res = await app.inject({ method: "POST", url: `/monitor/incidents/${id}/acknowledge` });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "incident_already_resolved" });
  });

  it("400s a malformed id rather than reaching the database", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/monitor/incidents/not-a-uuid/acknowledge",
    });
    expect(res.statusCode).toBe(400);
  });

  it("does not resolve or reopen anything as a side effect", async () => {
    const target = await seedTarget("api");
    const id = await seedIncident(target.id);
    await app.inject({ method: "POST", url: `/monitor/incidents/${id}/acknowledge` });

    const [row] = await app.db.select().from(monitorIncidents).where(eq(monitorIncidents.id, id));
    expect(row!.resolvedAt).toBeNull();
    expect(row!.status).toBe("acknowledged");
    // Still occupies the target's one active slot -- the partial unique index
    // treats acknowledged as active.
    const targets = await app.db.select().from(monitorTargets);
    expect(targets).toHaveLength(1);
  });
});

/**
 * Typed accessors built on the REAL wire contracts.
 *
 * Casting to the schema's own inferred type rather than to a hand-written shape
 * means a test cannot quietly assert against a field the contract does not have.
 */
function overview(res: { json: () => unknown }): MonitorOverviewResponse {
  return res.json() as MonitorOverviewResponse;
}

function incidents(res: { json: () => unknown }): MonitorIncidentListResponse {
  return res.json() as MonitorIncidentListResponse;
}

function incident(res: { json: () => unknown }): MonitorIncident {
  return res.json() as MonitorIncident;
}
