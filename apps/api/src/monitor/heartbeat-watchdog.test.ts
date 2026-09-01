import { monitorChecks, monitorIncidents, workerHeartbeat } from "@personal-os/db";
import {
  countActiveIncidents,
  createMonitorTarget,
  type IncidentAlert,
} from "@personal-os/monitoring";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { runHeartbeatWatchdog } from "./heartbeat-watchdog.js";

// The API-owned worker-heartbeat watchdog (ADR-055).
//
// These tests exist because the thing under test is the ONE check the worker
// structurally cannot perform for itself, and a monitor that silently never
// fires is indistinguishable from a healthy system. Every case below therefore
// asserts on a written row or an incident transition, never on the absence of
// an exception.

let app: FastifyInstance;
const NOW = new Date("2026-09-01T12:00:00.000Z");

function alerts() {
  const captured: IncidentAlert[] = [];
  return {
    captured,
    send: (a: IncidentAlert) => {
      captured.push(a);
      return Promise.resolve();
    },
  };
}

/** Rewrites the singleton heartbeat row; `null` removes it entirely. */
async function setBeat(beatAt: Date | null): Promise<void> {
  await app.db.delete(workerHeartbeat);
  if (beatAt === null) return;
  await app.db.insert(workerHeartbeat).values({ id: 1, lastBeatAt: beatAt, status: "ok" });
}

/** A beat `seconds` before NOW. */
function ago(seconds: number): Date {
  return new Date(NOW.getTime() - seconds * 1000);
}

/** NOW shifted forward by `minutes`. */
function at(minutes: number): Date {
  return new Date(NOW.getTime() + minutes * 60_000);
}

async function heartbeatTarget(overrides: Record<string, unknown> = {}) {
  return await createMonitorTarget(app.db, {
    name: "worker-heartbeat",
    kind: "worker_heartbeat",
    url: null,
    heartbeat_max_age_seconds: 180,
    failure_threshold: 1,
    recovery_threshold: 1,
    interval_seconds: 1,
    ...overrides,
  });
}

async function checksFor(targetId: string) {
  return await app.db
    .select()
    .from(monitorChecks)
    .where(eq(monitorChecks.targetId, targetId))
    .orderBy(asc(monitorChecks.checkedAt), asc(monitorChecks.id));
}

beforeEach(async () => {
  app ??= await buildTestApp();
  await truncateTestTables(app);
  await setBeat(null);
});

afterAll(async () => {
  await truncateTestTables(app);
  await setBeat(null);
  await app.close();
});

describe("configuration", () => {
  it("is idle, and writes nothing, when no heartbeat target is configured", async () => {
    // Monitoring is opt-in configuration. A deployment that has not seeded
    // targets should be silent rather than inventing one.
    await setBeat(ago(10));

    const result = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });

    expect(result).toEqual({
      status: null,
      ageSeconds: null,
      failureClass: null,
      transition: null,
    });
    expect(await app.db.select().from(monitorChecks)).toHaveLength(0);
  });

  it("decorates runHeartbeatWatchdogOnce even with the interval disabled", async () => {
    // The plugin's timer is off in tests, but the evaluation must still be
    // drivable -- otherwise these tests would verify a code path the production
    // process does not actually use.
    expect(typeof app.runHeartbeatWatchdogOnce).toBe("function");
    await expect(app.runHeartbeatWatchdogOnce()).resolves.toBeUndefined();
  });
});

describe("staleness", () => {
  it("records a healthy check for a recent beat", async () => {
    const target = await heartbeatTarget();
    await setBeat(ago(30));

    const result = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });

    expect(result.status).toBe("up");
    expect(result.ageSeconds).toBe(30);
    expect(result.failureClass).toBeNull();
    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("up");
    expect(check!.heartbeatAgeSeconds).toBe(30);
  });

  it("detects a stale beat and opens an incident", async () => {
    const target = await heartbeatTarget();
    await setBeat(ago(600));
    const collector = alerts();

    const result = await runHeartbeatWatchdog({
      db: app.db,
      now: () => NOW,
      sendAlert: collector.send,
    });

    expect(result.status).toBe("down");
    expect(result.failureClass).toBe("worker_heartbeat_stale");
    expect(result.transition).toBe("open");
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);
    expect(collector.captured).toHaveLength(1);
    expect(collector.captured[0]!.dedupeKey).toMatch(/^monitor:[0-9a-f-]{36}:opened$/);
  });

  it("treats a MISSING heartbeat row as stale, with its own failure class", async () => {
    // The alternative -- "no heartbeat has ever been recorded" counts as healthy
    // -- would report green on a first deploy where the worker never started,
    // which is the worst possible moment to be reassuring.
    await heartbeatTarget();
    await setBeat(null);

    const result = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });

    expect(result.status).toBe("down");
    expect(result.ageSeconds).toBeNull();
    // A deployment problem, not a worker that died -- collapsing the two would
    // send an operator looking in the wrong place first.
    expect(result.failureClass).toBe("worker_never_started");
  });

  it("does not fire one second early", async () => {
    await heartbeatTarget({ heartbeat_max_age_seconds: 180 });

    await setBeat(ago(180));
    const onThreshold = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });
    expect(onThreshold.status).toBe("up");

    await app.db.delete(monitorChecks);
    await setBeat(ago(181));
    const past = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });
    expect(past.status).toBe("down");
  });

  it("respects the target's own failure threshold before opening", async () => {
    const target = await heartbeatTarget({ failure_threshold: 3 });
    await setBeat(ago(600));

    await runHeartbeatWatchdog({ db: app.db, now: () => at(0), sendAlert: null });
    await runHeartbeatWatchdog({ db: app.db, now: () => at(1), sendAlert: null });
    expect(await countActiveIncidents(app.db, target.id)).toBe(0);

    await runHeartbeatWatchdog({ db: app.db, now: () => at(2), sendAlert: null });
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);
  });
});

