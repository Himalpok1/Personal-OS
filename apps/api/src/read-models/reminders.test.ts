import { occurrences, tasks } from "@personal-os/db";
import { RemindersResponseSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { buildRemindersResponse } from "./reminders.js";

// The reminders read model (extracted from routes/reminders.ts in Checkpoint
// 9.7). Two properties: GET /reminders is byte-identical to the read model
// for the same rows and the same instant, and the `oneOffHorizon` option the
// Today context uses -- and the route never does -- bounds one-off reminders
// to the horizon without touching occurrence reminders.

const TZ = "America/Chicago";
const NOW = new Date("2026-09-14T14:30:00Z");
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

describe("buildRemindersResponse", () => {
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

  afterEach(() => {
    vi.useRealTimers();
  });

  async function seed(): Promise<void> {
    // One-off inside the horizon, one-off far beyond it, one-off just inside
    // the grace hour, one-off before the grace hour, and a recurring task with
    // two scheduled occurrences (one snoozed).
    await app.db.insert(tasks).values([
      {
        title: "Soon",
        status: "active",
        timezone: TZ,
        remindAt: new Date(NOW.getTime() + 2 * DAY_MS),
      },
      {
        title: "Far",
        status: "active",
        timezone: TZ,
        remindAt: new Date(NOW.getTime() + 40 * DAY_MS),
      },
      {
        title: "Just fired",
        status: "active",
        timezone: TZ,
        remindAt: new Date(NOW.getTime() - 30 * 60 * 1000),
      },
      {
        title: "Long gone",
        status: "active",
        timezone: TZ,
        remindAt: new Date(NOW.getTime() - 2 * HOUR_MS),
      },
    ]);
    const [recurring] = await app.db
      .insert(tasks)
      .values({
        title: "Chore",
        status: "active",
        timezone: TZ,
        rrule: "FREQ=DAILY",
        recurrenceTimezone: TZ,
        recurrenceAnchor: "due_date",
        dueAt: new Date("2026-09-14T13:00:00Z"),
        remindAt: new Date("2026-09-14T12:30:00Z"),
      })
      .returning();
    await app.db.insert(occurrences).values([
      {
        parentType: "task",
        parentId: recurring!.id,
        occursAt: new Date("2026-09-14T13:00:00Z"),
        occursLocal: new Date("2026-09-14T13:00:00Z"),
        status: "scheduled",
        lazyGenerated: false,
        snoozedUntil: new Date("2026-09-14T22:00:00Z"),
      },
      {
        parentType: "task",
        parentId: recurring!.id,
        occursAt: new Date("2026-09-15T13:00:00Z"),
        occursLocal: new Date("2026-09-15T13:00:00Z"),
        status: "scheduled",
        lazyGenerated: false,
      },
    ]);
  }

  it("GET /reminders returns exactly the read model's bytes for the same instant", async () => {
    await seed();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    for (const query of ["", "?horizon_days=7", "?horizon_days=45"]) {
      const response = await app.inject({ method: "GET", url: `/reminders${query}` });
      expect(response.statusCode).toBe(200);
      const horizon = query === "" ? 45 : Number(query.split("=")[1]);
      const model = await buildRemindersResponse(app.db, { horizon_days: horizon }, { now: NOW });
      expect(response.body).toBe(JSON.stringify(model));
      expect(model.items.length).toBeGreaterThan(0);
    }
  });

  it("without oneOffHorizon (the route) one-off reminders are unbounded into the future", async () => {
    await seed();
    const model = await buildRemindersResponse(app.db, { horizon_days: 7 }, { now: NOW });
    expect(model.items.map((i) => i.title)).toEqual([
      "Just fired",
      "Chore", // snoozed occurrence -> 17:00 CDT today
      "Chore", // tomorrow 07:30 CDT
      "Soon",
      "Far",
    ]);
    expect(model.items.filter((i) => i.recurring).map((i) => i.remind_at)).toEqual([
      "2026-09-14T22:00:00.000Z",
      "2026-09-15T12:30:00.000Z",
    ]);
    expect(RemindersResponseSchema.parse(model)).toEqual(model);
  });

  it("with oneOffHorizon (the Today context) one-offs are bounded to the horizon; occurrences are unchanged", async () => {
    await seed();
    const bounded = await buildRemindersResponse(
      app.db,
      { horizon_days: 7 },
      { now: NOW, oneOffHorizon: true },
    );
    expect(bounded.items.map((i) => i.title)).toEqual(["Just fired", "Chore", "Chore", "Soon"]);
    const unbounded = await buildRemindersResponse(app.db, { horizon_days: 7 }, { now: NOW });
    expect(unbounded.items.filter((i) => i.recurring)).toEqual(
      bounded.items.filter((i) => i.recurring),
    );
  });

  it("defaults `now` to the clock when no seam is given", async () => {
    await seed();
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const implicit = await buildRemindersResponse(app.db, { horizon_days: 7 });
    const explicit = await buildRemindersResponse(app.db, { horizon_days: 7 }, { now: NOW });
    expect(implicit).toEqual(explicit);
  });
});
