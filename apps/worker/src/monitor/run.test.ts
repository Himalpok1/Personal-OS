import { monitorChecks, type Db } from "@personal-os/db";
import {
  countActiveIncidents,
  createMonitorTarget,
  type FetchLike,
  type IncidentAlert,
  type TlsProbeFn,
} from "@personal-os/monitoring";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { runMonitorPass } from "./run.js";

const db: Db = buildTestDb();
const NOW = new Date("2026-09-01T12:00:00.000Z");

function alerts() {
  const captured: IncidentAlert[] = [];
  return { captured, send: (a: IncidentAlert) => (captured.push(a), Promise.resolve()) };
}

/** A fetch returning one scripted response for every call. */
function always(response: Response | Error): FetchLike {
  return () =>
    response instanceof Error ? Promise.reject(response) : Promise.resolve(response.clone());
}

const healthyTls: TlsProbeFn = () => Promise.resolve({ validTo: "2027-01-01T00:00:00.000Z" });

async function httpTarget(overrides: Record<string, unknown> = {}) {
  return await createMonitorTarget(db, {
    name: `t-${Math.random().toString(36).slice(2, 10)}`,
    kind: "http",
    url: "http://api:3000/health",
    failure_threshold: 1,
    recovery_threshold: 1,
    interval_seconds: 1,
    ...overrides,
  });
}

async function checksFor(targetId: string) {
  return await db
    .select()
    .from(monitorChecks)
    .where(eq(monitorChecks.targetId, targetId))
    .orderBy(asc(monitorChecks.checkedAt), asc(monitorChecks.id));
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("scope", () => {
  it("sweeps http targets and NEVER the worker_heartbeat one", async () => {
    // The omission is the point of ADR-055's split: a worker-hosted monitor
    // cannot alert on its own death, so that check runs in the API process. If
    // this pass ever picked it up, the system would look monitored while being
    // structurally blind to the exact failure it most needs to catch.
    const http = await httpTarget({ name: "http-one" });
    const heartbeat = await createMonitorTarget(db, {
      name: "worker-heartbeat",
      kind: "worker_heartbeat",
      url: null,
      heartbeat_max_age_seconds: 180,
    });

    const result = await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: null,
    });

    expect(result.evaluated).toBe(1);
    expect(await checksFor(http.id)).toHaveLength(1);
    expect(await checksFor(heartbeat.id)).toHaveLength(0);
  });

  it("records a healthy check with latency and status", async () => {
    const target = await httpTarget();
    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: null,
    });

    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("up");
    expect(check!.httpStatus).toBe(200);
    expect(check!.latencyMs).not.toBeNull();
    expect(check!.failureClass).toBeNull();
  });
});

describe("failure and recovery", () => {
  it("opens an incident at the failure threshold and alerts", async () => {
    const target = await httpTarget({ failure_threshold: 2 });
    const collector = alerts();
    const deps = {
      db,
      fetchFn: always(new Response("", { status: 503 })),
      sendAlert: collector.send,
    };

    await runMonitorPass({ ...deps, now: () => NOW });
    expect(await countActiveIncidents(db, target.id)).toBe(0);

    await runMonitorPass({ ...deps, now: () => new Date(NOW.getTime() + 60_000) });
    expect(await countActiveIncidents(db, target.id)).toBe(1);
    expect(collector.captured.map((a) => a.kind)).toEqual(["opened"]);
  });

  it("resolves once the service recovers, and alerts once", async () => {
    const target = await httpTarget({ failure_threshold: 1, recovery_threshold: 1 });
    const collector = alerts();

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 500 })),
      sendAlert: collector.send,
    });
    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 60_000),
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: collector.send,
    });

    expect(await countActiveIncidents(db, target.id)).toBe(0);
    expect(collector.captured.map((a) => a.kind)).toEqual(["opened", "resolved"]);
    // Incident-scoped keys, so the same target can alert again on a later
    // outage -- the permanent-dedupe-key defect ADR-055 is written against.
    expect(new Set(collector.captured.map((a) => a.dedupeKey)).size).toBe(2);
  });

  it("classifies a timeout without leaking the URL", async () => {
    const target = await httpTarget({
      url: "https://internal.example/health?token=SUPERSECRET",
      tls_warn_days: null,
    });
    const abort = new Error("fetch failed for https://internal.example/health?token=SUPERSECRET");
    abort.name = "TimeoutError";

    await runMonitorPass({ db, now: () => NOW, fetchFn: always(abort), sendAlert: null });

    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("down");
    expect(check!.failureClass).toBe("timeout");
    expect(JSON.stringify(check)).not.toContain("SUPERSECRET");
  });

  it("fails a 200 whose health payload reports a degraded database", async () => {
    const target = await httpTarget({ expect_healthy_payload: true });
    const body = JSON.stringify({
      status: "degraded",
      db: "unreachable",
      worker: { lastBeatAt: null, stale: true },
    });

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response(body, { status: 200 })),
      sendAlert: null,
    });

    const [check] = await checksFor(target.id);
    // Recording this as up would make the monitor agree with the outage.
    expect(check!.status).toBe("down");
    expect(check!.failureClass).toBe("health_db_unreachable");
    expect(check!.httpStatus).toBe(200);
  });
});

