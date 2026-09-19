import { events } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { collectCalendarRange } from "./calendar-context.js";

// collectCalendarRange (Checkpoint 10.9). The builder suite in
// intelligence/calendar-context.test.ts covers the projection; this one pins
// what the collector itself adds on top of assembleEventRange: the local-date
// bounds, the all-day date re-test east of UTC, `origin`, and no description.

const TZ = "America/Chicago";

describe("collectCalendarRange", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  it("rejects a malformed or reversed range with a RangeError before reading", async () => {
    await expect(
      collectCalendarRange(app.db, { tz: TZ, from: "2026-09-20", to: "2026-09-14" }),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(
      collectCalendarRange(app.db, { tz: TZ, from: "2026/09/14", to: "2026-09-14" }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it("resolves the inclusive local window to the zone's own midnights", async () => {
    const { window } = await collectCalendarRange(app.db, {
      tz: TZ,
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(window.startUtc.toISOString()).toBe("2026-09-14T05:00:00.000Z"); // 00:00 CDT
    expect(window.endUtcExclusive.toISOString()).toBe("2026-09-15T05:00:00.000Z");
  });

  it("does not admit an all-day event from the previous LOCAL date for a caller east of UTC", async () => {
    // Auckland (UTC+12): local midnight 2026-09-14 is 2026-09-13T12:00Z. The
    // assembly's all-day SQL bounds by the UTC calendar date of that instant
    // (09-13), so without the collector's own date re-test this row would
    // leak into a request for 09-14.
    await app.db.insert(events).values({
      title: "Yesterday all day",
      timezone: "Pacific/Auckland",
      allDay: true,
      startDate: "2026-09-13",
      endDate: "2026-09-13",
      origin: "local",
    });
    await app.db.insert(events).values({
      title: "Today all day",
      timezone: "Pacific/Auckland",
      allDay: true,
      startDate: "2026-09-14",
      endDate: "2026-09-14",
      origin: "local",
    });
    const { rows } = await collectCalendarRange(app.db, {
      tz: "Pacific/Auckland",
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(rows.map((r) => r.title)).toEqual(["Today all day"]);
  });

  it("carries origin from the events row, defaulting a row inserted without one to external, and never a description", async () => {
    await app.db.insert(events).values({
      title: "Explicitly local",
      timezone: TZ,
      startsAt: new Date("2026-09-14T16:00:00Z"),
      endsAt: new Date("2026-09-14T17:00:00Z"),
      origin: "local",
      description: "not for the agent",
    });
    await app.db.insert(events).values({
      title: "Default origin",
      timezone: TZ,
      startsAt: new Date("2026-09-14T18:00:00Z"),
      endsAt: new Date("2026-09-14T19:00:00Z"),
      // origin omitted -> DB default 'external' (ADR-064)
    });
    const { rows } = await collectCalendarRange(app.db, {
      tz: TZ,
      from: "2026-09-14",
      to: "2026-09-14",
    });
    expect(rows.map((r) => [r.title, r.origin])).toEqual([
      ["Explicitly local", "local"],
      ["Default origin", "external"],
    ]);
    for (const row of rows) expect(Object.keys(row)).not.toContain("description");
  });
});
