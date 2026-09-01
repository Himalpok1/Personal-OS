import {
  createDbClient,
  monitorChecks,
  monitorIncidents,
  monitorTargets,
  workerHeartbeat,
  type Db,
} from "@personal-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { observeWorkerHeartbeat, heartbeatFailureClass } from "./heartbeat.js";
import { recordCheck } from "./incidents.js";
import {
  createMonitorTarget,
  defaultMonitorTargets,
  deleteMonitorTarget,
  listMonitorTargets,
  listTargetsOfKind,
  muteMonitorTarget,
  seedDefaultMonitorTargets,
  setMonitorTargetEnabled,
} from "./targets.js";

const db: Db = createDbClient(process.env["DATABASE_URL"] ?? "");
const NOW = new Date("2026-09-01T12:00:00.000Z");

beforeEach(async () => {
  await db.delete(monitorChecks);
  await db.delete(monitorIncidents);
  await db.delete(monitorTargets);
  await db.delete(workerHeartbeat);
});

afterAll(async () => {
  await db.delete(monitorChecks);
  await db.delete(monitorIncidents);
  await db.delete(monitorTargets);
  await db.delete(workerHeartbeat);
  await db.$client.end();
});

describe("creating targets", () => {
  it("creates an http target with sensible defaults", async () => {
    const target = await createMonitorTarget(db, {
      name: "api",
      kind: "http",
      url: "http://api:3000/health",
    });
    expect(target.expectedStatus).toBe(200);
    expect(target.timeoutMs).toBe(10000);
    expect(target.failureThreshold).toBe(3);
    expect(target.recoveryThreshold).toBe(2);
    expect(target.enabled).toBe(true);
    expect(target.expectHealthyPayload).toBe(false);
  });

  it("creates a worker_heartbeat target with no url", async () => {
    const target = await createMonitorTarget(db, {
      name: "worker",
      kind: "worker_heartbeat",
      url: null,
      heartbeat_max_age_seconds: 180,
    });
    expect(target.url).toBeNull();
    expect(target.heartbeatMaxAgeSeconds).toBe(180);
  });

  it("rejects an http target with no url", async () => {
    // A cross-field rule SQL cannot usefully express: an http target with no URL
    // is unmonitorable, so it must be uncreatable.
    await expect(
      createMonitorTarget(db, { name: "bad", kind: "http", url: null }),
    ).rejects.toThrow();
  });

  it("rejects a worker_heartbeat target carrying a url", async () => {
    await expect(
      createMonitorTarget(db, {
        name: "bad",
        kind: "worker_heartbeat",
        url: "http://api:3000/health",
      }),
    ).rejects.toThrow();
  });

  it("rejects tls_warn_days on a plaintext url", async () => {
    // It would produce a probe that can never succeed and an alert nobody can
    // act on.
    await expect(
      createMonitorTarget(db, {
        name: "bad",
        kind: "http",
        url: "http://api:3000/health",
        tls_warn_days: 21,
      }),
    ).rejects.toThrow();
  });

  it("accepts tls_warn_days on https", async () => {
    const target = await createMonitorTarget(db, {
      name: "tailnet",
      kind: "http",
      url: "https://host.example/health",
      tls_warn_days: 21,
    });
    expect(target.tlsWarnDays).toBe(21);
  });

  it("rejects a PARTIAL maintenance window", async () => {
    // All-or-nothing, matching the database CHECK. A window with a start and no
    // timezone would evaluate in whatever zone the server happens to run in.
    await expect(
      createMonitorTarget(db, {
        name: "bad",
        kind: "http",
        url: "http://x/",
        maintenance_start: "02:00",
      }),
    ).rejects.toThrow();
  });

  it("accepts a complete maintenance window", async () => {
    const target = await createMonitorTarget(db, {
      name: "windowed",
      kind: "http",
      url: "http://x/",
      maintenance_start: "02:00",
      maintenance_end: "03:00",
      maintenance_timezone: "America/Chicago",
    });
    expect(target.maintenanceTimezone).toBe("America/Chicago");
  });

  it("rejects an unknown timezone", async () => {
    await expect(
      createMonitorTarget(db, {
        name: "bad",
        kind: "http",
        url: "http://x/",
        maintenance_start: "02:00",
        maintenance_end: "03:00",
        maintenance_timezone: "Mars/Olympus_Mons",
      }),
    ).rejects.toThrow();
  });

  it("rejects an unknown field rather than ignoring it", async () => {
    // `.strict()`: a typo must be a validation failure, not a silently-dropped
    // setting an operator believes is in effect.
    await expect(
      createMonitorTarget(db, {
        name: "bad",
        kind: "http",
        url: "http://x/",
        failureThreshold: 5,
      } as never),
    ).rejects.toThrow();
  });

  it("rejects a non-positive threshold or timeout", async () => {
    for (const bad of [
      { failure_threshold: 0 },
      { recovery_threshold: 0 },
      { timeout_ms: 0 },
      { interval_seconds: 0 },
    ]) {
      await expect(
        createMonitorTarget(db, {
          name: `bad-${JSON.stringify(bad)}`,
          kind: "http",
          url: "http://x/",
          ...bad,
        }),
      ).rejects.toThrow();
    }
  });

  it("enforces a unique name at the database level", async () => {
    await createMonitorTarget(db, { name: "dup", kind: "http", url: "http://x/" });
    await expect(
      createMonitorTarget(db, { name: "dup", kind: "http", url: "http://y/" }),
    ).rejects.toThrow();
  });
});