describe("TLS", () => {
  it("records expiry on a healthy https target without failing it", async () => {
    const target = await httpTarget({
      url: "https://host.example/health",
      tls_warn_days: 21,
    });

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      tlsProbe: healthyTls,
      sendAlert: null,
    });

    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("up");
    expect(check!.tlsExpiresAt).not.toBeNull();
    expect(check!.tlsDaysRemaining).toBeGreaterThan(21);
  });

  it("marks a check down when the certificate is expiring", async () => {
    const target = await httpTarget({
      url: "https://host.example/health",
      tls_warn_days: 21,
    });

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      tlsProbe: () => Promise.resolve({ validTo: "2026-09-10T00:00:00.000Z" }),
      sendAlert: null,
    });

    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("down");
    expect(check!.failureClass).toBe("tls_expiring");
    expect(check!.tlsDaysRemaining).toBe(8);
  });

  it("does NOT let a TLS result hide a transport failure", async () => {
    // Ordering: the HTTP probe decides up/down first, and TLS is consulted only
    // if the endpoint answered. A certificate expiring next week on a service
    // that is currently down is not the headline.
    const target = await httpTarget({
      url: "https://host.example/health",
      tls_warn_days: 21,
    });
    let tlsCalls = 0;

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Error("ECONNREFUSED")),
      tlsProbe: () => {
        tlsCalls += 1;
        return Promise.resolve({ validTo: "2026-09-10T00:00:00.000Z" });
      },
      sendAlert: null,
    });

    const [check] = await checksFor(target.id);
    expect(check!.failureClass).toBe("unreachable");
    expect(tlsCalls).toBe(0);
  });

  it("does not probe TLS at all when the target does not ask for it", async () => {
    await httpTarget({ url: "http://api:3000/health", tls_warn_days: null });
    let tlsCalls = 0;
    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      tlsProbe: () => {
        tlsCalls += 1;
        return Promise.resolve({ validTo: "2027-01-01T00:00:00.000Z" });
      },
      sendAlert: null,
    });
    expect(tlsCalls).toBe(0);
  });
});

