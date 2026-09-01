import {
  createDbClient,
  monitorChecks,
  monitorIncidents,
  monitorTargets,
  type Db,
} from "@personal-os/db";
import type { MonitorCheckStatus } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  acknowledgeIncident,
  countActiveIncidents,
  evaluateIncident,
  findActiveIncident,
  recentDecisiveStatuses,
  recordCheck,
  type IncidentAlert,
} from "./incidents.js";
import { createMonitorTarget } from "./targets.js";

const db: Db = createDbClient(process.env["DATABASE_URL"] ?? "");
const NOW = new Date("2026-09-01T12:00:00.000Z");

/** Collects the alerts a pass would have enqueued, without a queue. */
function alertCollector() {
  const alerts: IncidentAlert[] = [];
  return { alerts, send: (a: IncidentAlert) => (alerts.push(a), Promise.resolve()) };
}

async function seedTarget(overrides: { failure?: number; recovery?: number; name?: string } = {}) {
  return await createMonitorTarget(db, {
    name: overrides.name ?? `target-${Math.random().toString(36).slice(2, 10)}`,
    kind: "http",
    url: "http://api:3000/health",
    failure_threshold: overrides.failure ?? 3,
    recovery_threshold: overrides.recovery ?? 2,
  });
}

/**
 * Writes checks oldest-first, one second apart, so ordering is unambiguous.
 *
 * The sequence is MODULE-LEVEL and monotonic across calls, not derived from the
 * array's own length. The first version of this helper computed timestamps from
 * `statuses.length` alone, so two calls in one test -- write two failures, then
 * write two successes -- produced the SAME two timestamps, and
 * `order by checked_at desc` returned an interleaved history whose leading run
 * was whatever the uuid tiebreak happened to pick. Four resolve tests failed on
 * the harness rather than on the code.
 */
let checkSequence = 0;

async function writeChecks(targetId: string, statuses: MonitorCheckStatus[]): Promise<void> {
  for (const status of statuses) {
    checkSequence += 1;
    await recordCheck(db, {
      targetId,
      status,
      failureClass: status === "down" ? "http_status:503" : null,
      checkedAt: new Date(NOW.getTime() + checkSequence * 1000),
    });
  }
}

beforeEach(async () => {
  checkSequence = 0;
  await db.delete(monitorChecks);
  await db.delete(monitorIncidents);
  await db.delete(monitorTargets);
});

afterAll(async () => {
  await db.delete(monitorChecks);
  await db.delete(monitorIncidents);
  await db.delete(monitorTargets);
  await db.$client.end();
});

describe("check history", () => {
  it("returns statuses newest first", async () => {
    const target = await seedTarget();
    await writeChecks(target.id, ["up", "down", "down"]);
    expect(await recentDecisiveStatuses(db, target.id)).toEqual(["down", "down", "up"]);
  });

  it("EXCLUDES skipped rows in the query, not in the caller", async () => {
    // The placement matters: it means no code path can accidentally evaluate a
    // threshold against a history containing maintenance skips. A skip counted
    // as "not down" would let a nightly window silently reset a failure streak
    // one check from opening an incident.
    const target = await seedTarget();
    await writeChecks(target.id, ["down", "skipped", "down", "down"]);
    expect(await recentDecisiveStatuses(db, target.id)).toEqual(["down", "down", "down"]);
  });

  it("scopes to one target", async () => {
    const a = await seedTarget({ name: "a" });
    const b = await seedTarget({ name: "b" });
    await writeChecks(a.id, ["down", "down"]);
    await writeChecks(b.id, ["up"]);
    expect(await recentDecisiveStatuses(db, a.id)).toEqual(["down", "down"]);
    expect(await recentDecisiveStatuses(db, b.id)).toEqual(["up"]);
  });

  it("sanitizes a failure class that is not token-shaped", async () => {
    // Defence in depth: every caller in this package emits a token, but the
    // alternative is trusting that no future caller passes a string from
    // somewhere else -- which is how a URL with a token in it reaches a column.
    const target = await seedTarget();
    await recordCheck(db, {
      targetId: target.id,
      status: "down",
      failureClass: "fetch failed: https://host/health?token=SECRET",
    });
    const [row] = await db
      .select()
      .from(monitorChecks)
      .where(eq(monitorChecks.targetId, target.id));
    expect(row!.failureClass).toBe("probe_error");
    expect(row!.failureClass).not.toContain("SECRET");
  });
});

