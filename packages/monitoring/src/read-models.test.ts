import {
  createDbClient,
  monitorChecks,
  monitorIncidents,
  monitorTargets,
  type Db,
} from "@personal-os/db";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  findIncidentWithTarget,
  listMonitorIncidents,
  listMonitorTargetStatus,
} from "./read-models.js";
import { createMonitorTarget } from "./targets.js";

const db: Db = createDbClient(process.env["DATABASE_URL"] ?? "");
const NOW = new Date("2026-09-01T12:00:00.000Z");

async function seedTarget(name: string, overrides: Record<string, unknown> = {}) {
  return await createMonitorTarget(db, {
    name,
    kind: "http",
    url: "http://api:3000/health",
    ...overrides,
  });
}

async function seedCheck(
  targetId: string,
  status: "up" | "down" | "skipped",
  offsetSeconds: number,
  extra: Record<string, unknown> = {},
) {
  await db.insert(monitorChecks).values({
    targetId,
    status,
    checkedAt: new Date(NOW.getTime() + offsetSeconds * 1000),
    ...extra,
  });
}

async function seedIncident(
  targetId: string,
  values: Record<string, unknown> = {},
): Promise<string> {
  const [row] = await db
    .insert(monitorIncidents)
    .values({ targetId, status: "open", openedAt: NOW, ...values })
    .returning({ id: monitorIncidents.id });
  return row!.id;
}