describe("maintenance and suppression", () => {
  it("writes a SKIPPED row inside a maintenance window and makes no request", async () => {
    // NOW is 07:00 in America/Chicago.
    const target = await httpTarget({
      maintenance_start: "06:00",
      maintenance_end: "08:00",
      maintenance_timezone: "America/Chicago",
    });
    let calls = 0;
    const counting: FetchLike = () => {
      calls += 1;
      return Promise.resolve(new Response("", { status: 200 }));
    };

    const result = await runMonitorPass({ db, now: () => NOW, fetchFn: counting, sendAlert: null });

    expect(calls).toBe(0);
    expect(result.skipped).toBe(1);
    const [check] = await checksFor(target.id);
    // A skip is a FACT, not an absence: it is what lets the uptime read model
    // render `not_checked` rather than presenting maintenance as an outage.
    expect(check!.status).toBe("skipped");
    expect(check!.failureClass).toBe("maintenance_window");
  });

  it("a maintenance window does NOT reset a failure streak", async () => {
    // The load-bearing consequence of excluding skips from threshold evaluation.
    // Without it, a nightly window would silently reset a streak that was one
    // check from opening -- so an outage beginning before the window would never
    // be reported at all.
    const target = await httpTarget({ failure_threshold: 3, interval_seconds: 1 });
    const down = always(new Response("", { status: 503 }));

    // Two real failures, then a maintenance skip lands between them and the
    // third.
    await runMonitorPass({ db, now: () => NOW, fetchFn: down, sendAlert: null });
    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 60_000),
      fetchFn: down,
      sendAlert: null,
    });
    await db.insert(monitorChecks).values({
      targetId: target.id,
      status: "skipped",
      failureClass: "maintenance_window",
      checkedAt: new Date(NOW.getTime() + 120_000),
    });
    expect(await countActiveIncidents(db, target.id)).toBe(0);

    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 180_000),
      fetchFn: down,
      sendAlert: null,
    });

    // Three real failures spanning the window: the streak survived it.
    expect(await countActiveIncidents(db, target.id)).toBe(1);
  });

  it("writes NOTHING for a disabled target", async () => {
    // A target nobody is watching should not accumulate rows forever.
    const target = await httpTarget({ enabled: false });
    const result = await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: null,
    });
    expect(result.skipped).toBe(1);
    expect(await checksFor(target.id)).toHaveLength(0);
  });

  it("skips a muted target and resumes once the mute expires", async () => {
    const target = await httpTarget({
      muted_until: new Date(NOW.getTime() + 600_000).toISOString(),
    });

    await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: null,
    });
    expect((await checksFor(target.id))[0]!.status).toBe("skipped");

    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 900_000),
      fetchFn: always(new Response("", { status: 200 })),
      sendAlert: null,
    });
    expect((await checksFor(target.id))[1]!.status).toBe("up");
  });

  it("respects each target's own interval", async () => {
    const target = await httpTarget({ interval_seconds: 300 });
    const up = always(new Response("", { status: 200 }));

    await runMonitorPass({ db, now: () => NOW, fetchFn: up, sendAlert: null });
    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 60_000),
      fetchFn: up,
      sendAlert: null,
    });
    expect(await checksFor(target.id)).toHaveLength(1);

    await runMonitorPass({
      db,
      now: () => new Date(NOW.getTime() + 300_000),
      fetchFn: up,
      sendAlert: null,
    });
    expect(await checksFor(target.id)).toHaveLength(2);
  });
});

describe("resilience", () => {
  it("records a probe that THREW as a down check rather than failing the sweep", async () => {
    const first = await httpTarget({ name: "throws" });
    const second = await httpTarget({ name: "works" });
    let call = 0;
    const flaky: FetchLike = () => {
      call += 1;
      if (call === 1) throw new Error("synchronous explosion at https://host/?token=SECRET");
      return Promise.resolve(new Response("", { status: 200 }));
    };

    const result = await runMonitorPass({ db, now: () => NOW, fetchFn: flaky, sendAlert: null });

    expect(result.checksWritten).toBe(2);
    const firstCheck = (await checksFor(first.id))[0]!;
    expect(firstCheck.status).toBe("down");
    expect(JSON.stringify(firstCheck)).not.toContain("SECRET");
    // The rest of the sweep still ran.
    expect((await checksFor(second.id))[0]!.status).toBe("up");
  });

  it("does not let one target's alert failure stop the sweep", async () => {
    await httpTarget({ name: "a", failure_threshold: 1 });
    await httpTarget({ name: "b", failure_threshold: 1 });

    const result = await runMonitorPass({
      db,
      now: () => NOW,
      fetchFn: always(new Response("", { status: 503 })),
      sendAlert: () => Promise.reject(new Error("queue down")),
    });

    expect(result.evaluated).toBe(2);
    expect(result.incidentsOpened).toBe(2);
    // The incidents are committed even though nobody could be told.
    expect(await countActiveIncidents(db)).toBe(2);
  });
});
