import { resolveWallClockToInstant } from "@personal-os/core";
import { events, occurrences } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { assembleEventRange } from "./event-range.js";

// Regression coverage for the canonical-all-day-recurrence defect: a
// recurring all-day event (starts_at NULL, start_date set -- the shape
// EventCreateSchema forces) previously never expanded at all, because the
// SQL predicate dropped NULL-startsAt rows and the private recurrence-rule
// builder returned null whenever startsAt was absent. These tests exercise
// the fix directly against assembleEventRange -- this file owns
// event-range.ts only, so route-level GET /events/range coverage stays in
// routes/events.test.ts (owned separately).

const TZ = "America/Chicago";

async function insertAllDayRecurringEvent(
  app: FastifyInstance,
  overrides: Partial<typeof events.$inferInsert>,
): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({
      title: "All-day recurring fixture",
      timezone: TZ,
      allDay: true,
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: TZ,
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

async function insertTimedRecurringEvent(
  app: FastifyInstance,
  overrides: Partial<typeof events.$inferInsert>,
): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({
      title: "Timed recurring fixture",
      timezone: TZ,
      startsAt: new Date("2026-08-10T09:00:00-05:00"),
      endsAt: new Date("2026-08-10T09:30:00-05:00"),
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: TZ,
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

function expectOk<T extends { ok: boolean }>(result: T): asserts result is T & { ok: true } {
  expect(result.ok).toBe(true);
}

describe("assembleEventRange -- all-day recurrence", () => {
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

  it("expands a canonical recurring all-day weekly series with each instance carrying its own start_date", async () => {
    await insertAllDayRecurringEvent(app, {
      title: "Weekly all-day",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const instances = result.items.filter((i) => i.is_recurring_instance);
    expect(instances.length).toBeGreaterThanOrEqual(3);
    for (const instance of instances) {
      expect(instance.all_day).toBe(true);
      expect(instance.starts_at).toBeNull();
      expect(instance.ends_at).toBeNull();
      expect(instance.start_date).toBe(instance.end_date);
    }

    const startDates = instances.map((i) => i.start_date).sort();
    // The four Mondays in August 2026 starting from Aug 10.
    expect(startDates).toEqual(["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    // Never three copies of the same date -- each instance is distinct.
    expect(new Set(startDates).size).toBe(startDates.length);
  });

  it("preserves a 3-day multi-day span on every recurring all-day instance", async () => {
    await insertAllDayRecurringEvent(app, {
      title: "3-day recurring",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const instances = result.items.filter((i) => i.is_recurring_instance);
    expect(instances.length).toBeGreaterThanOrEqual(3);
    const spans = instances
      .map((i) => [i.start_date, i.end_date] as const)
      .sort(([a], [b]) => (a! < b! ? -1 : 1));
    expect(spans).toEqual([
      ["2026-08-10", "2026-08-12"],
      ["2026-08-17", "2026-08-19"],
      ["2026-08-24", "2026-08-26"],
      ["2026-08-31", "2026-09-02"],
    ]);
  });

  it("does not shift all-day recurring instance dates when queried from Auckland-ish or Santiago-ish bounds", async () => {
    await insertAllDayRecurringEvent(app, {
      title: "Zone-stable series",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    });

    const aucklandBounds = {
      // UTC+13-ish offset -- local midnight of Aug 1/Sep 1 is well before
      // the corresponding UTC calendar day.
      from: new Date("2026-07-31T11:00:00.000Z"),
      to: new Date("2026-08-31T11:00:00.000Z"),
      includeArchived: false,
    };
    const santiagoBounds = {
      // UTC-3-ish offset -- local midnight of Aug 1/Sep 1 is well after
      // the corresponding UTC calendar day.
      from: new Date("2026-08-01T03:00:00.000Z"),
      to: new Date("2026-09-01T03:00:00.000Z"),
      includeArchived: false,
    };

    const aucklandResult = await assembleEventRange(app.db, aucklandBounds);
    const santiagoResult = await assembleEventRange(app.db, santiagoBounds);
    expectOk(aucklandResult);
    expectOk(santiagoResult);

    const aucklandDates = aucklandResult.items
      .filter((i) => i.is_recurring_instance)
      .map((i) => i.start_date)
      .sort();
    const santiagoDates = santiagoResult.items
      .filter((i) => i.is_recurring_instance)
      .map((i) => i.start_date)
      .sort();

    expect(aucklandDates).toEqual(["2026-08-10", "2026-08-17", "2026-08-24", "2026-08-31"]);
    expect(santiagoDates).toEqual(aucklandDates);
  });

  it("excludes an EXDATE'd all-day occurrence", async () => {
    await insertAllDayRecurringEvent(app, {
      title: "Exdate series",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      recurrenceExdates: ["2026-08-17"],
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const startDates = result.items
      .filter((i) => i.is_recurring_instance)
      .map((i) => i.start_date)
      .sort();
    expect(startDates).toEqual(["2026-08-10", "2026-08-24", "2026-08-31"]);
  });

  it("excludes an all-day instance with a real 'skipped' occurrence row", async () => {
    const eventId = await insertAllDayRecurringEvent(app, {
      title: "Skip series",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
    });

    // Determine the real noon-anchor instant for the Aug 17 instance by
    // resolving the same wall-clock components the collector itself uses,
    // rather than hardcoding a UTC offset.
    const occursAt = resolveWallClockToInstant(
      { year: 2026, month: 8, day: 17, hour: 12, minute: 0, second: 0 },
      TZ,
    );
    await app.db.insert(occurrences).values({
      parentType: "event",
      parentId: eventId,
      occursAt,
      occursLocal: occursAt,
      status: "skipped",
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const startDates = result.items
      .filter((i) => i.is_recurring_instance)
      .map((i) => i.start_date)
      .sort();
    expect(startDates).toEqual(["2026-08-10", "2026-08-24", "2026-08-31"]);
  });

  it("keeps a timed recurring series byte-identical (null dates, real occurs_at)", async () => {
    await insertTimedRecurringEvent(app, {
      title: "Timed series",
      startsAt: new Date("2026-08-10T09:00:00-05:00"),
      endsAt: new Date("2026-08-10T09:30:00-05:00"),
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const instances = result.items.filter((i) => i.is_recurring_instance);
    expect(instances.length).toBeGreaterThanOrEqual(3);
    for (const instance of instances) {
      expect(instance.all_day).toBe(false);
      expect(instance.start_date).toBeNull();
      expect(instance.end_date).toBeNull();
      expect(instance.starts_at).toBe("2026-08-10T14:00:00.000Z");
      expect(instance.ends_at).toBe("2026-08-10T14:30:00.000Z");
      expect(instance.occurs_at).not.toBeNull();
      expect(instance.occurs_ends_at).not.toBeNull();
      expect(instance.status).toBe("scheduled");
    }

    const occursAts = instances.map((i) => i.occurs_at).sort();
    expect(occursAts).toEqual([
      "2026-08-10T14:00:00.000Z",
      "2026-08-17T14:00:00.000Z",
      "2026-08-24T14:00:00.000Z",
      "2026-08-31T14:00:00.000Z",
    ]);
  });

  it("leaves a one-off all-day event unaffected", async () => {
    await app.db.insert(events).values({
      title: "One-off all-day",
      timezone: TZ,
      allDay: true,
      startDate: "2026-08-15",
      endDate: "2026-08-16",
    });

    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-01T00:00:00.000Z"),
      to: new Date("2026-09-01T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    expect(result.items).toHaveLength(1);
    const item = result.items[0]!;
    expect(item.is_recurring_instance).toBe(false);
    expect(item.all_day).toBe(true);
    expect(item.start_date).toBe("2026-08-15");
    expect(item.end_date).toBe("2026-08-16");
  });

  it("includes an all-day instance that starts before `from` but still spans into the range", async () => {
    await insertAllDayRecurringEvent(app, {
      title: "Front-padding series",
      startDate: "2026-08-10",
      endDate: "2026-08-12", // 3-day span
    });

    // `from` lands in the middle of the Aug 10-12 instance's span, so
    // without the day-span front-padding this instance would be missed
    // entirely by expandRecurrenceInRange's own [from, to] bound.
    const result = await assembleEventRange(app.db, {
      from: new Date("2026-08-11T00:00:00.000Z"),
      to: new Date("2026-08-20T00:00:00.000Z"),
      includeArchived: false,
    });
    expectOk(result);

    const startDates = result.items
      .filter((i) => i.is_recurring_instance)
      .map((i) => i.start_date)
      .sort();
    expect(startDates).toEqual(["2026-08-10", "2026-08-17"]);
  });
});
