import { formatInstantWithOffset } from "@personal-os/core/timezone";
import { events, occurrences } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { assembleEventRange, type EventRangeAssembly } from "./event-range.js";

// Checkpoint 9.5 (Lane E): pins the three-source range assembly's date and
// recurrence semantics against a real Postgres, in the exact shapes the new
// event-authoring surface will write (origin 'local' rows through POST
// /events; the DB default 'external' is deliberately NOT overridden here so
// the read model is proven origin-agnostic). Instants are chosen so each
// assertion is only true if the semantic in question actually holds.

const CHI = "America/Chicago";

type EventInsert = typeof events.$inferInsert;

async function insertEvent(app: FastifyInstance, values: Partial<EventInsert>): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({ title: "9.5 fixture", timezone: CHI, ...values })
    .returning({ id: events.id });
  return row!.id;
}

function ok(result: EventRangeAssembly) {
  if (!result.ok) throw new Error(`expansion failed for ${result.eventId} (limit ${result.limit})`);
  return result.items;
}

async function range(app: FastifyInstance, fromIso: string, toIso: string) {
  return ok(
    await assembleEventRange(app.db, {
      from: new Date(fromIso),
      to: new Date(toIso),
      includeArchived: false,
    }),
  );
}

describe("assembleEventRange -- 9.5 event date semantics", () => {
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

  describe("non-recurring shapes", () => {
    it("single timed event: included by half-open instant overlap; excluded when it ends exactly at `from` or starts exactly at `to`", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-14T14:00:00Z"),
        endsAt: new Date("2026-09-14T15:00:00Z"),
      });
      expect(
        (await range(app, "2026-09-14T14:30:00Z", "2026-09-14T14:45:00Z")).map((i) => i.id),
      ).toEqual([id]);
      expect(
        (await range(app, "2026-09-14T15:00:00Z", "2026-09-15T00:00:00Z")).map((i) => i.id),
      ).toEqual([]);
      expect(
        (await range(app, "2026-09-14T00:00:00Z", "2026-09-14T14:00:00Z")).map((i) => i.id),
      ).toEqual([]);
      const [item] = await range(app, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z");
      expect(item).toMatchObject({
        id,
        all_day: false,
        start_date: null,
        end_date: null,
        is_recurring_instance: false,
        occurs_at: null,
        status: null,
      });
    });

    it("multi-day timed event (Sat 18:00 -> Mon 09:00 Chicago) is returned for a range that only touches its middle day", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-12T23:00:00Z"), // Sat 18:00 CDT
        endsAt: new Date("2026-09-14T14:00:00Z"), // Mon 09:00 CDT
      });
      // Sunday 09-13 Chicago = 05:00Z .. 05:00Z next day; the event neither
      // starts nor ends inside it, it simply spans it.
      const items = await range(app, "2026-09-13T05:00:00Z", "2026-09-14T05:00:00Z");
      expect(items.map((i) => i.id)).toEqual([id]);
    });

    it("one-day all-day event is compared as a calendar date, never through an instant", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      // A range whose UTC calendar dates are 09-14..09-14 includes it.
      expect(
        (await range(app, "2026-09-14T00:00:00Z", "2026-09-14T23:59:59Z")).map((i) => i.id),
      ).toEqual([id]);
      // A range whose UTC calendar dates are 09-15..09-15 does not.
      expect(
        (await range(app, "2026-09-15T00:00:00Z", "2026-09-15T23:59:59Z")).map((i) => i.id),
      ).toEqual([]);
      const [item] = await range(app, "2026-09-14T00:00:00Z", "2026-09-14T23:59:59Z");
      expect(item).toMatchObject({
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-09-14",
        end_date: "2026-09-14",
      });
    });

    it("3-day all-day event (09-14..09-16) is returned for a range on each of its days and not the days outside", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-16",
      });
      for (const day of ["2026-09-14", "2026-09-15", "2026-09-16"]) {
        expect(
          (await range(app, `${day}T00:00:00Z`, `${day}T23:59:59Z`)).map((i) => i.id),
          day,
        ).toEqual([id]);
      }
      for (const day of ["2026-09-13", "2026-09-17"]) {
        expect(
          (await range(app, `${day}T00:00:00Z`, `${day}T23:59:59Z`)).map((i) => i.id),
          day,
        ).toEqual([]);
      }
    });

    it("zero-length all-day event (end_date == start_date) is returned on exactly that one day", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      const hits: string[] = [];
      for (const day of ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]) {
        const items = await range(app, `${day}T00:00:00Z`, `${day}T23:59:59Z`);
        if (items.some((i) => i.id === id)) hits.push(day);
      }
      expect(hits).toEqual(["2026-09-14"]);
    });

    it("all-day sorts before timed on the same day; the sort is by start instant/date, not insertion order", async () => {
      const timedLate = await insertEvent(app, {
        startsAt: new Date("2026-09-14T20:00:00Z"),
        endsAt: new Date("2026-09-14T21:00:00Z"),
      });
      const allDay = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      const timedEarly = await insertEvent(app, {
        startsAt: new Date("2026-09-14T13:00:00Z"),
        endsAt: new Date("2026-09-14T14:00:00Z"),
      });
      const items = await range(app, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z");
      expect(items.map((i) => i.id)).toEqual([allDay, timedEarly, timedLate]);
    });
  });

  describe("recurring: wall clock across DST, from the stored row", () => {
    it("09:00 daily Chicago series spanning 2026-03-08: each instance's occurs_at is 09:00 local, offset -06:00 then -05:00", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-03-06T15:00:00Z"), // 09:00 CST
        endsAt: new Date("2026-03-06T15:30:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      const items = await range(app, "2026-03-06T00:00:00Z", "2026-03-11T00:00:00Z");
      expect(items.every((i) => i.id === id && i.is_recurring_instance)).toBe(true);
      expect(items.map((i) => formatInstantWithOffset(new Date(i.occurs_at!), CHI))).toEqual([
        "2026-03-06T09:00:00-06:00",
        "2026-03-07T09:00:00-06:00",
        "2026-03-08T09:00:00-05:00",
        "2026-03-09T09:00:00-05:00",
        "2026-03-10T09:00:00-05:00",
      ]);
      // Duration is preserved per instance (30 min), so occurs_ends_at
      // follows the shifted instant rather than the template's UTC end.
      for (const i of items) {
        expect(Date.parse(i.occurs_ends_at!) - Date.parse(i.occurs_at!)).toBe(30 * 60_000);
      }
      // The template starts_at/ends_at are carried unchanged (they position
      // nothing for an instance; occurs_at does).
      expect(new Set(items.map((i) => i.starts_at))).toEqual(new Set(["2026-03-06T15:00:00.000Z"]));
    });

    it("09:00 daily Chicago series spanning 2026-11-01 fall-back keeps 09:00 local, offset -05:00 then -06:00", async () => {
      await insertEvent(app, {
        startsAt: new Date("2026-10-30T14:00:00Z"), // 09:00 CDT
        endsAt: new Date("2026-10-30T14:30:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      const items = await range(app, "2026-10-30T00:00:00Z", "2026-11-03T00:00:00Z");
      expect(items.map((i) => formatInstantWithOffset(new Date(i.occurs_at!), CHI))).toEqual([
        "2026-10-30T09:00:00-05:00",
        "2026-10-31T09:00:00-05:00",
        "2026-11-01T09:00:00-06:00",
        "2026-11-02T09:00:00-06:00",
      ]);
    });

    it("weekly BYDAY=MO,WE timed series in Europe/London across 03-29: instances are Mon/Wed at 09:00 London", async () => {
      const LON = "Europe/London";
      await insertEvent(app, {
        timezone: LON,
        startsAt: new Date("2026-03-23T09:00:00Z"), // Mon 09:00 GMT
        endsAt: new Date("2026-03-23T10:00:00Z"),
        rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
        recurrenceTimezone: LON,
      });
      const items = await range(app, "2026-03-22T00:00:00Z", "2026-04-05T00:00:00Z");
      expect(items.map((i) => formatInstantWithOffset(new Date(i.occurs_at!), LON))).toEqual([
        "2026-03-23T09:00:00+00:00",
        "2026-03-25T09:00:00+00:00",
        "2026-03-30T09:00:00+01:00",
        "2026-04-01T09:00:00+01:00",
      ]);
    });

    it("monthly BYMONTHDAY=-1 all-day series carries pure dates Feb 28 / Mar 31 / Apr 30 / May 31 as start_date == end_date", async () => {
      await insertEvent(app, {
        allDay: true,
        startDate: "2026-01-31",
        endDate: "2026-01-31",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
        recurrenceTimezone: "Pacific/Auckland",
        timezone: "Pacific/Auckland",
      });
      const items = await range(app, "2026-02-01T00:00:00Z", "2026-06-01T00:00:00Z");
      expect(items.map((i) => [i.start_date, i.end_date])).toEqual([
        ["2026-02-28", "2026-02-28"],
        ["2026-03-31", "2026-03-31"],
        ["2026-04-30", "2026-04-30"],
        ["2026-05-31", "2026-05-31"],
      ]);
      for (const i of items) {
        expect(i.all_day).toBe(true);
        expect(i.starts_at).toBeNull();
        expect(i.ends_at).toBeNull();
        expect(i.occurs_ends_at).toBeNull();
      }
    });

    it("all-day weekly series in America/Santiago yields the nonexistent-midnight date 2026-09-06 as a pure date", async () => {
      const SCL = "America/Santiago";
      await insertEvent(app, {
        timezone: SCL,
        allDay: true,
        startDate: "2026-08-30",
        endDate: "2026-08-30",
        rrule: "FREQ=WEEKLY;BYDAY=SU",
        recurrenceTimezone: SCL,
      });
      const items = await range(app, "2026-09-01T00:00:00Z", "2026-09-15T00:00:00Z");
      expect(items.map((i) => i.start_date)).toEqual(["2026-09-06", "2026-09-13"]);
    });

    it("3-day all-day weekly series: every instance keeps its 3-day span and a range touching only day 3 of an instance still returns it", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-07",
        endDate: "2026-09-09",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceTimezone: CHI,
      });
      const items = await range(app, "2026-09-16T00:00:00Z", "2026-09-16T23:59:59Z");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({ id, start_date: "2026-09-14", end_date: "2026-09-16" });
    });
  });

  describe("EXDATE", () => {
    it("timed: recurrence_exdates removes exactly that instance across the DST day and nothing else", async () => {
      await insertEvent(app, {
        startsAt: new Date("2026-03-06T15:00:00Z"),
        endsAt: new Date("2026-03-06T15:30:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceExdates: ["2026-03-08"],
      });
      const items = await range(app, "2026-03-06T00:00:00Z", "2026-03-11T00:00:00Z");
      expect(items.map((i) => i.occurs_at)).toEqual([
        "2026-03-06T15:00:00.000Z",
        "2026-03-07T15:00:00.000Z",
        "2026-03-09T14:00:00.000Z",
        "2026-03-10T14:00:00.000Z",
      ]);
    });

    it("all-day: recurrence_exdates removes exactly that date and nothing else", async () => {
      await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-07",
        endDate: "2026-09-07",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceTimezone: CHI,
        recurrenceExdates: ["2026-09-14"],
      });
      const items = await range(app, "2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z");
      expect(items.map((i) => i.start_date)).toEqual(["2026-09-07", "2026-09-21", "2026-09-28"]);
    });
  });

  describe("materialised occurrences rows (dedupe / status)", () => {
    it("a scheduled occurrences row for an instance yields ONE item (never parent + occurrence) carrying status 'scheduled'", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-14T14:00:00Z"),
        endsAt: new Date("2026-09-14T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      await app.db.insert(occurrences).values({
        parentType: "event",
        parentId: id,
        occursAt: new Date("2026-09-15T14:00:00Z"),
        occursLocal: new Date("2026-09-15T09:00:00Z"),
        status: "scheduled",
      });
      const items = await range(app, "2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id,
        is_recurring_instance: true,
        occurs_at: "2026-09-15T14:00:00.000Z",
        status: "scheduled",
      });
    });

    it("a skipped occurrences row removes that instance only; a done row is carried as status 'done' (documented: still rendered)", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-14T14:00:00Z"),
        endsAt: new Date("2026-09-14T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: id,
          occursAt: new Date("2026-09-15T14:00:00Z"),
          occursLocal: new Date("2026-09-15T09:00:00Z"),
          status: "skipped",
        },
        {
          parentType: "event",
          parentId: id,
          occursAt: new Date("2026-09-16T14:00:00Z"),
          occursLocal: new Date("2026-09-16T09:00:00Z"),
          status: "done",
          completedAt: new Date("2026-09-16T15:00:00Z"),
        },
      ]);
      const items = await range(app, "2026-09-14T00:00:00Z", "2026-09-18T00:00:00Z");
      expect(items.map((i) => [i.occurs_at, i.status])).toEqual([
        ["2026-09-14T14:00:00.000Z", "scheduled"],
        ["2026-09-16T14:00:00.000Z", "done"],
        ["2026-09-17T14:00:00.000Z", "scheduled"],
      ]);
    });

    it("a detached child (parent_event_id set) is returned as its own timed row, and the parent's instance for that date is removed via the exdate", async () => {
      const parent = await insertEvent(app, {
        startsAt: new Date("2026-09-14T14:00:00Z"),
        endsAt: new Date("2026-09-14T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceExdates: ["2026-09-15"],
      });
      const child = await insertEvent(app, {
        startsAt: new Date("2026-09-15T18:00:00Z"),
        endsAt: new Date("2026-09-15T19:00:00Z"),
        parentEventId: parent,
        originalStartAt: new Date("2026-09-15T14:00:00Z"),
      });
      const items = await range(app, "2026-09-15T00:00:00Z", "2026-09-16T00:00:00Z");
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: child,
        is_recurring_instance: false,
        parent_event_id: parent,
        original_start_at: "2026-09-15T14:00:00.000Z",
      });
    });
  });

  describe("recurrence_until on an all-day series -- pins DOCUMENTED DEBT", () => {
    it("end-of-local-day until keeps the last date; a local-midnight until silently drops it", async () => {
      await insertEvent(app, {
        title: "until 23:59:59.999",
        allDay: true,
        startDate: "2026-09-18",
        endDate: "2026-09-18",
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceUntil: new Date("2026-09-21T04:59:59.999Z"), // 2026-09-20 23:59:59.999 CDT
      });
      const kept = await range(app, "2026-09-17T00:00:00Z", "2026-09-25T00:00:00Z");
      expect(kept.map((i) => i.start_date)).toEqual(["2026-09-18", "2026-09-19", "2026-09-20"]);

      await truncateTestTables(app);
      await insertEvent(app, {
        title: "until midnight",
        allDay: true,
        startDate: "2026-09-18",
        endDate: "2026-09-18",
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceUntil: new Date("2026-09-20T05:00:00.000Z"), // 2026-09-20 00:00 CDT
      });
      const dropped = await range(app, "2026-09-17T00:00:00Z", "2026-09-25T00:00:00Z");
      // DEBT (docs/STATUS.md ledger): the noon-anchored 09-20 instance sorts
      // after a midnight until and is lost. Pinned, not endorsed.
      expect(dropped.map((i) => i.start_date)).toEqual(["2026-09-18", "2026-09-19"]);
    });
  });

  describe("empty-string rrule -- a REAL DEFECT, closed in 9.5 (Lane C)", () => {
    it("POST /events normalises rrule = '' to NULL, so the event is a one-off and appears in the range", async () => {
      // Found by this lane's original pin: a row persisted with rrule = ""
      // was invisible -- `rrule IS NULL` excluded it from the timed source,
      // `rrule IS NOT NULL` admitted it to the recurring source, and
      // buildEventRecurrenceRule returned null for a falsy rrule so the row
      // was skipped. The route now normalises "" (and whitespace) to null
      // BEFORE validation and storage; asserted end to end here through the
      // only writer that accepts client text.
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "blank rrule",
          timezone: CHI,
          starts_at: "2026-09-14T14:00:00Z",
          ends_at: "2026-09-14T15:00:00Z",
          rrule: "",
          recurrence_timezone: CHI,
        },
      });
      expect(response.statusCode).toBe(201);
      const id = response.json<{ id: string; rrule: string | null }>().id;
      expect(response.json<{ rrule: string | null }>().rrule).toBeNull();
      const items = await range(app, "2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z");
      expect(items.map((i) => i.id)).toContain(id);
    });
  });
});