describe("managing targets", () => {
  it("lists targets by name, stably", async () => {
    await createMonitorTarget(db, { name: "zeta", kind: "http", url: "http://z/" });
    await createMonitorTarget(db, { name: "alpha", kind: "http", url: "http://a/" });
    expect((await listMonitorTargets(db)).map((t) => t.name)).toEqual(["alpha", "zeta"]);
  });

  it("lists by kind, which is how each process finds its own work", async () => {
    await createMonitorTarget(db, { name: "http-one", kind: "http", url: "http://a/" });
    await createMonitorTarget(db, { name: "hb", kind: "worker_heartbeat", url: null });

    expect((await listTargetsOfKind(db, "http")).map((t) => t.name)).toEqual(["http-one"]);
    expect((await listTargetsOfKind(db, "worker_heartbeat")).map((t) => t.name)).toEqual(["hb"]);
  });

  it("mutes and disables", async () => {
    const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
    const until = new Date(NOW.getTime() + 900_000);

    const muted = await muteMonitorTarget(db, target.id, until, NOW);
    expect(muted!.mutedUntil!.toISOString()).toBe(until.toISOString());

    const disabled = await setMonitorTargetEnabled(db, target.id, false, NOW);
    expect(disabled!.enabled).toBe(false);
  });

  it("CASCADES checks and incidents when a target is deleted", async () => {
    const target = await createMonitorTarget(db, { name: "t", kind: "http", url: "http://x/" });
    await recordCheck(db, { targetId: target.id, status: "down" });
    await db.insert(monitorIncidents).values({ targetId: target.id, status: "open" });

    expect(await deleteMonitorTarget(db, target.id)).toBe(true);
    expect(
      await db.select().from(monitorChecks).where(eq(monitorChecks.targetId, target.id)),
    ).toHaveLength(0);
    expect(
      await db.select().from(monitorIncidents).where(eq(monitorIncidents.targetId, target.id)),
    ).toHaveLength(0);
  });
});

describe("the default target set", () => {
  const urls = { apiBaseUrl: "http://api:3000", webBaseUrl: "http://web:8080" };

  it("omits the tailnet targets unless their origins are supplied", () => {
    // ADR-055: worker-to-Tailscale reachability is UNVERIFIED and must not be
    // assumed. Seeding them by default would produce a permanently-open incident
    // telling a deployment something true but useless.
    const names = defaultMonitorTargets(urls).map((t) => t.name);
    expect(names).toEqual(["api-internal-health", "web-internal", "worker-heartbeat"]);
  });

  it("includes them when they are", () => {
    const names = defaultMonitorTargets({
      ...urls,
      tailnetApiOrigin: "https://host.tailnet.ts.net",
      tailnetWebOrigin: "https://host.tailnet.ts.net:8443",
    }).map((t) => t.name);
    expect(names).toContain("api-tailnet-health");
    expect(names).toContain("web-tailnet");
  });

  it("puts TLS warnings only on the https targets", () => {
    const targets = defaultMonitorTargets({
      ...urls,
      tailnetApiOrigin: "https://host.tailnet.ts.net",
    });
    for (const target of targets) {
      const isHttps = (target.url ?? "").startsWith("https://");
      expect(Boolean(target.tls_warn_days), target.name).toBe(isHttps);
    }
  });

  it("asks the api target to parse its health payload", () => {
    const api = defaultMonitorTargets(urls).find((t) => t.name === "api-internal-health");
    // A 200 saying `db: "unreachable"` is not up in any sense the user cares
    // about.
    expect(api!.expect_healthy_payload).toBe(true);
  });

  it("seeds idempotently and never overwrites operator changes", async () => {
    const first = await seedDefaultMonitorTargets(db, urls);
    expect(first.created).toHaveLength(3);
    expect(first.skipped).toHaveLength(0);

    // An operator widens a timeout and mutes for a deploy.
    const [target] = await db
      .select()
      .from(monitorTargets)
      .where(eq(monitorTargets.name, "api-internal-health"));
    await muteMonitorTarget(db, target!.id, new Date(NOW.getTime() + 600_000), NOW);

    const second = await seedDefaultMonitorTargets(db, urls);
    expect(second.created).toHaveLength(0);
    expect(second.skipped).toHaveLength(3);

    const [after] = await db
      .select()
      .from(monitorTargets)
      .where(eq(monitorTargets.name, "api-internal-health"));
    // A redeploy re-running the seed must not silently revert a deliberate
    // operator change.
    expect(after!.mutedUntil).not.toBeNull();
  });

  it("tolerates a trailing slash in the supplied base urls", () => {
    const targets = defaultMonitorTargets({
      apiBaseUrl: "http://api:3000/",
      webBaseUrl: "http://web:8080///",
    });
    expect(targets[0]!.url).toBe("http://api:3000/health");
    expect(targets[1]!.url).toBe("http://web:8080/");
  });

  it("produces targets that all pass the create contract", async () => {
    // The seed set is data, so it can drift out of contract silently. This is
    // the assertion that stops it.
    for (const target of defaultMonitorTargets({
      ...urls,
      tailnetApiOrigin: "https://host.tailnet.ts.net",
      tailnetWebOrigin: "https://host.tailnet.ts.net:8443",
    })) {
      await expect(createMonitorTarget(db, target)).resolves.toBeDefined();
    }
  });
});