describe("opening an incident", () => {
  it("opens at the failure threshold and alerts once", async () => {
    const target = await seedTarget({ failure: 3 });
    const collector = alertCollector();
    await writeChecks(target.id, ["down", "down", "down"]);

    const outcome = await evaluateIncident(db, {
      target,
      failureClass: "http_status:503",
      now: NOW,
      sendAlert: collector.send,
    });

    expect(outcome.transition).toBe("open");
    expect(outcome.alerted).toBe(true);
    expect(await countActiveIncidents(db, target.id)).toBe(1);

    const incident = await findActiveIncident(db, target.id);
    expect(incident!.status).toBe("open");
    expect(incident!.failureClass).toBe("http_status:503");
    expect(incident!.resolvedAt).toBeNull();
  });

  it("does not open below the threshold", async () => {
    const target = await seedTarget({ failure: 3 });
    await writeChecks(target.id, ["down", "down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });
    expect(outcome.transition).toBe("none");
    expect(await countActiveIncidents(db, target.id)).toBe(0);
  });

  it("NEVER opens a duplicate while one is active", async () => {
    const target = await seedTarget({ failure: 3 });
    await writeChecks(target.id, ["down", "down", "down"]);
    await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    // Three more failures, with an incident already open.
    await writeChecks(target.id, ["down", "down", "down"]);
    const second = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    expect(second.transition).toBe("none");
    expect(await countActiveIncidents(db, target.id)).toBe(1);
  });

  it("advances last_failure_at while an incident stays open, without re-alerting", async () => {
    const target = await seedTarget({ failure: 3 });
    const collector = alertCollector();
    await writeChecks(target.id, ["down", "down", "down"]);
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: collector.send,
    });

    const later = new Date(NOW.getTime() + 600_000);
    checkSequence += 600;
    await recordCheck(db, { targetId: target.id, status: "down", checkedAt: later });
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: later,
      sendAlert: collector.send,
    });

    const incident = await findActiveIncident(db, target.id);
    expect(incident!.lastFailureAt!.toISOString()).toBe(later.toISOString());
    // A still-open incident has already been announced.
    expect(collector.alerts).toHaveLength(1);
  });

  it("is enforced by the DATABASE, not only by the decision", async () => {
    // The partial unique index is the real guarantee. A direct insert bypassing
    // evaluateIncident must still fail.
    const target = await seedTarget();
    await db.insert(monitorIncidents).values({ targetId: target.id, status: "open" });
    await expect(
      db.insert(monitorIncidents).values({ targetId: target.id, status: "open" }),
    ).rejects.toThrow();
  });
});

describe("resolving an incident", () => {
  it("resolves at the recovery threshold and alerts once", async () => {
    const target = await seedTarget({ failure: 2, recovery: 2 });
    const collector = alertCollector();
    await writeChecks(target.id, ["down", "down"]);
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: collector.send,
    });

    await writeChecks(target.id, ["up", "up"]);
    const outcome = await evaluateIncident(db, {
      target,
      failureClass: null,
      now: NOW,
      sendAlert: collector.send,
    });

    expect(outcome.transition).toBe("resolve");
    expect(await countActiveIncidents(db, target.id)).toBe(0);

    const [incident] = await db
      .select()
      .from(monitorIncidents)
      .where(eq(monitorIncidents.targetId, target.id));
    expect(incident!.status).toBe("resolved");
    expect(incident!.resolvedAt).not.toBeNull();

    expect(collector.alerts.map((a) => a.kind)).toEqual(["opened", "resolved"]);
  });

  it("does not resolve below the recovery threshold", async () => {
    const target = await seedTarget({ failure: 2, recovery: 3 });
    await writeChecks(target.id, ["down", "down"]);
    await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    await writeChecks(target.id, ["up", "up"]);
    const outcome = await evaluateIncident(db, { target, failureClass: null, now: NOW });
    expect(outcome.transition).toBe("none");
    expect(await countActiveIncidents(db, target.id)).toBe(1);
  });

  it("is a no-op when there is nothing open to resolve", async () => {
    const target = await seedTarget({ recovery: 2 });
    await writeChecks(target.id, ["up", "up"]);
    const outcome = await evaluateIncident(db, { target, failureClass: null, now: NOW });
    expect(outcome.transition).toBe("none");
  });
});

describe("a SECOND outage is notifiable -- the whole reason incidents are durable", () => {
  it("mints a new incident id, and therefore a new dedupe key", async () => {
    // =====================================================================
    // THE DEFECT ADR-055 IS WRITTEN AGAINST.
    // =====================================================================
    // notification_dispatch_log.dedupe_key is a PERMANENT primary key with no
    // TTL. The existing calendar-needs-reauth:${connectionId} producer carries
    // no incident discriminator, so once that key is accepted the connection can
    // never alert again -- for the life of the database.
    const target = await seedTarget({ failure: 2, recovery: 2 });
    const collector = alertCollector();

    await writeChecks(target.id, ["down", "down"]);
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: collector.send,
    });
    await writeChecks(target.id, ["up", "up"]);
    await evaluateIncident(db, { target, failureClass: null, now: NOW, sendAlert: collector.send });

    // Second, entirely separate outage.
    await writeChecks(target.id, ["down", "down"]);
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: collector.send,
    });

    const opened = collector.alerts.filter((a) => a.kind === "opened");
    expect(opened).toHaveLength(2);
    expect(opened[0]!.incidentId).not.toBe(opened[1]!.incidentId);
    // Every key is unique, so none of them can collide with an already-accepted
    // row in the dispatch log.
    const keys = collector.alerts.map((a) => a.dedupeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("uses incident-scoped keys, never target-scoped ones", async () => {
    const target = await seedTarget({ failure: 1, recovery: 1 });
    const collector = alertCollector();
    await writeChecks(target.id, ["down"]);
    await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: collector.send,
    });

    const alert = collector.alerts[0]!;
    expect(alert.dedupeKey).toBe(`monitor:${alert.incidentId}:opened`);
    // The target id must NOT be the discriminator -- that is the shape that
    // permanently burns a key.
    expect(alert.dedupeKey).not.toContain(target.id);
  });

  it("keeps resolved incidents as history rather than deleting them", async () => {
    const target = await seedTarget({ failure: 1, recovery: 1 });
    await writeChecks(target.id, ["down"]);
    await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });
    await writeChecks(target.id, ["up"]);
    await evaluateIncident(db, { target, failureClass: null, now: NOW });
    await writeChecks(target.id, ["down"]);
    await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    const all = await db
      .select()
      .from(monitorIncidents)
      .where(eq(monitorIncidents.targetId, target.id));
    expect(all).toHaveLength(2);
    expect(all.filter((i) => i.status === "resolved")).toHaveLength(1);
  });
});