beforeEach(async () => {
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

describe("listMonitorTargetStatus", () => {
  it("returns an empty list when nothing is configured", async () => {
    // Distinct from "everything is up". A deployment that never seeded targets
    // is not being monitored, and the caller must be able to tell.
    expect(await listMonitorTargetStatus(db)).toEqual([]);
  });

  it("returns a NULL latest check for a target nobody has checked yet", async () => {
    // The single most important case here: never-checked and down must not
    // collapse. A target seeded a minute ago has no check at all.
    const target = await seedTarget("fresh");
    const [row] = await listMonitorTargetStatus(db);
    expect(row!.target.id).toBe(target.id);
    expect(row!.latestCheck).toBeNull();
    expect(row!.activeIncident).toBeNull();
  });

  it("returns the NEWEST check, not an arbitrary one", async () => {
    const target = await seedTarget("api");
    await seedCheck(target.id, "down", 0, { failureClass: "http_status:503" });
    await seedCheck(target.id, "up", 60, { httpStatus: 200, latencyMs: 12 });
    await seedCheck(target.id, "down", 30, { failureClass: "timeout" });

    const [row] = await listMonitorTargetStatus(db);
    expect(row!.latestCheck?.status).toBe("up");
    expect(row!.latestCheck?.latencyMs).toBe(12);
  });

  it("returns a SKIPPED check as the latest when it is the latest", async () => {
    // A maintenance window is the most recent thing that happened, and hiding
    // it would make the screen show a stale "up" as though it were current.
    const target = await seedTarget("in-maintenance");
    await seedCheck(target.id, "up", 0);
    await seedCheck(target.id, "skipped", 60, { failureClass: "maintenance_window" });

    const [row] = await listMonitorTargetStatus(db);
    expect(row!.latestCheck?.status).toBe("skipped");
    expect(row!.latestCheck?.failureClass).toBe("maintenance_window");
  });

  it("pairs each target with its OWN newest check, never another target's", async () => {
    // The defect a naive `order by checked_at desc limit 1` would produce.
    const first = await seedTarget("aaa");
    const second = await seedTarget("bbb");
    await seedCheck(first.id, "down", 0, { failureClass: "timeout" });
    await seedCheck(second.id, "up", 600, { httpStatus: 200 });

    const rows = await listMonitorTargetStatus(db);
    const byName = new Map(rows.map((r) => [r.target.name, r]));
    expect(byName.get("aaa")!.latestCheck?.status).toBe("down");
    expect(byName.get("bbb")!.latestCheck?.status).toBe("up");
  });

  it("attaches an OPEN incident", async () => {
    const target = await seedTarget("down-service");
    await seedIncident(target.id, { failureClass: "unreachable" });
    const [row] = await listMonitorTargetStatus(db);
    expect(row!.activeIncident?.status).toBe("open");
    expect(row!.activeIncident?.failureClass).toBe("unreachable");
  });

  it("attaches an ACKNOWLEDGED incident, because acknowledgement is not resolution", async () => {
    // Filtering acknowledged out would make the screen imply the outage ended
    // the moment somebody looked at it.
    const target = await seedTarget("known-down");
    await seedIncident(target.id, { status: "acknowledged", acknowledgedAt: NOW });
    const [row] = await listMonitorTargetStatus(db);
    expect(row!.activeIncident?.status).toBe("acknowledged");
    expect(row!.activeIncident?.acknowledgedAt).not.toBeNull();
  });

  it("does NOT attach a resolved incident", async () => {
    const target = await seedTarget("recovered");
    await seedIncident(target.id, { status: "resolved", resolvedAt: NOW });
    const [row] = await listMonitorTargetStatus(db);
    expect(row!.activeIncident).toBeNull();
  });

  it("orders by name so the list does not reshuffle as services flap", async () => {
    await seedTarget("zulu");
    await seedTarget("alpha");
    await seedTarget("mike");
    const names = (await listMonitorTargetStatus(db)).map((r) => r.target.name);
    expect(names).toEqual(["alpha", "mike", "zulu"]);
  });

  it("includes DISABLED targets rather than hiding them", async () => {
    // A disabled target that silently vanishes reads as "not configured", which
    // is a different and more alarming claim than "deliberately paused".
    const target = await seedTarget("paused", { enabled: false });
    const rows = await listMonitorTargetStatus(db);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.target.id).toBe(target.id);
    expect(rows[0]!.target.enabled).toBe(false);
  });
});

describe("listMonitorIncidents", () => {
  it("is empty, with an honest zero total, when there are none", async () => {
    expect(await listMonitorIncidents(db, { limit: 20, offset: 0 })).toEqual({
      items: [],
      total: 0,
    });
  });

  it("returns newest first with the target name attached", async () => {
    const target = await seedTarget("api");
    await seedIncident(target.id, { openedAt: new Date(NOW.getTime() - 7200_000) });
    await seedIncident(target.id, {
      status: "resolved",
      resolvedAt: NOW,
      openedAt: new Date(NOW.getTime() - 3600_000),
    });

    const result = await listMonitorIncidents(db, { limit: 20, offset: 0 });
    expect(result.total).toBe(2);
    expect(result.items[0]!.targetName).toBe("api");
    expect(result.items[0]!.incident.openedAt.getTime()).toBeGreaterThan(
      result.items[1]!.incident.openedAt.getTime(),
    );
  });

  it("reports the total BEFORE the limit", async () => {
    // "3 of 5" and "3" are different statements, and only one of them is true.
    const target = await seedTarget("noisy");
    for (let i = 0; i < 5; i += 1) {
      await seedIncident(target.id, {
        status: "resolved",
        resolvedAt: NOW,
        openedAt: new Date(NOW.getTime() - i * 60_000),
      });
    }
    const result = await listMonitorIncidents(db, { limit: 3, offset: 0 });
    expect(result.items).toHaveLength(3);
    expect(result.total).toBe(5);
  });

  it("paginates without dropping or repeating a row", async () => {
    // Every incident shares one opened_at, so only the id tiebreak keeps the
    // order stable -- exactly the case an unstable sort would corrupt.
    const target = await seedTarget("same-instant");
    for (let i = 0; i < 6; i += 1) {
      await seedIncident(target.id, { status: "resolved", resolvedAt: NOW, openedAt: NOW });
    }
    const first = await listMonitorIncidents(db, { limit: 3, offset: 0 });
    const second = await listMonitorIncidents(db, { limit: 3, offset: 3 });
    const ids = [...first.items, ...second.items].map((i) => i.incident.id);
    expect(new Set(ids).size).toBe(6);
  });

  it("filters by target", async () => {
    const first = await seedTarget("aaa");
    const second = await seedTarget("bbb");
    await seedIncident(first.id);
    await seedIncident(second.id);

    const result = await listMonitorIncidents(db, { targetId: first.id, limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]!.targetName).toBe("aaa");
  });

  it("filters to active only, keeping acknowledged", async () => {
    const target = await seedTarget("api");
    await seedIncident(target.id, { status: "acknowledged", acknowledgedAt: NOW });
    await seedIncident(target.id, {
      status: "resolved",
      resolvedAt: NOW,
      openedAt: new Date(NOW.getTime() - 60_000),
    });

    const result = await listMonitorIncidents(db, { activeOnly: true, limit: 20, offset: 0 });
    expect(result.total).toBe(1);
    expect(result.items[0]!.incident.status).toBe("acknowledged");
  });
});

describe("findIncidentWithTarget", () => {
  it("returns null for an unknown id rather than throwing", async () => {
    expect(await findIncidentWithTarget(db, "00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("returns the incident and its target name", async () => {
    const target = await seedTarget("api");
    const id = await seedIncident(target.id);
    const found = await findIncidentWithTarget(db, id);
    expect(found?.targetName).toBe("api");
    expect(found?.incident.id).toBe(id);
  });

  it("survives the target being renamed", async () => {
    const target = await seedTarget("old-name");
    const id = await seedIncident(target.id);
    await db
      .update(monitorTargets)
      .set({ name: "new-name" })
      .where(eq(monitorTargets.id, target.id));
    expect((await findIncidentWithTarget(db, id))?.targetName).toBe("new-name");
  });
});
