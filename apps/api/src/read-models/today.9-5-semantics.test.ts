import { formatInstantWithOffset } from "@personal-os/core/timezone";
import { events, occurrences } from "@personal-os/db";
import type { TodayResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { buildAgendaResponse } from "./agenda.js";
import { buildTodayResponse } from "./today.js";

// Checkpoint 9.5 (Lane E): pins how the Today and Agenda read models place
// EVENTS on local days -- the surface the new event composer feeds. Uses the
// internal `now` seam on buildTodayResponse (deliberately absent from the
// HTTP contract) so each assertion runs at a chosen instant; Agenda takes an
// explicit date range so it needs no clock. Frozen semantics (ADR-038/039/041
// and docs/ARCHITECTURE.md "Today & agenda read models"):
//   rule 3  a local calendar day is [startOfLocalDay(tz), startOfNextLocalDay(tz))
//   rule 4  the requesting client's zone buckets; the row's own zone only formats
//   rule 5  a materialised occurrence IS the item -- never parent + occurrence

const CHI = "America/Chicago";
const AKL = "Pacific/Auckland";

type EventInsert = typeof events.$inferInsert;

async function insertEvent(app: FastifyInstance, values: Partial<EventInsert>): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({ title: "9.5 fixture", timezone: CHI, ...values })
    .returning({ id: events.id });
  return row!.id;
}

async function today(app: FastifyInstance, tz: string, nowIso: string): Promise<TodayResponse> {
  return buildTodayResponse(app.db, { tz }, { now: new Date(nowIso) });
}

function todayEventIds(response: TodayResponse): string[] {
  return response.events_today.items.map((i) => i.id);
}

function upcomingDatesFor(response: TodayResponse, id: string): string[] {
  return response.upcoming.days.filter((d) => d.events.some((e) => e.id === id)).map((d) => d.date);
}

async function agendaEventDays(
  app: FastifyInstance,
  tz: string,
  from: string,
  to: string,
  id: string,
): Promise<string[]> {
  const result = await buildAgendaResponse(app.db, { tz, from, to });
  if (!result.ok) throw new Error("agenda expansion failed");
  return result.response.days
    .filter((d) => d.items.some((i) => i.kind === "event" && i.id === id))
    .map((d) => d.date);
}