describe("alerting is best-effort and never undoes committed state", () => {
  it("still opens the incident when the alert sender throws", async () => {
    // By the time the sender runs, the incident row is committed. Throwing would
    // turn "we recorded an outage but could not push about it" into "the whole
    // pass failed", which loses the record too.
    const target = await seedTarget({ failure: 1 });
    await writeChecks(target.id, ["down"]);

    const outcome = await evaluateIncident(db, {
      target,
      failureClass: "timeout",
      now: NOW,
      sendAlert: () => Promise.reject(new Error("queue down")),
    });

    expect(outcome.transition).toBe("open");
    expect(outcome.alerted).toBe(false);
    expect(await countActiveIncidents(db, target.id)).toBe(1);
  });

  it("works with no sender at all", async () => {
    const target = await seedTarget({ failure: 1 });
    await writeChecks(target.id, ["down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });
    expect(outcome.transition).toBe("open");
    expect(outcome.alerted).toBe(false);
  });
});

describe("acknowledgement", () => {
  it("records that a human saw it WITHOUT resolving it", async () => {
    // Two separate facts. Collapsing them would mean either acknowledging closed
    // an incident that is still broken, or there was no way to record having
    // seen one. Only the machine resolves, from check history.
    const target = await seedTarget({ failure: 1 });
    await writeChecks(target.id, ["down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    const acked = await acknowledgeIncident(db, outcome.incidentId!, NOW);
    expect(acked!.status).toBe("acknowledged");
    expect(acked!.resolvedAt).toBeNull();
    // Still active, so no duplicate can open.
    expect(await countActiveIncidents(db, target.id)).toBe(1);
  });

  it("is idempotent, so the first-seen timestamp cannot move", async () => {
    const target = await seedTarget({ failure: 1 });
    await writeChecks(target.id, ["down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });

    await acknowledgeIncident(db, outcome.incidentId!, NOW);
    const second = await acknowledgeIncident(
      db,
      outcome.incidentId!,
      new Date(NOW.getTime() + 60_000),
    );
    expect(second).toBeUndefined();

    const incident = await findActiveIncident(db, target.id);
    expect(incident!.acknowledgedAt!.toISOString()).toBe(NOW.toISOString());
  });

  it("an acknowledged incident still resolves normally", async () => {
    const target = await seedTarget({ failure: 1, recovery: 1 });
    await writeChecks(target.id, ["down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });
    await acknowledgeIncident(db, outcome.incidentId!, NOW);

    await writeChecks(target.id, ["up"]);
    const resolved = await evaluateIncident(db, { target, failureClass: null, now: NOW });
    expect(resolved.transition).toBe("resolve");
    expect(await countActiveIncidents(db, target.id)).toBe(0);
  });

  it("refuses to acknowledge a resolved incident", async () => {
    const target = await seedTarget({ failure: 1, recovery: 1 });
    await writeChecks(target.id, ["down"]);
    const outcome = await evaluateIncident(db, { target, failureClass: "timeout", now: NOW });
    await writeChecks(target.id, ["up"]);
    await evaluateIncident(db, { target, failureClass: null, now: NOW });

    expect(await acknowledgeIncident(db, outcome.incidentId!, NOW)).toBeUndefined();
  });
});

describe("flap suppression, end to end", () => {
  it("a service alternating every check never opens and never resolves", async () => {
    const target = await seedTarget({ failure: 3, recovery: 2 });
    const collector = alertCollector();

    for (const status of ["down", "up", "down", "up", "down", "up"] as MonitorCheckStatus[]) {
      await writeChecks(target.id, [status]);
      await evaluateIncident(db, {
        target,
        failureClass: status === "down" ? "timeout" : null,
        now: NOW,
        sendAlert: collector.send,
      });
    }

    expect(await countActiveIncidents(db, target.id)).toBe(0);
    expect(collector.alerts).toHaveLength(0);
  });
});
