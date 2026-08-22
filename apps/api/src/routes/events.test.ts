import { wallClockToNaiveDate } from "@personal-os/core";
import {
  calendarConnectionCalendars,
  calendarConnections,
  eventExternalLinks,
  events,
  occurrences,
} from "@personal-os/db";
import type { Event, EventRangeItem, Project } from "@personal-os/schema";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import type { ErrorBody, Paginated } from "../test/types.js";

// Direct DB inserts for recurring/detached-instance fixtures -- POST /events
// rejects rrule/recurrence_*/parent_event_id via EventCreateSchema's
// .strict() (recurrence stays capture(AI)-only), so range-query tests that
// need a recurring series or a detached override go straight through
// app.db, same precedent as apps/worker's expand-due-date-window.test.ts.
async function insertRecurringEvent(
  app: FastifyInstance,
  overrides: Partial<typeof events.$inferInsert>,
): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({
      title: "Recurring fixture",
      timezone: "America/Chicago",
      startsAt: new Date("2026-09-07T09:00:00-05:00"),
      endsAt: new Date("2026-09-07T09:30:00-05:00"),
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrenceTimezone: "America/Chicago",
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

describe("events routes", () => {
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

  it("creates an event", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Team standup",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
        ends_at: "2026-08-21T09:30:00-05:00",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<Event>();
    expect(body.title).toBe("Team standup");
    expect(body.archived_at).toBeNull();
    expect(body.starts_at).toBe("2026-08-21T14:00:00.000Z");
    expect(body.ends_at).toBe("2026-08-21T14:30:00.000Z");
  });

  it("rejects recurrence_anchor on event create/update with 400", async () => {
    const createResp = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Bad event",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
        rrule: "FREQ=WEEKLY",
        recurrence_anchor: "due_date",
      },
    });
    expect(createResp.statusCode).toBe(400);
    expect(createResp.json<ErrorBody>().error).toBe("validation_failed");

    const validCreated = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Good event",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
      },
    });
    const id = validCreated.json<Event>().id;

    const patchResp = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: {
        recurrence_anchor: "due_date",
      },
    });
    expect(patchResp.statusCode).toBe(400);
    expect(patchResp.json<ErrorBody>().error).toBe("validation_failed");
  });

  describe("recurrence on events", () => {
    it("rejects mutual exclusivity of recurrence_until and recurrence_count on events with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Invalid recurrence event",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
          rrule: "FREQ=WEEKLY",
          recurrence_until: "2026-12-31T23:59:59.000Z",
          recurrence_count: 10,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("creates a recurring event and materializes 90-day occurrence window", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Recurring standup",
          timezone: "America/Chicago",
          starts_at: now.toISOString(),
          ends_at: new Date(now.getTime() + 1800000).toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Event>();
      expect(body.rrule).toBe("FREQ=DAILY;INTERVAL=1");
      expect(body.recurrence_timezone).toBe("America/Chicago");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      expect(occs.length).toBeGreaterThanOrEqual(89);
      expect(occs.every((o) => o.parentType === "event" && o.status === "scheduled")).toBe(true);
    });

    it("updates a recurring event, replacing future scheduled occurrences while preserving historical scheduled and skipped", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Recurring event to update",
          timezone: "America/Chicago",
          starts_at: now.toISOString(),
          ends_at: new Date(now.getTime() + 1800000).toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
        },
      });
      const eventId = created.json<Event>().id;

      const pastScheduledInstant = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const pastSkippedInstant = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: eventId,
          occursAt: pastScheduledInstant,
          occursLocal: pastScheduledInstant,
          status: "scheduled",
          lazyGenerated: false,
        },
        {
          parentType: "event",
          parentId: eventId,
          occursAt: pastSkippedInstant,
          occursLocal: pastSkippedInstant,
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${eventId}`,
        payload: {
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
        },
      });
      expect(patchResp.statusCode).toBe(200);

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, eventId));

      // Past scheduled occurrence preserved
      const pastOcc = allOccs.find(
        (o) => o.occursAt.getTime() === pastScheduledInstant.getTime() && o.status === "scheduled",
      );
      expect(pastOcc).toBeDefined();

      // Past skipped occurrence preserved
      const skippedOcc = allOccs.find(
        (o) => o.occursAt.getTime() === pastSkippedInstant.getTime() && o.status === "skipped",
      );
      expect(skippedOcc).toBeDefined();
    });

    it("clears recurrence (rrule: null) on event, deleting all scheduled occurrences while preserving skipped", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Recurring event to clear",
          timezone: "America/Chicago",
          starts_at: now.toISOString(),
          ends_at: new Date(now.getTime() + 1800000).toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
        },
      });
      const eventId = created.json<Event>().id;

      const pastSkippedInstant = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: eventId,
          occursAt: pastSkippedInstant,
          occursLocal: pastSkippedInstant,
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${eventId}`,
        payload: { rrule: null },
      });
      expect(patchResp.statusCode).toBe(200);
      const body = patchResp.json<Event>();
      expect(body.rrule).toBeNull();
      expect(body.recurrence_timezone).toBeNull();

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, eventId));

      // All scheduled rows deleted
      expect(allOccs.filter((o) => o.status === "scheduled")).toHaveLength(0);

      // Skipped row preserved
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    // Checkpoint 5.4: a canonical all-day event has starts_at NULL and
    // start_date set (EventCreateSchema forces this shape), so the creation
    // path's old `body.rrule && startsAt` guard silently skipped window
    // materialization entirely for an all-day recurring event. Confirms the
    // shared buildEventRecurrenceRule-based check now materializes normally,
    // anchored off start_date rather than a starts_at timestamp that must
    // never be written for an all-day row.
    it("materializes a 90-day occurrence window for a canonical all-day recurring event, anchored off start_date", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Weekly all-day retro",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-07",
          end_date: "2026-09-07",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Event>();
      expect(body.all_day).toBe(true);
      expect(body.start_date).toBe("2026-09-07");
      // The hard invariant: never write starts_at for an all-day event, even
      // though it now recurs.
      expect(body.starts_at).toBeNull();
      expect(body.rrule).toBe("FREQ=WEEKLY;INTERVAL=1");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      // The materialization window is 90 days from NOW, not 90 days from the
      // series' own start, so a series starting a couple of weeks out yields
      // fewer than 90/7 instances. The exact per-instance dates are pinned by
      // the range assertion below; this only guards "a real window was
      // materialized at all".
      expect(occs.length).toBeGreaterThanOrEqual(10);
      expect(occs.every((o) => o.parentType === "event" && o.status === "scheduled")).toBe(true);

      // Each materialized occurrence lands on a distinct instant (one per
      // calendar week), confirmed independently via the range read model.
      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-01T00:00:00Z&to=2026-10-06T00:00:00Z",
      });
      const instances = rangeResp
        .json<EventRangeItem[]>()
        .filter((item) => item.title === "Weekly all-day retro");
      expect(instances.map((i) => i.start_date)).toEqual([
        "2026-09-07",
        "2026-09-14",
        "2026-09-21",
        "2026-09-28",
        "2026-10-05",
      ]);
      expect(instances.every((i) => i.is_recurring_instance && i.all_day)).toBe(true);
    });

    it("clears recurrence on a canonical all-day event, deleting scheduled occurrences while preserving skipped, and never backfills starts_at", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "All-day series to clear",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-07",
          end_date: "2026-09-07",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const eventId = created.json<Event>().id;

      const pastSkippedInstant = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "event",
          parentId: eventId,
          occursAt: pastSkippedInstant,
          occursLocal: pastSkippedInstant,
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${eventId}`,
        payload: { rrule: null },
      });
      expect(patchResp.statusCode).toBe(200);
      const body = patchResp.json<Event>();
      expect(body.rrule).toBeNull();
      expect(body.recurrence_timezone).toBeNull();
      expect(body.all_day).toBe(true);
      expect(body.start_date).toBe("2026-09-07");
      expect(body.starts_at).toBeNull();

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, eventId));

      // All scheduled rows deleted
      expect(allOccs.filter((o) => o.status === "scheduled")).toHaveLength(0);

      // Skipped row preserved
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });
  });

  it("rejects an unknown field on update with 400", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Edit target",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
      },
    });
    const id = created.json<Event>().id;

    const response = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: { archived_at: "2026-08-20T00:00:00Z" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("resolves an offset-less starts_at against the supplied timezone", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Chicago afternoon meeting",
        timezone: "America/Chicago",
        starts_at: "2026-08-20T15:00:00",
      },
    });
    expect(response.statusCode).toBe(201);
    // 3pm CDT (UTC-5) -> 20:00 UTC.
    expect(response.json<Event>().starts_at).toBe("2026-08-20T20:00:00.000Z");
  });

  it("creates an all-day event using dates, not timestamps", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Company holiday",
        timezone: "America/Chicago",
        all_day: true,
        start_date: "2026-09-07",
        end_date: "2026-09-07",
      },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<Event>();
    expect(body.all_day).toBe(true);
    expect(body.start_date).toBe("2026-09-07");
    expect(body.end_date).toBe("2026-09-07");
    expect(body.starts_at).toBeNull();
  });

  it("rejects incoherent timed/all-day shapes and invalid intervals", async () => {
    const invalidPayloads = [
      { title: "Missing timed start", timezone: "America/Chicago" },
      {
        title: "Timed with dates",
        timezone: "America/Chicago",
        starts_at: "2026-09-01T09:00:00-05:00",
        start_date: "2026-09-01",
      },
      { title: "All-day without date", timezone: "America/Chicago", all_day: true },
      {
        title: "All-day with timestamp",
        timezone: "America/Chicago",
        all_day: true,
        start_date: "2026-09-01",
        starts_at: "2026-09-01T09:00:00-05:00",
      },
      {
        title: "Reversed all-day",
        timezone: "America/Chicago",
        all_day: true,
        start_date: "2026-09-02",
        end_date: "2026-09-01",
      },
      {
        title: "Reversed timed",
        timezone: "America/Chicago",
        starts_at: "2026-09-01T10:00:00-05:00",
        ends_at: "2026-09-01T09:00:00-05:00",
      },
    ];

    for (const payload of invalidPayloads) {
      const response = await app.inject({ method: "POST", url: "/events", payload });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    }
  });

  it("validates PATCH against the merged event state", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Timed",
        timezone: "America/Chicago",
        starts_at: "2026-09-01T09:00:00-05:00",
        ends_at: "2026-09-01T10:00:00-05:00",
      },
    });
    const id = created.json<Event>().id;

    const partialConversion = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: { all_day: true, start_date: "2026-09-01" },
    });
    expect(partialConversion.statusCode).toBe(400);

    const completeConversion = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: {
        all_day: true,
        starts_at: null,
        ends_at: null,
        start_date: "2026-09-01",
        end_date: "2026-09-02",
      },
    });
    expect(completeConversion.statusCode).toBe(200);
    expect(completeConversion.json<Event>()).toMatchObject({
      all_day: true,
      starts_at: null,
      start_date: "2026-09-01",
    });
  });

  it("lists, filters by project_id, and paginates", async () => {
    const project = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "QA project" },
    });
    const projectId = project.json<Project>().id;

    await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "In project",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
        project_id: projectId,
      },
    });
    await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "No project",
        timezone: "America/Chicago",
        starts_at: "2026-08-22T09:00:00-05:00",
      },
    });

    const scoped = await app.inject({ method: "GET", url: `/events?project_id=${projectId}` });
    expect(scoped.json<Paginated<Event>>().total).toBe(1);

    const all = await app.inject({ method: "GET", url: "/events" });
    expect(all.json<Paginated<Event>>().total).toBe(2);
  });

  it("updates an event, resolving starts_at against its own stored timezone", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Edit me",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
      },
    });
    const id = created.json<Event>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: { location: "Conference room", starts_at: "2026-09-01T09:00:00" },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json<Event>();
    expect(body.location).toBe("Conference room");
    expect(body.starts_at).toBe("2026-09-01T14:00:00.000Z"); // 9am CDT -> 14:00 UTC
  });

  it("rejects clearing starts_at without converting the event to a coherent all-day shape", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Has a time",
        timezone: "America/Chicago",
        starts_at: "2026-08-21T09:00:00-05:00",
      },
    });
    const id = created.json<Event>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/events/${id}`,
      payload: { starts_at: null },
    });
    expect(patched.statusCode).toBe(400);
    expect(patched.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("404s on GET/PATCH/archive for an unknown id", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    for (const req of [
      { method: "GET" as const, url: `/events/${unknownId}` },
      { method: "PATCH" as const, url: `/events/${unknownId}`, payload: { title: "x" } },
      { method: "POST" as const, url: `/events/${unknownId}/archive` },
    ]) {
      const response = await app.inject(req);
      expect(response.statusCode).toBe(404);
    }
  });

  describe("archive", () => {
    it("hides from default list views without deleting anything, but stays reachable directly", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Archive me",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      const id = created.json<Event>().id;

      const archived = await app.inject({ method: "POST", url: `/events/${id}/archive` });
      expect(archived.statusCode).toBe(200);
      expect(archived.json<Event>().archived_at).not.toBeNull();

      const defaultList = await app.inject({ method: "GET", url: "/events" });
      expect(defaultList.json<Paginated<Event>>().total).toBe(0);

      // Regression: an explicit `?include_archived=false` (as the real
      // mobile web client always sends, unlike this test's other cases
      // above which omit the param and rely on its default) must behave
      // identically to omitting it -- z.coerce.boolean() previously ran
      // Boolean("false") === true, silently including the archived row.
      // Found via a real browser in Checkpoint 4.2; see docs/STATUS.md.
      const explicitFalse = await app.inject({
        method: "GET",
        url: "/events?include_archived=false",
      });
      expect(explicitFalse.json<Paginated<Event>>().total).toBe(0);

      const includeArchived = await app.inject({
        method: "GET",
        url: "/events?include_archived=true",
      });
      expect(includeArchived.json<Paginated<Event>>().total).toBe(1);

      const directGet = await app.inject({ method: "GET", url: `/events/${id}` });
      expect(directGet.statusCode).toBe(200);

      const [row] = await app.db.select().from(events).where(eq(events.id, id));
      expect(row).toBeDefined(); // the row itself was never deleted
    });

    it("re-archiving an already-archived event is a no-op, not an error", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Double archive",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      const id = created.json<Event>().id;
      await app.inject({ method: "POST", url: `/events/${id}/archive` });
      const second = await app.inject({ method: "POST", url: `/events/${id}/archive` });
      expect(second.statusCode).toBe(200);
    });
  });

  describe("GET /events/range", () => {
    async function range(from: string, to: string): Promise<EventRangeItem[]> {
      const response = await app.inject({
        method: "GET",
        url: `/events/range?from=${from}&to=${to}`,
      });
      expect(response.statusCode).toBe(200);
      return response.json<EventRangeItem[]>();
    }

    it("rejects reversed, empty, and over-366-day ranges", async () => {
      for (const [from, to] of [
        ["2026-09-02T00:00:00Z", "2026-09-01T00:00:00Z"],
        ["2026-09-01T00:00:00Z", "2026-09-01T00:00:00Z"],
        ["2026-01-01T00:00:00Z", "2027-01-03T00:00:00Z"],
      ]) {
        const response = await app.inject({
          method: "GET",
          url: `/events/range?from=${from}&to=${to}`,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error).toBe("validation_failed");
      }

      const exactMaximum = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-01-01T00:00:00Z&to=2027-01-02T00:00:00Z",
      });
      expect(exactMaximum.statusCode).toBe(200);
    });

    it("fails clearly instead of truncating a pathological high-frequency recurrence", async () => {
      await insertRecurringEvent(app, {
        title: "Pathological seconds",
        rrule: "FREQ=SECONDLY;INTERVAL=1",
        startsAt: new Date("2026-09-01T00:00:00Z"),
        endsAt: new Date("2026-09-01T00:00:01Z"),
        recurrenceTimezone: "UTC",
      });

      const response = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-01T00:00:00Z&to=2026-09-02T00:00:00Z",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "recurrence_expansion_limit_exceeded",
        limit: 10_000,
      });
      expect(response.json()).toHaveProperty("event_id");
    });

    it("charges padded candidates rejected by post-filtering to one cumulative request budget", async () => {
      // Each series returns only the single occurrence at `from`, but the
      // recurrence library examines roughly one padded day of MINUTELY
      // candidates. Seven series therefore exceed the shared 10,000-candidate
      // budget even though a post-filter-only accounting would charge seven.
      for (let index = 0; index < 7; index += 1) {
        await insertRecurringEvent(app, {
          title: `Padded candidates ${index}`,
          rrule: "FREQ=MINUTELY;INTERVAL=1;COUNT=2000",
          startsAt: new Date("2026-09-01T00:00:00Z"),
          endsAt: new Date("2026-09-01T00:00:01Z"),
          recurrenceTimezone: "UTC",
        });
      }

      const response = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-01T00:00:00Z&to=2026-09-01T00:00:01Z",
      });
      expect(response.statusCode).toBe(400);
      expect(response.json()).toMatchObject({
        error: "recurrence_expansion_limit_exceeded",
        limit: 10_000,
      });
    });

    it("includes a one-off timed event whose interval spans either range boundary", async () => {
      // Starts before `from`, ends inside [from, to).
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Spans start boundary",
          timezone: "America/Chicago",
          starts_at: "2026-08-31T23:00:00Z",
          ends_at: "2026-09-01T01:00:00Z",
        },
      });
      // Starts inside [from, to), ends after `to`.
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Spans end boundary",
          timezone: "America/Chicago",
          starts_at: "2026-09-01T23:30:00Z",
          ends_at: "2026-09-02T01:00:00Z",
        },
      });
      // Control: entirely outside the range, must not appear.
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Outside range",
          timezone: "America/Chicago",
          starts_at: "2026-09-10T09:00:00Z",
          ends_at: "2026-09-10T10:00:00Z",
        },
      });

      const items = await range("2026-09-01T00:00:00Z", "2026-09-02T00:00:00Z");
      const titles = items.map((item) => item.title);
      expect(titles).toContain("Spans start boundary");
      expect(titles).toContain("Spans end boundary");
      expect(titles).not.toContain("Outside range");
    });

    it("excludes a one-off event that ends exactly at `from` or starts exactly at `to` (half-open interval)", async () => {
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Ends exactly at from",
          timezone: "America/Chicago",
          starts_at: "2026-09-01T08:00:00Z",
          ends_at: "2026-09-02T00:00:00Z",
        },
      });
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Starts exactly at to",
          timezone: "America/Chicago",
          starts_at: "2026-09-03T00:00:00Z",
          ends_at: "2026-09-03T09:00:00Z",
        },
      });

      const items = await range("2026-09-02T00:00:00Z", "2026-09-03T00:00:00Z");
      expect(items.map((item) => item.title)).toEqual([]);
    });

    it("pads `from` backward by the event's own duration so a recurring occurrence starting before `from` but ending inside [from, to) is included", async () => {
      // Daily, 11pm-2am America/Chicago (CDT, UTC-5 in September). The
      // 2026-09-04 23:00 CDT occurrence starts 2026-09-05T04:00:00Z and ends
      // 2026-09-05T07:00:00Z -- starts before `from`, ends inside the range.
      await insertRecurringEvent(app, {
        title: "Padding proof",
        rrule: "FREQ=DAILY;INTERVAL=1",
        startsAt: new Date("2026-09-01T23:00:00-05:00"),
        endsAt: new Date("2026-09-02T02:00:00-05:00"),
      });

      const items = await range("2026-09-05T05:00:00Z", "2026-09-05T10:00:00Z");
      const padded = items.filter((item) => item.title === "Padding proof");
      expect(padded).toHaveLength(1);
      expect(padded[0]?.is_recurring_instance).toBe(true);
      expect(padded[0]?.occurs_at).toBe("2026-09-05T04:00:00.000Z");
      expect(padded[0]?.occurs_ends_at).toBe("2026-09-05T07:00:00.000Z");
    });

    it("shows a detached instance exactly once, from source #1, with no duplicate from the parent's expansion", async () => {
      const parentId = await insertRecurringEvent(app, {
        title: "Weekly sync (series)",
        recurrenceExdates: ["2026-09-14"],
      });
      // Simulates what the (not-yet-built) detach endpoint will produce: a
      // standalone events row, parent_event_id set, starts_at on the exact
      // date the parent's own recurrence_exdates excludes.
      await app.db.insert(events).values({
        title: "Weekly sync (moved)",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-14T09:00:00-05:00"),
        endsAt: new Date("2026-09-14T09:30:00-05:00"),
        parentEventId: parentId,
      });

      const items = await range("2026-09-14T00:00:00Z", "2026-09-15T00:00:00Z");
      const onThatDate = items.filter((item) => item.title.startsWith("Weekly sync"));
      expect(onThatDate).toHaveLength(1);
      expect(onThatDate[0]?.title).toBe("Weekly sync (moved)");
      expect(onThatDate[0]?.is_recurring_instance).toBe(false);
    });

    it("compares an all-day event by calendar date, with no off-by-one when `from`/`to` aren't UTC-midnight-aligned", async () => {
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Month-boundary holiday",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-08-31",
          end_date: "2026-08-31",
        },
      });
      // Controls just outside the calendar-date bounds below.
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Before range",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-08-29",
          end_date: "2026-08-29",
        },
      });
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "After range",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-02",
          end_date: "2026-09-02",
        },
      });

      // Neither bound lands on a UTC day boundary.
      const items = await range("2026-08-30T23:30:00Z", "2026-09-01T00:30:00Z");
      const titles = items.map((item) => item.title);
      expect(titles).toContain("Month-boundary holiday");
      expect(titles).not.toContain("Before range");
      expect(titles).not.toContain("After range");
    });

    it("keeps wall-clock time fixed and shifts the UTC offset across a DST fall-back", async () => {
      // Same reference rule as packages/core's due-date-window.test.ts, for
      // consistency: 9am on the 15th of every month, America/Chicago.
      await insertRecurringEvent(app, {
        title: "Monthly DST check",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=15",
        startsAt: new Date("2026-01-15T09:00:00-06:00"),
        endsAt: new Date("2026-01-15T09:30:00-06:00"),
      });

      const items = await range("2026-10-01T00:00:00Z", "2026-12-01T00:00:00Z");
      const instances = items.filter((item) => item.title === "Monthly DST check");
      expect(instances).toHaveLength(2);
      expect(instances.map((i) => i.occurs_at)).toEqual([
        "2026-10-15T14:00:00.000Z", // CDT, UTC-5
        "2026-11-15T15:00:00.000Z", // CST, UTC-6
      ]);
    });

    it("returns correct occurrences for a past range with zero pre-generated occurrences rows (the nightly cron never ran)", async () => {
      const eventId = await insertRecurringEvent(app, {
        title: "Never pre-generated",
        rrule: "FREQ=DAILY;INTERVAL=1",
        startsAt: new Date("2020-01-01T09:00:00-06:00"),
        endsAt: new Date("2020-01-01T09:30:00-06:00"),
      });

      const preExisting = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, eventId));
      expect(preExisting).toHaveLength(0);

      const items = await range("2020-06-01T00:00:00Z", "2020-06-03T00:00:00Z");
      const instances = items.filter((item) => item.title === "Never pre-generated");
      expect(instances).toHaveLength(2); // June 1 and June 2, 9am CDT each
      expect(instances[0]?.occurs_at).toBe("2020-06-01T14:00:00.000Z");
      expect(instances[1]?.occurs_at).toBe("2020-06-02T14:00:00.000Z");
    });

    it("returns correct occurrences far beyond any 90-day pre-generation window, for an open-ended rule", async () => {
      await insertRecurringEvent(app, {
        title: "Open-ended far future",
        rrule: "FREQ=DAILY;INTERVAL=1",
        startsAt: new Date("2026-01-01T09:00:00-06:00"),
        endsAt: new Date("2026-01-01T09:30:00-06:00"),
        recurrenceUntil: null,
        recurrenceCount: null,
      });

      // ~14 months past dtstart -- far beyond the 90-day window the nightly
      // cron would ever pre-generate.
      const items = await range("2027-03-01T00:00:00Z", "2027-03-03T00:00:00Z");
      const instances = items.filter((item) => item.title === "Open-ended far future");
      expect(instances).toHaveLength(2);
    });

    it("excludes an occurrence with a real `skipped` occurrences row, while other occurrences of the same series remain", async () => {
      const eventId = await insertRecurringEvent(app, { title: "Weekly with one skip" });

      // The real occurrence instant for the 2026-09-14 09:00 CDT occurrence
      // of the FREQ=WEEKLY;INTERVAL=1 rule seeded by insertRecurringEvent's
      // default startsAt (2026-09-07T09:00:00-05:00).
      const skippedInstant = new Date("2026-09-14T09:00:00-05:00");
      await app.db.insert(occurrences).values({
        parentType: "event",
        parentId: eventId,
        occursAt: skippedInstant,
        occursLocal: wallClockToNaiveDate({
          year: 2026,
          month: 9,
          day: 14,
          hour: 9,
          minute: 0,
          second: 0,
        }),
        status: "skipped",
      });

      const items = await range("2026-09-01T00:00:00Z", "2026-09-30T00:00:00Z");
      const instances = items.filter((item) => item.title === "Weekly with one skip");
      const occursAtValues = instances.map((i) => i.occurs_at);
      expect(occursAtValues).not.toContain(skippedInstant.toISOString());
      // Sept 7, 21, and 28 remain (Sept 14 is the only one skipped).
      expect(instances.length).toBeGreaterThanOrEqual(3);
      expect(instances.every((i) => i.status === "scheduled")).toBe(true);
    });

    it("orders the merged result by effective start time ascending", async () => {
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Second",
          timezone: "America/Chicago",
          starts_at: "2026-09-01T12:00:00Z",
          ends_at: "2026-09-01T13:00:00Z",
        },
      });
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "First",
          timezone: "America/Chicago",
          starts_at: "2026-09-01T08:00:00Z",
          ends_at: "2026-09-01T09:00:00Z",
        },
      });
      await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Third",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-02",
          end_date: "2026-09-02",
        },
      });

      const items = await range("2026-09-01T00:00:00Z", "2026-09-03T00:00:00Z");
      expect(items.map((item) => item.title)).toEqual(["First", "Second", "Third"]);
    });
  });

  describe("detach and cancel-occurrence", () => {
    it("detaches a timed event occurrence, creating a detached event and adding exdate to parent", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Weekly Standup",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          ends_at: "2026-09-07T09:30:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();
      const occurrenceInstant = "2026-09-14T14:00:00.000Z";

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: {
          original_start_at: occurrenceInstant,
          title: "Moved Standup",
          starts_at: "2026-09-14T10:00:00-05:00",
          ends_at: "2026-09-14T10:30:00-05:00",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      const detached = detachResp.json<Event>();
      expect(detached.parent_event_id).toBe(parent.id);
      expect(detached.original_start_at).toBe(occurrenceInstant);
      expect(detached.title).toBe("Moved Standup");
      expect(detached.starts_at).toBe("2026-09-14T15:00:00.000Z");
      expect(detached.ends_at).toBe("2026-09-14T15:30:00.000Z");
      expect(detached.rrule).toBeNull();

      // Verify parent has exdate
      const parentGet = await app.inject({ method: "GET", url: `/events/${parent.id}` });
      expect(parentGet.json<Event>().recurrence_exdates).toEqual(["2026-09-14"]);

      // Verify range query shows detached replacement and excludes original slot
      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      expect(rangeResp.statusCode).toBe(200);
      const items = rangeResp.json<EventRangeItem[]>();
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        id: detached.id,
        title: "Moved Standup",
        is_recurring_instance: false,
        starts_at: "2026-09-14T15:00:00.000Z",
        parent_event_id: parent.id,
        original_start_at: occurrenceInstant,
      });
    });

    it("detaches a dynamic occurrence far in future beyond 90-day window", async () => {
      const parentId = await insertRecurringEvent(app, {
        title: "Open-ended far future series",
        startsAt: new Date("2026-01-05T09:00:00-06:00"),
        endsAt: new Date("2026-01-05T09:30:00-06:00"),
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
      });

      // 2027-03-08 is Monday (14 months out, CST, UTC-6 -> 15:00:00Z)
      const occurrenceInstant = "2027-03-08T15:00:00.000Z";

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parentId}/detach`,
        payload: {
          original_start_at: occurrenceInstant,
          title: "Far Future Exception",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      const detached = detachResp.json<Event>();
      expect(detached.parent_event_id).toBe(parentId);
      expect(detached.title).toBe("Far Future Exception");
      expect(detached.starts_at).toBe(occurrenceInstant);

      const parentGet = await app.inject({ method: "GET", url: `/events/${parentId}` });
      expect(parentGet.json<Event>().recurrence_exdates).toEqual(["2027-03-08"]);

      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2027-03-08T00:00:00Z&to=2027-03-09T00:00:00Z",
      });
      const items = rangeResp.json<EventRangeItem[]>();
      expect(items).toHaveLength(1);
      expect(items[0]?.title).toBe("Far Future Exception");
      expect(items[0]?.is_recurring_instance).toBe(false);
    });

    it("detaches an occurrence into an all-day event", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Regular Meeting",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          ends_at: "2026-09-07T09:30:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();
      const occurrenceInstant = "2026-09-14T14:00:00.000Z";

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: {
          original_start_at: occurrenceInstant,
          title: "All Day Hackathon",
          all_day: true,
          start_date: "2026-09-14",
          end_date: "2026-09-14",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      const detached = detachResp.json<Event>();
      expect(detached.all_day).toBe(true);
      expect(detached.start_date).toBe("2026-09-14");
      expect(detached.end_date).toBe("2026-09-14");
      expect(detached.starts_at).toBeNull();
      expect(detached.parent_event_id).toBe(parent.id);

      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      const items = rangeResp.json<EventRangeItem[]>();
      expect(items).toHaveLength(1);
      expect(items[0]?.all_day).toBe(true);
      expect(items[0]?.title).toBe("All Day Hackathon");
    });

    it("cancels a timed occurrence so it disappears from range and cannot be resurrected", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Recurring to Cancel",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          ends_at: "2026-09-07T09:30:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();
      const occurrenceInstant = "2026-09-14T14:00:00.000Z";

      // Verify occurrence row exists before cancel
      const occsBefore = await app.db
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentId, parent.id),
            eq(occurrences.occursAt, new Date(occurrenceInstant)),
          ),
        );
      expect(occsBefore).toHaveLength(1);

      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: occurrenceInstant },
      });
      expect(cancelResp.statusCode).toBe(200);
      const updatedParent = cancelResp.json<Event>();
      expect(updatedParent.recurrence_exdates).toEqual(["2026-09-14"]);

      // Materialized occurrence row deleted
      const occsAfter = await app.db
        .select()
        .from(occurrences)
        .where(
          and(
            eq(occurrences.parentId, parent.id),
            eq(occurrences.occursAt, new Date(occurrenceInstant)),
          ),
        );
      expect(occsAfter).toHaveLength(0);

      // Disappears from range query
      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      expect(rangeResp.json<EventRangeItem[]>()).toHaveLength(0);
    });

    it("cancels an occurrence and preserves other occurrences", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Daily sync",
          timezone: "America/Chicago",
          starts_at: "2026-09-01T09:00:00-05:00",
          ends_at: "2026-09-01T09:30:00-05:00",
          rrule: "FREQ=DAILY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();
      // Cancel Sept 2 occurrence (2026-09-02T14:00:00.000Z)
      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-02T14:00:00.000Z" },
      });
      expect(cancelResp.statusCode).toBe(200);
      expect(cancelResp.json<Event>().recurrence_exdates).toEqual(["2026-09-02"]);

      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-01T00:00:00Z&to=2026-09-04T00:00:00Z",
      });
      const items = rangeResp.json<EventRangeItem[]>();
      const dates = items.map((i) => i.occurs_at);
      expect(dates).toContain("2026-09-01T14:00:00.000Z");
      expect(dates).not.toContain("2026-09-02T14:00:00.000Z");
      expect(dates).toContain("2026-09-03T14:00:00.000Z");
    });

    it("handles idempotency: duplicate detach returns 200 with same event; duplicate cancel returns 200 with parent", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Idempotency series",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          ends_at: "2026-09-07T09:30:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      // Detach Sept 14
      const detach1 = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z", title: "Detached Title" },
      });
      expect(detach1.statusCode).toBe(201);
      const detachedId = detach1.json<Event>().id;

      const detach2 = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z", title: "Another Title" },
      });
      expect(detach2.statusCode).toBe(200);
      expect(detach2.json<Event>().id).toBe(detachedId);

      // Cancel Sept 21
      const cancel1 = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-21T14:00:00.000Z" },
      });
      expect(cancel1.statusCode).toBe(200);
      expect(cancel1.json<Event>().recurrence_exdates).toEqual(["2026-09-14", "2026-09-21"]);

      const cancel2 = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-21T14:00:00.000Z" },
      });
      expect(cancel2.statusCode).toBe(200);
      expect(cancel2.json<Event>().recurrence_exdates).toEqual(["2026-09-14", "2026-09-21"]);
    });

    it("allows detaching a slot that was previously canceled", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Cancel then Detach",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      // Cancel first
      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      expect(cancelResp.statusCode).toBe(200);

      // Detach now
      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: {
          original_start_at: "2026-09-14T14:00:00.000Z",
          title: "Resurrected as Detached",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      expect(detachResp.json<Event>().title).toBe("Resurrected as Detached");

      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      expect(rangeResp.json<EventRangeItem[]>()).toHaveLength(1);
      expect(rangeResp.json<EventRangeItem[]>()[0]?.title).toBe("Resurrected as Detached");
    });

    it("rejects cancel on an already detached occurrence with 409", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Detach then Cancel",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      expect(detachResp.statusCode).toBe(201);

      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      expect(cancelResp.statusCode).toBe(409);
      expect(cancelResp.json<ErrorBody>().error).toBe("already_detached");
    });

    it("preserves detached event and exdate when editing parent series", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Series Original Title",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          ends_at: "2026-09-07T09:30:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: {
          original_start_at: "2026-09-14T14:00:00.000Z",
          title: "Custom Standup",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      const detachedId = detachResp.json<Event>().id;

      // Edit parent series title
      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${parent.id}`,
        payload: { title: "Series Updated Title" },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(patchResp.json<Event>().recurrence_exdates).toEqual(["2026-09-14"]);

      // Verify detached event is unchanged
      const detachedGet = await app.inject({ method: "GET", url: `/events/${detachedId}` });
      expect(detachedGet.json<Event>().title).toBe("Custom Standup");

      // Verify range query
      const rangeResp = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-07T00:00:00Z&to=2026-09-22T00:00:00Z",
      });
      const items = rangeResp.json<EventRangeItem[]>();
      const custom = items.find((i) => i.title === "Custom Standup");
      expect(custom).toBeDefined();
      expect(custom?.is_recurring_instance).toBe(false);

      const seriesInstances = items.filter((i) => i.title === "Series Updated Title");
      expect(seriesInstances.length).toBeGreaterThanOrEqual(2);
    });

    it("cascades archive to detached children when archiving parent, but not vice-versa", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Parent with Child",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      const child = detachResp.json<Event>();

      // Archive parent
      const archiveParent = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/archive`,
      });
      expect(archiveParent.statusCode).toBe(200);

      // Verify child is also archived
      const childGet = await app.inject({ method: "GET", url: `/events/${child.id}` });
      expect(childGet.json<Event>().archived_at).not.toBeNull();

      // Test archiving child only
      const parent2Resp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Parent 2",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent2 = parent2Resp.json<Event>();
      const detach2 = await app.inject({
        method: "POST",
        url: `/events/${parent2.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      const child2 = detach2.json<Event>();

      // Archive child only
      const archiveChild = await app.inject({
        method: "POST",
        url: `/events/${child2.id}/archive`,
      });
      expect(archiveChild.statusCode).toBe(200);
      expect(archiveChild.json<Event>().archived_at).not.toBeNull();

      const parent2Get = await app.inject({ method: "GET", url: `/events/${parent2.id}` });
      expect(parent2Get.json<Event>().archived_at).toBeNull();
    });

    it("rejects PATCH setting rrule on detached event with 400", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Series",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      const child = detachResp.json<Event>();

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${child.id}`,
        payload: { rrule: "FREQ=DAILY;INTERVAL=1" },
      });
      expect(patchResp.statusCode).toBe(400);
      expect(patchResp.json<ErrorBody>().error).toBe("validation_failed");
      expect(
        patchResp.json<{ error: string; issues: { message: string }[] }>().issues[0]?.message,
      ).toBe("detached event exceptions cannot have recurrence rules");
    });

    it("validates errors: invalid original_start_at -> 400, detach/cancel on non-recurring -> 409, unknown event -> 404", async () => {
      const nonRecurring = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Non-recurring",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
        },
      });
      const nonRecId = nonRecurring.json<Event>().id;

      // Detach on non-recurring -> 409
      const detachNonRec = await app.inject({
        method: "POST",
        url: `/events/${nonRecId}/detach`,
        payload: { original_start_at: "2026-09-07T14:00:00.000Z" },
      });
      expect(detachNonRec.statusCode).toBe(409);
      expect(detachNonRec.json<ErrorBody>().error).toBe("not_recurring");

      // Cancel on non-recurring -> 409
      const cancelNonRec = await app.inject({
        method: "POST",
        url: `/events/${nonRecId}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-07T14:00:00.000Z" },
      });
      expect(cancelNonRec.statusCode).toBe(409);
      expect(cancelNonRec.json<ErrorBody>().error).toBe("not_recurring");

      // Invalid original_start_at on recurring event -> 400
      const recurring = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Weekly series",
          timezone: "America/Chicago",
          starts_at: "2026-09-07T09:00:00-05:00",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const recId = recurring.json<Event>().id;

      const detachInvalidTime = await app.inject({
        method: "POST",
        url: `/events/${recId}/detach`,
        payload: { original_start_at: "2026-09-08T14:00:00.000Z" }, // Tuesday instead of Monday
      });
      expect(detachInvalidTime.statusCode).toBe(400);
      expect(detachInvalidTime.json<ErrorBody>().error).toBe("validation_failed");

      const cancelInvalidTime = await app.inject({
        method: "POST",
        url: `/events/${recId}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-08T14:00:00.000Z" },
      });
      expect(cancelInvalidTime.statusCode).toBe(400);
      expect(cancelInvalidTime.json<ErrorBody>().error).toBe("validation_failed");

      // Unknown ID -> 404
      const unknownId = "00000000-0000-0000-0000-000000000000";
      const detachUnknown = await app.inject({
        method: "POST",
        url: `/events/${unknownId}/detach`,
        payload: { original_start_at: "2026-09-07T14:00:00.000Z" },
      });
      expect(detachUnknown.statusCode).toBe(404);

      const cancelUnknown = await app.inject({
        method: "POST",
        url: `/events/${unknownId}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-07T14:00:00.000Z" },
      });
      expect(cancelUnknown.statusCode).toBe(404);
    });

    // Checkpoint 5.4: a canonical all-day event (starts_at NULL, start_date
    // set) recurs via a noon-anchored dtstart derived from start_date, built
    // by the shared buildEventRecurrenceRule helper -- previously
    // isValidOccurrence's `!parent.startsAt` guard rejected every detach/
    // cancel attempt against such a series outright. These confirm that gate
    // is gone and both endpoints now work symmetrically for all-day series.
    it("detaches an occurrence of an all-day recurring parent, using the occurs_at instant GET /events/range reports", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "All-Day Weekly Series",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-07",
          end_date: "2026-09-07",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      expect(parentResp.statusCode).toBe(201);
      const parent = parentResp.json<Event>();
      expect(parent.starts_at).toBeNull();

      // Find the real occurs_at instant for the 2026-09-14 (second) instance
      // via the same read contract a client would use -- never hand-derived.
      const rangeBefore = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-10T00:00:00Z&to=2026-09-20T00:00:00Z",
      });
      const secondInstance = rangeBefore
        .json<EventRangeItem[]>()
        .find((item) => item.title === "All-Day Weekly Series" && item.start_date === "2026-09-14");
      expect(secondInstance).toBeDefined();
      const occurrenceInstant = secondInstance!.occurs_at!;

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: {
          original_start_at: occurrenceInstant,
          title: "Detached All-Day Instance",
          all_day: true,
          start_date: "2026-09-14",
          end_date: "2026-09-14",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      const detached = detachResp.json<Event>();
      expect(detached.all_day).toBe(true);
      expect(detached.starts_at).toBeNull();
      expect(detached.start_date).toBe("2026-09-14");
      expect(detached.parent_event_id).toBe(parent.id);
      expect(detached.original_start_at).toBe(occurrenceInstant);

      // Parent gained the correct exdate calendar date for that instance.
      const parentGet = await app.inject({ method: "GET", url: `/events/${parent.id}` });
      expect(parentGet.json<Event>().recurrence_exdates).toEqual(["2026-09-14"]);

      // The detached child appears exactly once for that date -- no
      // duplicate from the parent's own recurring expansion.
      const rangeAfter = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      const onThatDate = rangeAfter.json<EventRangeItem[]>();
      expect(onThatDate).toHaveLength(1);
      expect(onThatDate[0]?.id).toBe(detached.id);
      expect(onThatDate[0]?.is_recurring_instance).toBe(false);
    });

    it("cancels an occurrence of an all-day recurring parent, using the occurs_at instant GET /events/range reports", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "All-Day Weekly To Cancel",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-07",
          end_date: "2026-09-07",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      const rangeBefore = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-10T00:00:00Z&to=2026-09-20T00:00:00Z",
      });
      const thirdWeekCandidate = rangeBefore
        .json<EventRangeItem[]>()
        .find(
          (item) => item.title === "All-Day Weekly To Cancel" && item.start_date === "2026-09-14",
        );
      expect(thirdWeekCandidate).toBeDefined();
      const occurrenceInstant = thirdWeekCandidate!.occurs_at!;

      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: occurrenceInstant },
      });
      expect(cancelResp.statusCode).toBe(200);
      expect(cancelResp.json<Event>().recurrence_exdates).toEqual(["2026-09-14"]);

      // The cancelled slot no longer appears in range at all.
      const rangeAfter = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-14T00:00:00Z&to=2026-09-15T00:00:00Z",
      });
      expect(rangeAfter.json<EventRangeItem[]>()).toHaveLength(0);

      // Neighboring instances of the same series are untouched.
      const rangeWider = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-07T00:00:00Z&to=2026-09-08T00:00:00Z",
      });
      const firstInstance = rangeWider
        .json<EventRangeItem[]>()
        .find((item) => item.title === "All-Day Weekly To Cancel");
      expect(firstInstance).toBeDefined();
      expect(firstInstance?.status).toBe("scheduled");
    });

    // Regression (Checkpoint 5.4 audit finding D4-4): recurrence_timezone and
    // timezone are independently settable. The occurrence instant is GENERATED
    // in the recurrence timezone, so the detached child's calendar date must be
    // derived there too. Deriving it in the event's display timezone put the
    // child a full day off from the EXDATE recorded against its own parent.
    it("derives a detached all-day child's date in the recurrence timezone, not the display timezone", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Divergent-zone all-day series",
          timezone: "America/Los_Angeles",
          recurrence_timezone: "Pacific/Kiritimati",
          all_day: true,
          start_date: "2026-09-01",
          end_date: "2026-09-01",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      expect(created.statusCode).toBe(201);
      const parentId = created.json<Event>().id;

      const range = await app.inject({
        method: "GET",
        url: "/events/range?from=2026-09-05T00:00:00Z&to=2026-09-12T00:00:00Z",
      });
      const instance = range
        .json<EventRangeItem[]>()
        .find((i) => i.id === parentId && i.start_date === "2026-09-08");
      expect(instance).toBeDefined();

      const detached = await app.inject({
        method: "POST",
        url: `/events/${parentId}/detach`,
        // Deliberately omits start_date so the server-side derivation runs.
        payload: { original_start_at: instance!.occurs_at },
      });
      expect(detached.statusCode).toBe(201);
      expect(detached.json<Event>().start_date).toBe("2026-09-08");

      const parentAfter = await app.inject({ method: "GET", url: `/events/${parentId}` });
      expect(parentAfter.json<Event>().recurrence_exdates).toContain("2026-09-08");
    });

    it("rejects a bogus original_start_at for an all-day recurring parent with 400 validation_failed on both detach and cancel-occurrence", async () => {
      const parentResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "All-Day Weekly Bogus Target",
          timezone: "America/Chicago",
          all_day: true,
          start_date: "2026-09-07",
          rrule: "FREQ=WEEKLY;INTERVAL=1",
        },
      });
      const parent = parentResp.json<Event>();

      // Not a real occurrence instant of this series at all.
      const bogusInstant = "2026-09-08T14:00:00.000Z";

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: bogusInstant },
      });
      expect(detachResp.statusCode).toBe(400);
      const detachBody = detachResp.json<{ error: string; issues: { message: string }[] }>();
      expect(detachBody.error).toBe("validation_failed");
      expect(detachBody.issues[0]?.message).toBe("not a valid occurrence instant for this event");

      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: bogusInstant },
      });
      expect(cancelResp.statusCode).toBe(400);
      const cancelBody = cancelResp.json<{ error: string; issues: { message: string }[] }>();
      expect(cancelBody.error).toBe("validation_failed");
      expect(cancelBody.issues[0]?.message).toBe("not a valid occurrence instant for this event");
    });

    it("still detaches and cancels a timed recurring series' occurrence correctly (unchanged behavior)", async () => {
      const parentId = await insertRecurringEvent(app, {
        title: "Timed series regression check",
        startsAt: new Date("2026-09-07T09:00:00-05:00"),
        endsAt: new Date("2026-09-07T09:30:00-05:00"),
        rrule: "FREQ=WEEKLY;INTERVAL=1",
      });
      const occurrenceInstant = "2026-09-14T14:00:00.000Z";

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parentId}/detach`,
        payload: {
          original_start_at: occurrenceInstant,
          title: "Timed regression detached",
        },
      });
      expect(detachResp.statusCode).toBe(201);
      expect(detachResp.json<Event>().parent_event_id).toBe(parentId);

      const nextOccurrenceInstant = "2026-09-21T14:00:00.000Z";
      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parentId}/cancel-occurrence`,
        payload: { original_start_at: nextOccurrenceInstant },
      });
      expect(cancelResp.statusCode).toBe(200);
      expect(cancelResp.json<Event>().recurrence_exdates).toEqual(
        expect.arrayContaining(["2026-09-14", "2026-09-21"]),
      );
    });
  });

  describe("POST /events/:id/link-google-calendar", () => {
    async function insertActiveConnectionWithSyncEnabledCalendar(): Promise<{
      connectionId: string;
      googleCalendarId: string;
    }> {
      const [connection] = await app.db
        .insert(calendarConnections)
        .values({
          provider: "google",
          googleAccountEmail: "user@example.com",
          googleAccountId: `sub-${Math.random()}`,
          status: "active",
          grantedScope: "https://www.googleapis.com/auth/calendar.events",
        })
        .returning({ id: calendarConnections.id });
      const googleCalendarId = "primary";
      await app.db.insert(calendarConnectionCalendars).values({
        connectionId: connection!.id,
        googleCalendarId,
        summary: "user@example.com",
        syncEnabled: true,
      });
      return { connectionId: connection!.id, googleCalendarId };
    }

    it("creates a pending_push link and enqueues the first push, with no googleEventId yet", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Local-only event",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      expect(createResp.statusCode).toBe(201);
      const event = createResp.json<Event>();

      const linkResp = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });

      expect(linkResp.statusCode).toBe(201);
      expect(linkResp.json()).toMatchObject({
        event_id: event.id,
        connection_id: connectionId,
        google_calendar_id: googleCalendarId,
        sync_status: "pending_push",
      });

      const [row] = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, event.id));
      expect(row?.googleEventId).toBeNull();
      expect(row?.syncStatus).toBe("pending_push");
    });

    it("rejects linking an already-linked event with 409", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Twice-linked",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      expect(createResp.statusCode).toBe(201);
      const event = createResp.json<Event>();

      const first = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      expect(first.statusCode).toBe(201);

      const second = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      expect(second.statusCode).toBe(409);
      expect(second.json<ErrorBody>().error).toBe("already_linked");
    });

    it("rejects linking to a non-sync-enabled calendar or an inactive connection with 400", async () => {
      const { connectionId } = await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Bad target",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      expect(createResp.statusCode).toBe(201);
      const event = createResp.json<Event>();

      const wrongCalendar = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: "not-sync-enabled" },
      });
      expect(wrongCalendar.statusCode).toBe(400);

      const unknownConnection = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: {
          connection_id: "00000000-0000-0000-0000-000000000000",
          google_calendar_id: "primary",
        },
      });
      expect(unknownConnection.statusCode).toBe(400);
    });
  });

  // Checkpoint 4.7 regression coverage: before this fix, only the initial
  // link-calendar call ever enqueued CALENDAR_PUSH_EVENT_QUEUE -- a
  // subsequent edit/detach/cancel/archive of an already-linked event never
  // pushed outbound at all. These tests assert the enqueue itself (via a
  // direct pgboss.job count), not just that the local row looks right --
  // that distinction is exactly what let the original gap slip through.
  describe("outbound push enqueue on mutating an already-linked event", () => {
    async function insertActiveConnectionWithSyncEnabledCalendar(): Promise<{
      connectionId: string;
      googleCalendarId: string;
    }> {
      const [connection] = await app.db
        .insert(calendarConnections)
        .values({
          provider: "google",
          googleAccountEmail: "user@example.com",
          googleAccountId: `sub-${Math.random()}`,
          status: "active",
          grantedScope: "https://www.googleapis.com/auth/calendar.events",
        })
        .returning({ id: calendarConnections.id });
      const googleCalendarId = "primary";
      await app.db.insert(calendarConnectionCalendars).values({
        connectionId: connection!.id,
        googleCalendarId,
        summary: "user@example.com",
        syncEnabled: true,
      });
      return { connectionId: connection!.id, googleCalendarId };
    }

    async function pushJobCount(eventId: string): Promise<number> {
      const result = await app.db.execute<{ count: string }>(
        sql`select count(*)::text as count from pgboss.job where name = ${CALENDAR_PUSH_EVENT_QUEUE} and data->>'eventId' = ${eventId}`,
      );
      return Number(result.rows[0]?.count ?? 0);
    }

    it("enqueues a new push job when PATCHing an already-linked event", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Linked event",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      const event = createResp.json<Event>();

      await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      const countAfterLink = await pushJobCount(event.id);
      expect(countAfterLink).toBe(1);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${event.id}`,
        payload: { title: "Linked event (edited)" },
      });
      expect(patchResp.statusCode).toBe(200);

      const countAfterPatch = await pushJobCount(event.id);
      expect(countAfterPatch).toBeGreaterThan(countAfterLink);
    });

    it("does not enqueue a push job when PATCHing an unlinked event", async () => {
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Never linked",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      const event = createResp.json<Event>();

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/events/${event.id}`,
        payload: { title: "Still never linked" },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(await pushJobCount(event.id)).toBe(0);
    });

    it("does not enqueue a push job when a PATCH fails validation", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Linked, bad patch",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
          ends_at: "2026-08-21T09:30:00-05:00",
        },
      });
      const event = createResp.json<Event>();
      await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      const countAfterLink = await pushJobCount(event.id);

      const badPatch = await app.inject({
        method: "PATCH",
        url: `/events/${event.id}`,
        // ends_at before starts_at -- rejected by the handler's own validation
        payload: { ends_at: "2026-08-21T08:00:00-05:00" },
      });
      expect(badPatch.statusCode).toBe(400);
      expect(await pushJobCount(event.id)).toBe(countAfterLink);
    });

    it("enqueues a push for the parent series when cancelling a linked recurring event's occurrence", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const parentId = await insertRecurringEvent(app, {});
      await app.inject({
        method: "POST",
        url: `/events/${parentId}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      const countAfterLink = await pushJobCount(parentId);

      const cancelResp = await app.inject({
        method: "POST",
        url: `/events/${parentId}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-07T09:00:00-05:00" },
      });
      expect(cancelResp.statusCode).toBe(200);
      expect(await pushJobCount(parentId)).toBeGreaterThan(countAfterLink);
    });

    it("enqueues a push for the parent series when a linked recurring event's occurrence is detached", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const parentId = await insertRecurringEvent(app, {});
      await app.inject({
        method: "POST",
        url: `/events/${parentId}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      const countAfterLink = await pushJobCount(parentId);

      const detachResp = await app.inject({
        method: "POST",
        url: `/events/${parentId}/detach`,
        payload: { original_start_at: "2026-09-07T09:00:00-05:00", title: "Moved instance" },
      });
      expect(detachResp.statusCode).toBe(201);
      expect(await pushJobCount(parentId)).toBeGreaterThan(countAfterLink);
    });

    it("enqueues a push job when archiving an already-linked event", async () => {
      const { connectionId, googleCalendarId } =
        await insertActiveConnectionWithSyncEnabledCalendar();
      const createResp = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Linked, to archive",
          timezone: "America/Chicago",
          starts_at: "2026-08-21T09:00:00-05:00",
        },
      });
      const event = createResp.json<Event>();
      await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-google-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      const countAfterLink = await pushJobCount(event.id);

      const archiveResp = await app.inject({
        method: "POST",
        url: `/events/${event.id}/archive`,
      });
      expect(archiveResp.statusCode).toBe(200);
      expect(await pushJobCount(event.id)).toBeGreaterThan(countAfterLink);
    });
  });
});