describe("worker heartbeat observation", () => {
  it("treats a MISSING row as stale", async () => {
    // Treating "no heartbeat has ever been recorded" as healthy is precisely the
    // failure that hides a worker which never started -- the very first deploy
    // would report green while nothing was processing.
    const observation = await observeWorkerHeartbeat(db, 180, NOW);
    expect(observation.stale).toBe(true);
    expect(observation.lastBeatAt).toBeNull();
    expect(observation.ageSeconds).toBeNull();
    expect(heartbeatFailureClass(observation)).toBe("worker_never_started");
  });

  it("reports a fresh heartbeat as healthy", async () => {
    await db
      .insert(workerHeartbeat)
      .values({ id: 1, lastBeatAt: new Date(NOW.getTime() - 30_000), status: "ok" });
    const observation = await observeWorkerHeartbeat(db, 180, NOW);
    expect(observation.stale).toBe(false);
    expect(observation.ageSeconds).toBe(30);
    expect(heartbeatFailureClass(observation)).toBeNull();
  });

  it("detects staleness past the bound, and distinguishes it from never starting", async () => {
    await db
      .insert(workerHeartbeat)
      .values({ id: 1, lastBeatAt: new Date(NOW.getTime() - 600_000), status: "ok" });
    const observation = await observeWorkerHeartbeat(db, 180, NOW);
    expect(observation.stale).toBe(true);
    expect(observation.ageSeconds).toBe(600);
    // A running worker that died is a different problem from one that never
    // started, and sends an operator to a different place first.
    expect(heartbeatFailureClass(observation)).toBe("worker_heartbeat_stale");
  });

  it("is not stale exactly at the bound", async () => {
    await db
      .insert(workerHeartbeat)
      .values({ id: 1, lastBeatAt: new Date(NOW.getTime() - 180_000), status: "ok" });
    expect((await observeWorkerHeartbeat(db, 180, NOW)).stale).toBe(false);

    await db
      .update(workerHeartbeat)
      .set({ lastBeatAt: new Date(NOW.getTime() - 181_000) })
      .where(eq(workerHeartbeat.id, 1));
    expect((await observeWorkerHeartbeat(db, 180, NOW)).stale).toBe(true);
  });

  it("recovers once the worker beats again", async () => {
    await db
      .insert(workerHeartbeat)
      .values({ id: 1, lastBeatAt: new Date(NOW.getTime() - 600_000), status: "ok" });
    expect((await observeWorkerHeartbeat(db, 180, NOW)).stale).toBe(true);

    await db.update(workerHeartbeat).set({ lastBeatAt: NOW }).where(eq(workerHeartbeat.id, 1));
    const recovered = await observeWorkerHeartbeat(db, 180, NOW);
    expect(recovered.stale).toBe(false);
    expect(recovered.ageSeconds).toBe(0);
  });

  it("clamps a clock-skewed future heartbeat to zero rather than going negative", async () => {
    await db
      .insert(workerHeartbeat)
      .values({ id: 1, lastBeatAt: new Date(NOW.getTime() + 60_000), status: "ok" });
    const observation = await observeWorkerHeartbeat(db, 180, NOW);
    expect(observation.ageSeconds).toBe(0);
    expect(observation.stale).toBe(false);
  });
});