describe("recovery", () => {
  it("resolves the incident when the worker starts beating again", async () => {
    const target = await heartbeatTarget();
    const collector = alerts();

    await setBeat(ago(600));
    await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: collector.send });
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);

    // The worker comes back and beats five seconds before the next evaluation.
    await setBeat(new Date(at(1).getTime() - 5_000));
    const result = await runHeartbeatWatchdog({
      db: app.db,
      now: () => at(1),
      sendAlert: collector.send,
    });

    expect(result.transition).toBe("resolve");
    expect(await countActiveIncidents(app.db, target.id)).toBe(0);
    expect(collector.captured.map((a) => a.kind)).toEqual(["opened", "resolved"]);

    const [incident] = await app.db
      .select()
      .from(monitorIncidents)
      .where(eq(monitorIncidents.targetId, target.id));
    expect(incident!.status).toBe("resolved");
    expect(incident!.resolvedAt).not.toBeNull();
  });

  it("uses incident-scoped dedupe keys, so a SECOND outage can alert", async () => {
    // The latent defect ADR-055 is written against:
    // `notification_dispatch_log.dedupe_key` is a permanent primary key with no
    // TTL, so a target-scoped key would burn itself on the first outage and the
    // worker could never be reported dead again.
    const target = await heartbeatTarget();
    const collector = alerts();

    /** Evaluates at NOW+`minute` with the worker's last beat set to `beat`. */
    const drive = async (minute: number, beat: Date): Promise<void> => {
      await setBeat(beat);
      await runHeartbeatWatchdog({ db: app.db, now: () => at(minute), sendAlert: collector.send });
    };

    await drive(0, ago(600)); // stale -> incident one opens
    await drive(1, new Date(at(1).getTime() - 5_000)); // fresh -> incident one resolves
    await drive(2, ago(600)); // stale again -> incident TWO must open

    const opened = collector.captured.filter((a) => a.kind === "opened");
    expect(opened).toHaveLength(2);
    expect(opened[0]!.dedupeKey).not.toBe(opened[1]!.dedupeKey);
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);
  });
});

describe("suppression and pacing", () => {
  it("writes a skipped row inside a maintenance window and opens no incident", async () => {
    // NOW is 07:00 in America/Chicago.
    const target = await heartbeatTarget({
      maintenance_start: "06:00",
      maintenance_end: "08:00",
      maintenance_timezone: "America/Chicago",
    });
    await setBeat(ago(600));

    const result = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });

    expect(result.status).toBe("skipped");
    expect(result.transition).toBeNull();
    const [check] = await checksFor(target.id);
    expect(check!.status).toBe("skipped");
    expect(check!.failureClass).toBe("maintenance_window");
    // The decisive assertion: no incident, even though the heartbeat WAS stale.
    expect(await countActiveIncidents(app.db, target.id)).toBe(0);
  });

  it("writes nothing at all for a disabled target", async () => {
    const target = await heartbeatTarget({ enabled: false });
    await setBeat(ago(600));

    const result = await runHeartbeatWatchdog({ db: app.db, now: () => NOW, sendAlert: null });

    expect(result.status).toBe("skipped");
    expect(await checksFor(target.id)).toHaveLength(0);
  });

  it("honours the target's interval rather than the timer's", async () => {
    // The plugin ticks every minute; the TARGET decides how often a check is
    // actually recorded. Without this, `interval_seconds` would be decorative.
    const target = await heartbeatTarget({ interval_seconds: 300 });
    await setBeat(ago(30));

    await runHeartbeatWatchdog({ db: app.db, now: () => at(0), sendAlert: null });
    await runHeartbeatWatchdog({ db: app.db, now: () => at(1), sendAlert: null });
    expect(await checksFor(target.id)).toHaveLength(1);

    await runHeartbeatWatchdog({ db: app.db, now: () => at(5), sendAlert: null });
    expect(await checksFor(target.id)).toHaveLength(2);
  });
});

describe("resilience", () => {
  it("commits the incident even when alerting fails", async () => {
    // The incident is the durable fact; the notification is best-effort. Losing
    // the fact because a queue was unavailable would mean the outage never
    // happened as far as the system is concerned.
    const target = await heartbeatTarget();
    await setBeat(ago(600));

    const result = await runHeartbeatWatchdog({
      db: app.db,
      now: () => NOW,
      sendAlert: () => Promise.reject(new Error("queue unavailable")),
    });

    expect(result.transition).toBe("open");
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);
  });

  it("is a no-op sender rather than a failure when there is no queue", async () => {
    // `boss: null` is the real production shape before pg-boss finishes
    // connecting; it must cost a notification, never a fact.
    const target = await heartbeatTarget();
    await setBeat(ago(600));

    const result = await runHeartbeatWatchdog({ db: app.db, boss: null, now: () => NOW });

    expect(result.transition).toBe("open");
    expect(await countActiveIncidents(app.db, target.id)).toBe(1);
  });
});