describe("Today / Agenda -- 9.5 event placement semantics", () => {
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

  describe("non-recurring shapes on Today, one effectiveNow per day of the span", () => {
    it("single timed event (Mon 09:00 CDT) is in events_today only on Monday, and in upcoming on the days before", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-14T14:00:00Z"),
        endsAt: new Date("2026-09-14T15:00:00Z"),
      });
      const mon = await today(app, CHI, "2026-09-14T12:00:00Z"); // Mon 07:00 CDT
      expect(mon.local_date).toBe("2026-09-14");
      expect(todayEventIds(mon)).toEqual([id]);
      expect(upcomingDatesFor(mon, id)).toEqual([]);

      const sat = await today(app, CHI, "2026-09-12T12:00:00Z");
      expect(todayEventIds(sat)).toEqual([]);
      expect(upcomingDatesFor(sat, id)).toEqual(["2026-09-14"]);

      const tue = await today(app, CHI, "2026-09-15T12:00:00Z");
      expect(todayEventIds(tue)).toEqual([]);
      expect(upcomingDatesFor(tue, id)).toEqual([]);
    });

    it("timed event at 23:30 CDT belongs to that local day, not the UTC day it falls in (rule 3)", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-15T04:30:00Z"), // Mon 09-14 23:30 CDT
        endsAt: new Date("2026-09-15T05:15:00Z"),
      });
      const mon = await today(app, CHI, "2026-09-14T20:00:00Z");
      expect(mon.local_date).toBe("2026-09-14");
      expect(todayEventIds(mon)).toEqual([id]);
      const tue = await today(app, CHI, "2026-09-15T12:00:00Z");
      expect(todayEventIds(tue)).toEqual([]);
    });

    it("multi-day timed event: on its START day it is in events_today; DEBT -- on a day it is merely in progress it is on NO Today day", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-12T23:00:00Z"), // Sat 18:00 CDT
        endsAt: new Date("2026-09-14T14:00:00Z"), // Mon 09:00 CDT
      });
      const sat = await today(app, CHI, "2026-09-12T20:00:00Z");
      expect(todayEventIds(sat)).toEqual([id]);

      // docs/STATUS.md ledger ("A timed multi-day event in progress appears
      // on NO Today day"): classifyEventIntoWindows matches a timed event on
      // its start instant only. Pinned as documented behaviour, not desired.
      const sun = await today(app, CHI, "2026-09-13T17:00:00Z");
      expect(todayEventIds(sun)).toEqual([]);
      expect(upcomingDatesFor(sun, id)).toEqual([]);

      // Agenda, by contrast, places it on every overlapped day.
      expect(await agendaEventDays(app, CHI, "2026-09-11", "2026-09-16", id)).toEqual([
        "2026-09-12",
        "2026-09-13",
        "2026-09-14",
      ]);
    });

    it("one-day all-day event is in events_today on its date from any hour of that local day, and nowhere else", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      for (const nowIso of [
        "2026-09-14T05:00:00Z",
        "2026-09-14T17:00:00Z",
        "2026-09-15T04:59:59Z",
      ]) {
        const r = await today(app, CHI, nowIso);
        expect(r.local_date, nowIso).toBe("2026-09-14");
        expect(todayEventIds(r), nowIso).toEqual([id]);
        const [item] = r.events_today.items;
        expect(item).toMatchObject({
          all_day: true,
          starts_at: null,
          ends_at: null,
          start_date: "2026-09-14",
          end_date: "2026-09-14",
        });
      }
      expect(todayEventIds(await today(app, CHI, "2026-09-15T05:00:00Z"))).toEqual([]);
      expect(todayEventIds(await today(app, CHI, "2026-09-14T04:59:59Z"))).toEqual([]);
      expect(upcomingDatesFor(await today(app, CHI, "2026-09-13T12:00:00Z"), id)).toEqual([
        "2026-09-14",
      ]);
    });

    it("3-day all-day event (09-14..09-16): in events_today on EACH of the three days; Agenda lists it on all three", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-16",
      });
      for (const day of ["2026-09-14", "2026-09-15", "2026-09-16"]) {
        const r = await today(app, CHI, `${day}T17:00:00Z`);
        expect(r.local_date).toBe(day);
        expect(todayEventIds(r), day).toEqual([id]);
        // Today places a multi-day event in ONE bucket (its first matching
        // window), so it never ALSO appears in upcoming while it is today.
        expect(upcomingDatesFor(r, id), day).toEqual([]);
      }
      expect(todayEventIds(await today(app, CHI, "2026-09-17T17:00:00Z"))).toEqual([]);
      // Viewed from the day before, it is listed ONCE in upcoming (first day only).
      expect(upcomingDatesFor(await today(app, CHI, "2026-09-13T17:00:00Z"), id)).toEqual([
        "2026-09-14",
      ]);
      expect(await agendaEventDays(app, CHI, "2026-09-13", "2026-09-17", id)).toEqual([
        "2026-09-14",
        "2026-09-15",
        "2026-09-16",
      ]);
    });

    it("zero-length all-day event (end_date == start_date) shows on exactly one day in Today and in Agenda", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-14",
      });
      const hits: string[] = [];
      for (const day of ["2026-09-12", "2026-09-13", "2026-09-14", "2026-09-15", "2026-09-16"]) {
        if (todayEventIds(await today(app, CHI, `${day}T17:00:00Z`)).includes(id)) hits.push(day);
      }
      expect(hits).toEqual(["2026-09-14"]);
      expect(await agendaEventDays(app, CHI, "2026-09-12", "2026-09-16", id)).toEqual([
        "2026-09-14",
      ]);
    });

    it("an inverted all-day span (end_date < start_date, pre-8.6A data) matches NO day -- pinned so the 8.6A floor stays load-bearing", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-14",
        endDate: "2026-09-13",
      });
      expect(todayEventIds(await today(app, CHI, "2026-09-14T17:00:00Z"))).not.toContain(id);
      expect(todayEventIds(await today(app, CHI, "2026-09-13T17:00:00Z"))).not.toContain(id);
      expect(await agendaEventDays(app, CHI, "2026-09-12", "2026-09-16", id)).toEqual([]);
    });
  });

  describe("rule 4: the REQUESTING zone buckets; the event's own zone never does", () => {
    it("event authored in Chicago (Mon 22:00 CDT = Tue 03:00Z) is Monday's event for a Chicago client and Tuesday's for an Auckland client", async () => {
      const id = await insertEvent(app, {
        timezone: CHI,
        startsAt: new Date("2026-09-15T03:00:00Z"),
        endsAt: new Date("2026-09-15T04:00:00Z"),
      });
      // Chicago client, Monday evening: local day 09-14 is [05:00Z 09-14, 05:00Z 09-15).
      const chi = await today(app, CHI, "2026-09-15T03:30:00Z");
      expect(chi.local_date).toBe("2026-09-14");
      expect(todayEventIds(chi)).toEqual([id]);

      // Auckland client (NZST, +12), Tuesday afternoon: local day 09-15 is
      // [12:00Z 09-14, 12:00Z 09-15) and 03:00Z falls inside it.
      const akl = await today(app, AKL, "2026-09-15T04:00:00Z");
      expect(akl.local_date).toBe("2026-09-15");
      expect(todayEventIds(akl)).toEqual([id]);
      // And the Auckland client on ITS Monday does not see it today.
      const aklMon = await today(app, AKL, "2026-09-14T04:00:00Z");
      expect(aklMon.local_date).toBe("2026-09-14");
      expect(todayEventIds(aklMon)).toEqual([]);
      expect(upcomingDatesFor(aklMon, id)).toEqual(["2026-09-15"]);

      // The stored instant is untouched by either view (display, not bucketing).
      expect(chi.events_today.items[0]!.starts_at).toBe("2026-09-15T03:00:00.000Z");
      expect(akl.events_today.items[0]!.starts_at).toBe("2026-09-15T03:00:00.000Z");
    });

    it("event authored in Auckland (Tue 09:00 NZST = Mon 21:00Z) is Tuesday's for Auckland and Monday's for Chicago", async () => {
      const id = await insertEvent(app, {
        timezone: AKL,
        startsAt: new Date("2026-09-14T21:00:00Z"),
        endsAt: new Date("2026-09-14T22:00:00Z"),
      });
      const akl = await today(app, AKL, "2026-09-14T22:30:00Z"); // Tue 10:30 NZST
      expect(akl.local_date).toBe("2026-09-15");
      expect(todayEventIds(akl)).toEqual([id]);

      const chi = await today(app, CHI, "2026-09-14T22:30:00Z"); // Mon 17:30 CDT
      expect(chi.local_date).toBe("2026-09-14");
      expect(todayEventIds(chi)).toEqual([id]);
      expect(formatInstantWithOffset(new Date(chi.events_today.items[0]!.starts_at!), CHI)).toBe(
        "2026-09-14T16:00:00-05:00",
      );
    });

    it("an all-day event is the same calendar date for every client zone (pure date, rule 3 never applies)", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-15",
        endDate: "2026-09-15",
      });
      // Same instant, two zones on different calendar dates: 2026-09-15T03:00Z
      // is Mon 22:00 in Chicago and Tue 15:00 in Auckland.
      const chi = await today(app, CHI, "2026-09-15T03:00:00Z");
      expect(chi.local_date).toBe("2026-09-14");
      expect(todayEventIds(chi)).toEqual([]);
      expect(upcomingDatesFor(chi, id)).toEqual(["2026-09-15"]);
      const akl = await today(app, AKL, "2026-09-15T03:00:00Z");
      expect(akl.local_date).toBe("2026-09-15");
      expect(todayEventIds(akl)).toEqual([id]);
    });
  });

  describe("recurring events on Today", () => {
    it("09:00 daily Chicago series across spring-forward: today's instance is 14:00Z on 03-08 and every upcoming day, 15:00Z the day before", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-03-06T15:00:00Z"), // 09:00 CST
        endsAt: new Date("2026-03-06T15:30:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      const sat = await today(app, CHI, "2026-03-07T12:00:00Z");
      expect(sat.local_date).toBe("2026-03-07");
      expect(sat.events_today.items.map((i) => [i.id, i.occurs_at])).toEqual([
        [id, "2026-03-07T15:00:00.000Z"],
      ]);
      expect(sat.upcoming.days.map((d) => d.events.map((e) => e.occurs_at)).flat()).toEqual([
        "2026-03-08T14:00:00.000Z",
        "2026-03-09T14:00:00.000Z",
        "2026-03-10T14:00:00.000Z",
        "2026-03-11T14:00:00.000Z",
        "2026-03-12T14:00:00.000Z",
        "2026-03-13T14:00:00.000Z",
        "2026-03-14T14:00:00.000Z",
      ]);
      const sun = await today(app, CHI, "2026-03-08T12:00:00Z");
      expect(sun.events_today.items.map((i) => i.occurs_at)).toEqual(["2026-03-08T14:00:00.000Z"]);
      expect(sun.events_today.items[0]!.rrule).toBe("FREQ=DAILY");
    });

    it("all-day recurring series across fall-back keeps pure dates: every upcoming day carries its own start_date, never a shifted one", async () => {
      const id = await insertEvent(app, {
        allDay: true,
        startDate: "2026-10-28",
        endDate: "2026-10-28",
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      const r = await today(app, CHI, "2026-10-30T17:00:00Z");
      expect(r.local_date).toBe("2026-10-30");
      expect(
        r.events_today.items.map((i) => [i.id, i.start_date, i.end_date, i.starts_at]),
      ).toEqual([[id, "2026-10-30", "2026-10-30", null]]);
      expect(r.upcoming.days.map((d) => [d.date, d.events.map((e) => e.start_date)])).toEqual([
        ["2026-10-31", ["2026-10-31"]],
        ["2026-11-01", ["2026-11-01"]],
        ["2026-11-02", ["2026-11-02"]],
        ["2026-11-03", ["2026-11-03"]],
        ["2026-11-04", ["2026-11-04"]],
        ["2026-11-05", ["2026-11-05"]],
        ["2026-11-06", ["2026-11-06"]],
      ]);
    });

    it("EXDATE: the excluded date's instance is absent from today and from upcoming, neighbours intact", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-07T14:00:00Z"),
        endsAt: new Date("2026-09-07T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceExdates: ["2026-09-15"],
      });
      const mon = await today(app, CHI, "2026-09-14T12:00:00Z");
      expect(todayEventIds(mon)).toEqual([id]);
      expect(mon.upcoming.days.map((d) => [d.date, d.events.length])).toEqual([
        ["2026-09-15", 0],
        ["2026-09-16", 1],
        ["2026-09-17", 1],
        ["2026-09-18", 1],
        ["2026-09-19", 1],
        ["2026-09-20", 1],
        ["2026-09-21", 1],
      ]);
      const tue = await today(app, CHI, "2026-09-15T12:00:00Z");
      expect(todayEventIds(tue)).toEqual([]);
    });

    it("rule 5 dedupe: a recurring event with a materialised `occurrences` row for today renders ONCE, never parent + occurrence", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-07T14:00:00Z"),
        endsAt: new Date("2026-09-07T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      await app.db.insert(occurrences).values({
        parentType: "event",
        parentId: id,
        occursAt: new Date("2026-09-14T14:00:00Z"),
        occursLocal: new Date("2026-09-14T09:00:00Z"),
        status: "scheduled",
      });
      const mon = await today(app, CHI, "2026-09-14T12:00:00Z");
      expect(mon.events_today.items).toHaveLength(1);
      expect(mon.events_today.items[0]).toMatchObject({
        id,
        occurs_at: "2026-09-14T14:00:00.000Z",
        rrule: "FREQ=DAILY",
      });
      // Agenda too: exactly one event item for that day.
      const agenda = await buildAgendaResponse(app.db, {
        tz: CHI,
        from: "2026-09-14",
        to: "2026-09-14",
      });
      if (!agenda.ok) throw new Error("agenda failed");
      expect(agenda.response.days[0]!.items.filter((i) => i.kind === "event")).toHaveLength(1);
    });

    it("rule 5: a skipped occurrence removes today's instance; a done occurrence still renders (documented, latent)", async () => {
      const id = await insertEvent(app, {
        startsAt: new Date("2026-09-07T14:00:00Z"),
        endsAt: new Date("2026-09-07T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
      });
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: id,
          occursAt: new Date("2026-09-14T14:00:00Z"),
          occursLocal: new Date("2026-09-14T09:00:00Z"),
          status: "skipped",
        },
        {
          parentType: "event",
          parentId: id,
          occursAt: new Date("2026-09-15T14:00:00Z"),
          occursLocal: new Date("2026-09-15T09:00:00Z"),
          status: "done",
          completedAt: new Date("2026-09-15T15:00:00Z"),
        },
      ]);
      expect(todayEventIds(await today(app, CHI, "2026-09-14T12:00:00Z"))).toEqual([]);
      // docs/STATUS.md ledger: "A `done` event occurrence still renders on
      // Today and Agenda" -- TodayEventItem carries no status. Pinned.
      expect(todayEventIds(await today(app, CHI, "2026-09-15T12:00:00Z"))).toEqual([id]);
    });

    it("a detached child replaces its parent's instance on that day (the parent's exdate hides the series instance; the child is its own row)", async () => {
      const parent = await insertEvent(app, {
        startsAt: new Date("2026-09-07T14:00:00Z"),
        endsAt: new Date("2026-09-07T15:00:00Z"),
        rrule: "FREQ=DAILY",
        recurrenceTimezone: CHI,
        recurrenceExdates: ["2026-09-14"],
      });
      const child = await insertEvent(app, {
        startsAt: new Date("2026-09-14T20:00:00Z"),
        endsAt: new Date("2026-09-14T21:00:00Z"),
        parentEventId: parent,
        originalStartAt: new Date("2026-09-14T14:00:00Z"),
      });
      const mon = await today(app, CHI, "2026-09-14T12:00:00Z");
      expect(mon.events_today.items.map((i) => [i.id, i.parent_event_id, i.occurs_at])).toEqual([
        [child, parent, null],
      ]);
    });
  });

  describe("Agenda day placement", () => {
    it("timed event crossing local midnight (23:30 -> 00:30 CDT) is on BOTH days; one ending exactly at midnight is on the first day only", async () => {
      const crossing = await insertEvent(app, {
        startsAt: new Date("2026-09-15T04:30:00Z"), // Mon 23:30 CDT
        endsAt: new Date("2026-09-15T05:30:00Z"), // Tue 00:30 CDT
      });
      const flush = await insertEvent(app, {
        startsAt: new Date("2026-09-15T03:00:00Z"), // Mon 22:00 CDT
        endsAt: new Date("2026-09-15T05:00:00Z"), // Tue 00:00 CDT exactly
      });
      expect(await agendaEventDays(app, CHI, "2026-09-13", "2026-09-16", crossing)).toEqual([
        "2026-09-14",
        "2026-09-15",
      ]);
      expect(await agendaEventDays(app, CHI, "2026-09-13", "2026-09-16", flush)).toEqual([
        "2026-09-14",
      ]);
    });

    it("the same crossing event is one Auckland day for an Auckland client (rule 4 on Agenda)", async () => {
      const crossing = await insertEvent(app, {
        startsAt: new Date("2026-09-15T04:30:00Z"), // Tue 16:30 NZST
        endsAt: new Date("2026-09-15T05:30:00Z"), // Tue 17:30 NZST
      });
      expect(await agendaEventDays(app, AKL, "2026-09-13", "2026-09-16", crossing)).toEqual([
        "2026-09-15",
      ]);
    });

    it("all-day items sort before timed items within an Agenda day, and a recurring all-day instance carries its own date", async () => {
      const timed = await insertEvent(app, {
        startsAt: new Date("2026-09-14T13:00:00Z"),
        endsAt: new Date("2026-09-14T14:00:00Z"),
      });
      const recurringAllDay = await insertEvent(app, {
        allDay: true,
        startDate: "2026-09-07",
        endDate: "2026-09-07",
        rrule: "FREQ=WEEKLY;BYDAY=MO",
        recurrenceTimezone: CHI,
      });
      const result = await buildAgendaResponse(app.db, {
        tz: CHI,
        from: "2026-09-14",
        to: "2026-09-14",
      });
      if (!result.ok) throw new Error("agenda failed");
      const items = result.response.days[0]!.items.filter((i) => i.kind === "event");
      expect(items.map((i) => i.id)).toEqual([recurringAllDay, timed]);
      expect(items[0]).toMatchObject({
        all_day: true,
        start_date: "2026-09-14",
        end_date: "2026-09-14",
        starts_at: null,
      });
    });
  });
});
