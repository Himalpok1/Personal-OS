import { events, occurrences, type Db } from "@personal-os/db";
import {
  GetCalendarContextInputSchema,
  GetCalendarContextOutputSchema,
  READ_TOOL_CALENDAR_ITEMS_MAX,
  TODAY_CONTEXT_TITLE_MAX_CHARS,
} from "@personal-os/schema";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { AskUnauthorizedError, authorizeAgentRead, type CloudAskGrant } from "../ask/authorize.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { buildCalendarContext } from "./calendar-context.js";
import { mintReadContext, type ReadContext } from "./read-context.js";

// buildCalendarContext (Checkpoint 10.9, ADR-081 §5). Every fixture is dated
// relative to ONE fixed `now` -- 2026-09-14T14:30Z, 09:30 America/Chicago --
// so nothing here depends on the machine's clock. The window under test is
// the local week 2026-09-14 .. 2026-09-20 unless a case says otherwise.

const TZ = "America/Chicago";
const NOW = new Date("2026-09-14T14:30:00Z");
const FROM = "2026-09-14";
const TO = "2026-09-20";
const BELL = String.fromCharCode(7);
const SENTINEL = "SENTINEL-DESC-NEVER";

function fakeRequest(id = "req-calendar"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

describe("buildCalendarContext", () => {
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

  function ctx(tz = TZ, now = NOW): ReadContext {
    const grant = authorizeAgentRead(
      fakeRequest(),
      { id: "agent-1", trustLevel: "read", revokedAt: null },
      true,
    );
    expect(grant).not.toBeNull();
    return mintReadContext(fakeRequest(), app.db, grant!, tz, now);
  }

  const input = (from = FROM, to = TO, tz = TZ) =>
    GetCalendarContextInputSchema.parse({ tz, from, to });

  describe("authorization", () => {
    it("throws AskUnauthorizedError on a structural look-alike grant BEFORE any row is read", async () => {
      const lookAlike: CloudAskGrant = Object.freeze({
        requestId: "req-forged",
        grantedAt: new Date().toISOString(),
      });
      // A db that throws on ANY property access: if the builder touched it
      // before the gate, the error would be this one, not AskUnauthorizedError.
      const untouchable = new Proxy(
        {},
        {
          get(_target, property) {
            throw new Error(`db touched before the grant check: ${String(property)}`);
          },
        },
      ) as Db;
      const forged: ReadContext = Object.freeze({
        db: untouchable,
        effectiveNow: NOW,
        tz: TZ,
        grant: lookAlike,
      });
      await expect(buildCalendarContext(forged, input())).rejects.toBeInstanceOf(
        AskUnauthorizedError,
      );
    });

    it("accepts a grant minted by authorizeAgentRead", async () => {
      const output = await buildCalendarContext(ctx(), input());
      expect(output).toEqual({ tz: TZ, from: FROM, to: TO, items: [], total: 0, truncated: false });
    });
  });

  describe("projection", () => {
    it("never carries an external event's description anywhere in the output", async () => {
      await app.db.insert(events).values({
        title: "Vendor sync",
        location: "HQ lobby",
        timezone: TZ,
        startsAt: new Date("2026-09-15T16:00:00Z"),
        endsAt: new Date("2026-09-15T17:00:00Z"),
        origin: "external",
        description: `passcode ${SENTINEL} 1234`,
      });
      await app.db.insert(events).values({
        title: "Local planning",
        timezone: TZ,
        startsAt: new Date("2026-09-16T16:00:00Z"),
        endsAt: new Date("2026-09-16T17:00:00Z"),
        origin: "local",
        description: `local notes ${SENTINEL}`,
      });

      const output = await buildCalendarContext(ctx(), input());
      const serialized = JSON.stringify(output);
      expect(serialized).not.toContain(SENTINEL);
      expect(serialized).not.toContain("description");
      expect(output.items.map((i) => [i.title, i.origin])).toEqual([
        ["Vendor sync", "external"],
        ["Local planning", "local"],
      ]);
      for (const item of output.items) expect(Object.keys(item)).not.toContain("description");
    });

    it("projects a local timed event, an all-day event and a recurring instance -- the instance's own instants, never the template's", async () => {
      const [timed] = await app.db
        .insert(events)
        .values({
          title: `Dentist${BELL} at   the clinic`,
          location: "Elm St",
          timezone: TZ,
          startsAt: new Date("2026-09-15T16:00:00Z"),
          endsAt: new Date("2026-09-15T17:00:00Z"),
          origin: "local",
        })
        .returning();
      const [allDay] = await app.db
        .insert(events)
        .values({
          title: "Conference",
          timezone: TZ,
          allDay: true,
          startDate: "2026-09-17",
          endDate: "2026-09-18",
          origin: "external",
        })
        .returning();
      // Weekly lecture whose SERIES template starts a week before the window:
      // the instance inside the window must report 2026-09-16, not 09-09.
      const [series] = await app.db
        .insert(events)
        .values({
          title: "Weekly lecture",
          timezone: TZ,
          rrule: "FREQ=WEEKLY",
          recurrenceTimezone: TZ,
          startsAt: new Date("2026-09-09T18:00:00Z"), // 13:00 CDT, a Wednesday
          endsAt: new Date("2026-09-09T19:30:00Z"),
          origin: "local",
        })
        .returning();

      const output = await buildCalendarContext(ctx(), input());
      expect(GetCalendarContextOutputSchema.parse(output)).toEqual(output);
      expect(output.total).toBe(3);
      expect(output.truncated).toBe(false);

      const byId = new Map(output.items.map((item) => [item.id, item]));
      expect(byId.get(timed!.id)).toEqual({
        id: timed!.id,
        title: "Dentist at the clinic",
        all_day: false,
        starts_at: "2026-09-15T16:00:00.000Z",
        ends_at: "2026-09-15T17:00:00.000Z",
        start_date: null,
        end_date: null,
        location: "Elm St",
        origin: "local",
        is_recurring_instance: false,
        parent_event_id: null,
        status: null,
      });
      expect(byId.get(allDay!.id)).toEqual({
        id: allDay!.id,
        title: "Conference",
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-09-17",
        end_date: "2026-09-18",
        location: null,
        origin: "external",
        is_recurring_instance: false,
        parent_event_id: null,
        status: null,
      });
      expect(byId.get(series!.id)).toEqual({
        id: series!.id,
        title: "Weekly lecture",
        all_day: false,
        starts_at: "2026-09-16T18:00:00.000Z",
        ends_at: "2026-09-16T19:30:00.000Z",
        start_date: null,
        end_date: null,
        location: null,
        origin: "local",
        is_recurring_instance: true,
        parent_event_id: null,
        status: "scheduled",
      });
    });

    it("excludes a skipped occurrence, carries a done one's status, and excludes archived events", async () => {
      const [series] = await app.db
        .insert(events)
        .values({
          title: "Daily standup",
          timezone: TZ,
          rrule: "FREQ=DAILY",
          recurrenceTimezone: TZ,
          startsAt: new Date("2026-09-14T15:00:00Z"),
          endsAt: new Date("2026-09-14T15:15:00Z"),
          origin: "local",
        })
        .returning();
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: series!.id,
          occursAt: new Date("2026-09-15T15:00:00Z"),
          occursLocal: new Date("2026-09-15T15:00:00Z"),
          status: "skipped",
          lazyGenerated: false,
        },
        {
          parentType: "event",
          parentId: series!.id,
          occursAt: new Date("2026-09-16T15:00:00Z"),
          occursLocal: new Date("2026-09-16T15:00:00Z"),
          status: "done",
          lazyGenerated: false,
        },
      ]);
      await app.db.insert(events).values({
        title: "Archived thing",
        timezone: TZ,
        startsAt: new Date("2026-09-15T20:00:00Z"),
        endsAt: new Date("2026-09-15T21:00:00Z"),
        origin: "local",
        archivedAt: new Date("2026-09-13T00:00:00Z"),
      });

      const output = await buildCalendarContext(ctx(), input(FROM, "2026-09-16"));
      expect(output.items.map((i) => [i.title, i.starts_at, i.status])).toEqual([
        ["Daily standup", "2026-09-14T15:00:00.000Z", "scheduled"],
        ["Daily standup", "2026-09-16T15:00:00.000Z", "done"],
      ]);
      expect(output.total).toBe(2);
    });

    it("bounds the window by LOCAL dates in the input zone, not the read context's zone", async () => {
      // 2026-09-13T23:30 CDT = 2026-09-14T04:30Z: inside 09-13 in Chicago,
      // inside 09-14 in UTC. A UTC caller asking for 09-14 must see it; a
      // Chicago caller asking for 09-14 must not.
      await app.db.insert(events).values({
        title: "Late night",
        timezone: TZ,
        startsAt: new Date("2026-09-14T04:30:00Z"),
        endsAt: new Date("2026-09-14T05:00:00Z"),
        origin: "local",
      });
      const chicago = await buildCalendarContext(ctx(), input(FROM, FROM, TZ));
      expect(chicago.items).toEqual([]);
      const utc = await buildCalendarContext(ctx(), input(FROM, FROM, "UTC"));
      expect(utc.items.map((i) => i.title)).toEqual(["Late night"]);
      expect(utc.tz).toBe("UTC");
    });

    it("bounds titles and locations to the TodayContext caps", async () => {
      await app.db.insert(events).values({
        title: "word ".repeat(60).trim(),
        location: "loc ".repeat(40).trim(),
        timezone: TZ,
        startsAt: new Date("2026-09-15T16:00:00Z"),
        endsAt: new Date("2026-09-15T17:00:00Z"),
        origin: "external",
      });
      const output = await buildCalendarContext(ctx(), input());
      expect(output.items[0]!.title.length).toBeLessThanOrEqual(TODAY_CONTEXT_TITLE_MAX_CHARS);
      expect(output.items[0]!.location!.length).toBeLessThanOrEqual(80);
    });
  });

  describe("bounds", () => {
    it("refuses a 15-day span at the input schema", () => {
      expect(() => input("2026-09-01", "2026-09-16")).toThrow();
      expect(() => input("2026-09-16", "2026-09-01")).toThrow();
      expect(input("2026-09-01", "2026-09-15")).toEqual({
        tz: TZ,
        from: "2026-09-01",
        to: "2026-09-15",
      });
    });

    it("caps items at READ_TOOL_CALENDAR_ITEMS_MAX with an honest total and truncated flag", async () => {
      const seeded = READ_TOOL_CALENDAR_ITEMS_MAX + 1;
      await app.db.insert(events).values(
        Array.from({ length: seeded }, (_, i) => ({
          title: `Slot ${String(i).padStart(3, "0")}`,
          timezone: TZ,
          startsAt: new Date(Date.parse("2026-09-15T12:00:00Z") + i * 60_000),
          endsAt: new Date(Date.parse("2026-09-15T12:00:00Z") + i * 60_000 + 30_000),
          origin: "local" as const,
        })),
      );
      const output = await buildCalendarContext(ctx(), input());
      expect(output.items).toHaveLength(READ_TOOL_CALENDAR_ITEMS_MAX);
      expect(output.total).toBe(seeded);
      expect(output.truncated).toBe(true);
      // Earliest-first: the dropped row is the last-starting one.
      expect(output.items[0]!.title).toBe("Slot 000");
      expect(output.items.at(-1)!.title).toBe(`Slot ${String(seeded - 2).padStart(3, "0")}`);
      expect(GetCalendarContextOutputSchema.parse(output)).toEqual(output);
    });
  });
});
