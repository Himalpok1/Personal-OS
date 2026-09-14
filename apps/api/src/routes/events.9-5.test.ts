// Checkpoint 9.5 -- event ownership, idempotent creation, calendar targets
// at creation, rule validation, and durable push intent. Every behaviour
// here is asserted through the real routes against the real test database
// (pg-boss included: enqueues are counted in pgboss.job, the same oracle
// the Checkpoint 4.7 regression tests use).
import {
  calendarConnectionCalendars,
  calendarConnections,
  eventExternalLinks,
  events,
  occurrences,
} from "@personal-os/db";
import type { Event } from "@personal-os/schema";
import { and, asc, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import type { ErrorBody, Paginated } from "../test/types.js";

interface ValidationBody {
  error: string;
  issues: Array<{ path: Array<string | number>; message: string }>;
}

describe("events routes -- Checkpoint 9.5", () => {
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

  async function insertConnection(
    provider: "google" | "caldav",
    status: "active" | "needs_reauth" | "disconnected" = "active",
  ): Promise<string> {
    const [connection] = await app.db
      .insert(calendarConnections)
      .values(
        provider === "google"
          ? {
              provider,
              googleAccountEmail: "user@example.com",
              googleAccountId: `sub-${Math.random()}`,
              status,
              grantedScope: "https://www.googleapis.com/auth/calendar.events",
            }
          : {
              provider,
              serverUrl: "https://caldav.example.com",
              username: "testuser",
              status,
            },
      )
      .returning({ id: calendarConnections.id });
    return connection!.id;
  }

  async function insertGoogleCalendar(
    connectionId: string,
    opts: { googleCalendarId?: string; accessRole?: string | null; syncEnabled?: boolean } = {},
  ): Promise<string> {
    const googleCalendarId = opts.googleCalendarId ?? "primary";
    await app.db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId,
      summary: googleCalendarId,
      syncEnabled: opts.syncEnabled ?? true,
      accessRole: opts.accessRole === undefined ? "owner" : opts.accessRole,
    });
    return googleCalendarId;
  }

  async function insertCaldavCalendar(
    connectionId: string,
    opts: { url?: string; syncEnabled?: boolean } = {},
  ): Promise<string> {
    const url = opts.url ?? "/calendars/users/testuser/personal/";
    await app.db.insert(calendarConnectionCalendars).values({
      connectionId,
      caldavCalendarUrl: url,
      summary: "Personal",
      syncEnabled: opts.syncEnabled ?? true,
      accessRole: null,
    });
    return url;
  }

  async function pushJobCount(eventId: string): Promise<number> {
    const result = await app.db.execute<{ count: string }>(
      sql`select count(*)::text as count from pgboss.job where name = ${CALENDAR_PUSH_EVENT_QUEUE} and data->>'eventId' = ${eventId}`,
    );
    return Number(result.rows[0]?.count ?? 0);
  }

  async function insertEventRow(
    overrides: Partial<typeof events.$inferInsert> = {},
  ): Promise<typeof events.$inferSelect> {
    const [row] = await app.db
      .insert(events)
      .values({
        title: "Fixture",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-07T09:00:00-05:00"),
        endsAt: new Date("2026-09-07T09:30:00-05:00"),
        ...overrides,
      })
      .returning();
    return row!;
  }

  async function createLocalEvent(extra: Record<string, unknown> = {}): Promise<Event> {
    const response = await app.inject({
      method: "POST",
      url: "/events",
      payload: {
        title: "Local event",
        timezone: "America/Chicago",
        starts_at: "2026-09-21T09:00:00-05:00",
        ends_at: "2026-09-21T09:30:00-05:00",
        ...extra,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<Event>();
  }

  async function occurrenceIds(eventId: string): Promise<string[]> {
    const rows = await app.db
      .select({ id: occurrences.id })
      .from(occurrences)
      .where(and(eq(occurrences.parentType, "event"), eq(occurrences.parentId, eventId)))
      .orderBy(asc(occurrences.occursAt));
    return rows.map((row) => row.id);
  }

  describe("origin and sync projection", () => {
    it("POST /events writes origin=local (never the column default) and projects sync=null when unlinked", async () => {
      const created = await createLocalEvent();
      expect(created.origin).toBe("local");
      expect(created.sync).toBeNull();

      const [row] = await app.db.select().from(events).where(eq(events.id, created.id));
      expect(row!.origin).toBe("local");
      expect(row!.clientUuid).toBeNull();
    });

    it("a directly-inserted row defaults to origin=external -- the fail-safe direction", async () => {
      const row = await insertEventRow();
      expect(row.origin).toBe("external");
      const response = await app.inject({ method: "GET", url: `/events/${row.id}` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().origin).toBe("external");
      expect(response.json<Event>().sync).toBeNull();
    });

    it("GET /events carries origin and sync for every item, batching the link lookup", async () => {
      const external = await insertEventRow({ title: "Imported" });
      const local = await createLocalEvent({ title: "Mine" });
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      await app.db.insert(eventExternalLinks).values({
        eventId: local.id,
        connectionId,
        googleCalendarId,
        googleEventId: "remote-1",
        googleEtag: '"etag-1"',
        googleIcalUid: "uid-1@google.com",
        syncStatus: "synced",
      });

      const response = await app.inject({ method: "GET", url: "/events" });
      expect(response.statusCode).toBe(200);
      const items = response.json<Paginated<Event>>().items;
      const byId = new Map(items.map((item) => [item.id, item]));
      expect(byId.get(external.id)?.origin).toBe("external");
      expect(byId.get(external.id)?.sync).toBeNull();
      expect(byId.get(local.id)?.origin).toBe("local");
      expect(byId.get(local.id)?.sync).toEqual({
        status: "synced",
        connection_id: connectionId,
        google_calendar_id: googleCalendarId,
        caldav_calendar_url: null,
        last_error: null,
      });
    });

    it("the sync projection never carries the remote id, ical uid or etag, and sanitizes a stored error to the closed vocabulary", async () => {
      const local = await createLocalEvent();
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      await app.db.insert(eventExternalLinks).values({
        eventId: local.id,
        connectionId,
        googleCalendarId,
        googleEventId: "remote-secret",
        googleEtag: '"etag-secret"',
        googleIcalUid: "uid-secret@google.com",
        syncStatus: "error",
        // Provider prose written before the closed vocabulary existed.
        lastSyncError: "Google said: Forbidden (calendar: remote-secret)",
      });

      const response = await app.inject({ method: "GET", url: `/events/${local.id}` });
      const sync = response.json<Event>().sync;
      expect(sync).not.toBeNull();
      expect(Object.keys(sync!).sort()).toEqual([
        "caldav_calendar_url",
        "connection_id",
        "google_calendar_id",
        "last_error",
        "status",
      ]);
      expect(sync!.status).toBe("error");
      expect(sync!.last_error).toBe("provider_error");
      expect(JSON.stringify(response.json())).not.toContain("secret");
    });
  });

  describe("ownership gate (origin=external is read-only)", () => {
    it("PATCH, archive and link-calendar on an external event return 409 event_not_owned and change nothing", async () => {
      const external = await insertEventRow({ title: "Imported" });
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);

      const patch = await app.inject({
        method: "PATCH",
        url: `/events/${external.id}`,
        payload: { title: "Edited" },
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json<ErrorBody>().error).toBe("event_not_owned");

      const archive = await app.inject({ method: "POST", url: `/events/${external.id}/archive` });
      expect(archive.statusCode).toBe(409);
      expect(archive.json<ErrorBody>().error).toBe("event_not_owned");

      for (const route of ["link-calendar", "link-google-calendar"]) {
        const link = await app.inject({
          method: "POST",
          url: `/events/${external.id}/${route}`,
          payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
        });
        expect(link.statusCode).toBe(409);
        expect(link.json<ErrorBody>().error).toBe("event_not_owned");
      }

      const [row] = await app.db.select().from(events).where(eq(events.id, external.id));
      expect(row!.title).toBe("Imported");
      expect(row!.archivedAt).toBeNull();
      const links = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, external.id));
      expect(links).toHaveLength(0);
      expect(await pushJobCount(external.id)).toBe(0);
    });

    it("detach and cancel-occurrence on an external recurring series return 409 event_not_owned before any other check", async () => {
      const external = await insertEventRow({
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
      });
      const detach = await app.inject({
        method: "POST",
        url: `/events/${external.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      expect(detach.statusCode).toBe(409);
      expect(detach.json<ErrorBody>().error).toBe("event_not_owned");

      const cancel = await app.inject({
        method: "POST",
        url: `/events/${external.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z" },
      });
      expect(cancel.statusCode).toBe(409);
      expect(cancel.json<ErrorBody>().error).toBe("event_not_owned");

      const [row] = await app.db.select().from(events).where(eq(events.id, external.id));
      expect(row!.recurrenceExdates).toBeNull();
    });

    it("a detached child whose PARENT is external is read-only too, even when the child row says local", async () => {
      const parent = await insertEventRow({
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
      });
      const child = await insertEventRow({
        parentEventId: parent.id,
        originalStartAt: new Date("2026-09-14T14:00:00.000Z"),
        startsAt: new Date("2026-09-14T15:00:00.000Z"),
        endsAt: new Date("2026-09-14T15:30:00.000Z"),
        origin: "local",
      });

      const patch = await app.inject({
        method: "PATCH",
        url: `/events/${child.id}`,
        payload: { title: "Moved again" },
      });
      expect(patch.statusCode).toBe(409);
      expect(patch.json<ErrorBody>().error).toBe("event_not_owned");

      const archive = await app.inject({ method: "POST", url: `/events/${child.id}/archive` });
      expect(archive.statusCode).toBe(409);
      expect(archive.json<ErrorBody>().error).toBe("event_not_owned");
    });

    it("a local event is fully editable, and the detach child it spawns is written origin=local", async () => {
      const parent = await insertEventRow({
        rrule: "FREQ=WEEKLY;INTERVAL=1",
        recurrenceTimezone: "America/Chicago",
        origin: "local",
      });
      const detach = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-09-14T14:00:00.000Z", title: "Moved" },
      });
      expect(detach.statusCode).toBe(201);
      const child = detach.json<Event>();
      expect(child.origin).toBe("local");
      expect(child.sync).toBeNull();
      const [childRow] = await app.db.select().from(events).where(eq(events.id, child.id));
      expect(childRow!.origin).toBe("local");

      const patch = await app.inject({
        method: "PATCH",
        url: `/events/${child.id}`,
        payload: { title: "Moved again" },
      });
      expect(patch.statusCode).toBe(200);
      expect(patch.json<Event>().title).toBe("Moved again");
    });
  });

  describe("client_uuid idempotency", () => {
    it("a second POST with the same client_uuid returns 200 with the existing row and creates nothing", async () => {
      const clientUuid = "6f9a7c1e-4c5d-4a9b-9d3e-2b1f0c8e7a55";
      const payload = {
        title: "Retried create",
        timezone: "America/Chicago",
        starts_at: "2026-09-21T09:00:00-05:00",
        ends_at: "2026-09-21T09:30:00-05:00",
        rrule: "FREQ=DAILY",
        client_uuid: clientUuid,
      };
      const first = await app.inject({ method: "POST", url: "/events", payload });
      expect(first.statusCode).toBe(201);
      const created = first.json<Event>();
      const occurrencesAfterFirst = await occurrenceIds(created.id);
      expect(occurrencesAfterFirst.length).toBeGreaterThan(0);

      const second = await app.inject({
        method: "POST",
        url: "/events",
        // A retry may carry a different title (the client re-serialised);
        // the uuid is the identity, not the payload.
        payload: { ...payload, title: "Retried create (again)" },
      });
      expect(second.statusCode).toBe(200);
      const replayed = second.json<Event>();
      expect(replayed.id).toBe(created.id);
      expect(replayed.title).toBe("Retried create");
      expect(replayed.origin).toBe("local");
      expect(replayed.sync).toBeNull();
      // Same body shape as the 201.
      expect(Object.keys(replayed).sort()).toEqual(Object.keys(created).sort());

      const rows = await app.db.select().from(events).where(eq(events.clientUuid, clientUuid));
      expect(rows).toHaveLength(1);
      expect(await occurrenceIds(created.id)).toEqual(occurrencesAfterFirst);
    });

    it("distinct client_uuids create distinct rows, and omitting it never dedupes", async () => {
      const a = await createLocalEvent({ client_uuid: "1f2e3d4c-5b6a-4798-8a9b-0c1d2e3f4a5b" });
      const b = await createLocalEvent({ client_uuid: "9a8b7c6d-5e4f-4321-8765-4321fedcba98" });
      const c = await createLocalEvent();
      const d = await createLocalEvent();
      expect(new Set([a.id, b.id, c.id, d.id]).size).toBe(4);
    });

    it("rejects a non-uuid client_uuid with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Bad key",
          timezone: "America/Chicago",
          starts_at: "2026-09-21T09:00:00-05:00",
          client_uuid: "not-a-uuid",
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });
  });

  describe("POST /events with a calendar target", () => {
    it("links to a writable Google calendar in the same transaction and enqueues exactly one push", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId, { accessRole: "writer" });

      const created = await createLocalEvent({
        calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      expect(created.origin).toBe("local");
      expect(created.sync).toEqual({
        status: "pending_push",
        connection_id: connectionId,
        google_calendar_id: googleCalendarId,
        caldav_calendar_url: null,
        last_error: null,
      });

      const [link] = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, created.id));
      expect(link).toBeDefined();
      expect(link!.syncStatus).toBe("pending_push");
      expect(link!.googleCalendarId).toBe(googleCalendarId);
      expect(link!.googleEventId).toBeNull();
      expect(await pushJobCount(created.id)).toBe(1);

      const fetched = await app.inject({ method: "GET", url: `/events/${created.id}` });
      expect(fetched.json<Event>().sync?.status).toBe("pending_push");
    });

    it("links to a CalDAV calendar with a null access role (CalDAV has no role; the PUT is the check)", async () => {
      const connectionId = await insertConnection("caldav");
      const url = await insertCaldavCalendar(connectionId);

      const created = await createLocalEvent({
        calendar: { connection_id: connectionId, caldav_calendar_url: url },
      });
      expect(created.sync).toEqual({
        status: "pending_push",
        connection_id: connectionId,
        google_calendar_id: null,
        caldav_calendar_url: url,
        last_error: null,
      });
      expect(await pushJobCount(created.id)).toBe(1);
    });

    it.each([
      ["reader", "reader"],
      ["freeBusyReader", "freeBusyReader"],
      ["a NULL (unknown) role", null],
    ])(
      "refuses a Google calendar with %s: 400 calendar_not_writable and no event row",
      async (_label, accessRole) => {
        const connectionId = await insertConnection("google");
        const googleCalendarId = await insertGoogleCalendar(connectionId, { accessRole });

        const response = await app.inject({
          method: "POST",
          url: "/events",
          payload: {
            title: "Not writable",
            timezone: "America/Chicago",
            starts_at: "2026-09-21T09:00:00-05:00",
            calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
          },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json<ValidationBody>();
        expect(body.error).toBe("validation_failed");
        expect(body.issues).toEqual([
          expect.objectContaining({ path: ["calendar"], message: "calendar_not_writable" }),
        ]);
        expect(await app.db.select().from(events)).toHaveLength(0);
        expect(await app.db.select().from(eventExternalLinks)).toHaveLength(0);
      },
    );

    it("refuses a calendar that is not sync-enabled with calendar_not_writable", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId, { syncEnabled: false });
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Disabled calendar",
          timezone: "America/Chicago",
          starts_at: "2026-09-21T09:00:00-05:00",
          calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ValidationBody>().issues[0]?.message).toBe("calendar_not_writable");
      expect(await app.db.select().from(events)).toHaveLength(0);
    });

    it("refuses a calendar on an inactive connection with connection_not_active", async () => {
      const connectionId = await insertConnection("google", "needs_reauth");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: {
          title: "Inactive connection",
          timezone: "America/Chicago",
          starts_at: "2026-09-21T09:00:00-05:00",
          calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ValidationBody>().issues[0]?.message).toBe("connection_not_active");
      expect(await app.db.select().from(events)).toHaveLength(0);
    });

    it("refuses an unknown calendar, an unknown connection, and a selector of the wrong provider kind with calendar_not_found", async () => {
      const googleConnectionId = await insertConnection("google");
      await insertGoogleCalendar(googleConnectionId);
      const caldavConnectionId = await insertConnection("caldav");
      await insertCaldavCalendar(caldavConnectionId);

      const cases = [
        { connection_id: googleConnectionId, google_calendar_id: "nope@group.calendar.google.com" },
        { connection_id: "00000000-0000-0000-0000-000000000000", google_calendar_id: "primary" },
        { connection_id: caldavConnectionId, google_calendar_id: "primary" },
        { connection_id: googleConnectionId, caldav_calendar_url: "/calendars/x/" },
      ];
      for (const calendar of cases) {
        const response = await app.inject({
          method: "POST",
          url: "/events",
          payload: {
            title: "Unknown calendar",
            timezone: "America/Chicago",
            starts_at: "2026-09-21T09:00:00-05:00",
            calendar,
          },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ValidationBody>().issues[0]?.path).toEqual(["calendar"]);
        expect(response.json<ValidationBody>().issues[0]?.message).toBe("calendar_not_found");
      }
      expect(await app.db.select().from(events)).toHaveLength(0);
    });

    it("rejects a calendar selector naming both or neither calendar id with 400", async () => {
      const connectionId = await insertConnection("google");
      for (const calendar of [
        { connection_id: connectionId },
        { connection_id: connectionId, google_calendar_id: "primary", caldav_calendar_url: "/c/" },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/events",
          payload: {
            title: "Bad selector",
            timezone: "America/Chicago",
            starts_at: "2026-09-21T09:00:00-05:00",
            calendar,
          },
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ErrorBody>().error).toBe("validation_failed");
      }
    });

    it("still returns 201 with the link row left pending_push when the job queue is unavailable", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const wasReady = app.bossReady;
      app.bossReady = false;
      try {
        const created = await createLocalEvent({
          calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
        });
        expect(created.sync?.status).toBe("pending_push");
        const [link] = await app.db
          .select()
          .from(eventExternalLinks)
          .where(eq(eventExternalLinks.eventId, created.id));
        expect(link!.syncStatus).toBe("pending_push");
        expect(await pushJobCount(created.id)).toBe(0);
      } finally {
        app.bossReady = wasReady;
      }
    });
  });

  describe("recurrence rule validation", () => {
    const base = {
      title: "Rule under test",
      timezone: "America/Chicago",
      starts_at: "2026-09-21T09:00:00-05:00",
      ends_at: "2026-09-21T09:30:00-05:00",
    };

    it.each([
      ["FREQ=HOURLY", "unsupported_frequency"],
      ["FREQ=MINUTELY;INTERVAL=5", "unsupported_frequency"],
      ["FREQ=SECONDLY", "unsupported_frequency"],
      ["FREQ=WEEKLY;UNTIL=20261231T000000Z", "embedded_until_count"],
      ["FREQ=DAILY;COUNT=3", "embedded_until_count"],
      ["FREQ=WEEKLYY", "invalid_rrule"],
      ["not a rule at all", "invalid_rrule"],
      ["FREQ=DAILY;INTERVAL=0", "invalid_rrule"],
    ])("POST rejects %s with 400 %s, never echoing the rule", async (rrule, token) => {
      const response = await app.inject({
        method: "POST",
        url: "/events",
        payload: { ...base, rrule },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json<ValidationBody>();
      expect(body.error).toBe("validation_failed");
      expect(body.issues).toEqual([expect.objectContaining({ path: ["rrule"], message: token })]);
      expect(response.body).not.toContain(rrule);
      expect(await app.db.select().from(events)).toHaveLength(0);
    });

    it.each(["", "   ", "\t\n"])(
      "POST stores a blank rrule (%j) as NULL so the event stays a visible one-off",
      async (rrule) => {
        const response = await app.inject({
          method: "POST",
          url: "/events",
          payload: { ...base, rrule, recurrence_timezone: "America/Chicago" },
        });
        expect(response.statusCode).toBe(201);
        const created = response.json<Event>();
        expect(created.rrule).toBeNull();
        expect(created.recurrence_timezone).toBeNull();
        const [row] = await app.db.select().from(events).where(eq(events.id, created.id));
        expect(row!.rrule).toBeNull();
        expect(await occurrenceIds(created.id)).toEqual([]);

        const range = await app.inject({
          method: "GET",
          url: "/events/range?from=2026-09-21T00:00:00Z&to=2026-09-22T00:00:00Z",
        });
        expect(range.statusCode).toBe(200);
        expect(range.json<Array<{ id: string }>>().map((item) => item.id)).toContain(created.id);
      },
    );

    it("PATCH with a blank rrule clears recurrence exactly like null", async () => {
      const created = await createLocalEvent({ rrule: "FREQ=DAILY" });
      expect((await occurrenceIds(created.id)).length).toBeGreaterThan(0);
      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { rrule: "  " },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().rrule).toBeNull();
      expect(await occurrenceIds(created.id)).toEqual([]);
    });

    it("POST accepts DAILY/WEEKLY/MONTHLY/YEARLY and the weekday preset", async () => {
      for (const rrule of [
        "FREQ=DAILY",
        "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR",
        "FREQ=MONTHLY;BYMONTHDAY=-1",
        "FREQ=YEARLY",
      ]) {
        const response = await app.inject({
          method: "POST",
          url: "/events",
          payload: { ...base, rrule },
        });
        expect(response.statusCode).toBe(201);
        expect(response.json<Event>().rrule).toBe(rrule);
      }
    });

    it.each([
      ["FREQ=HOURLY", "unsupported_frequency"],
      ["FREQ=DAILY;UNTIL=20261231T000000Z", "embedded_until_count"],
      ["garbage", "invalid_rrule"],
    ])("PATCH rejects %s with 400 %s and leaves the series untouched", async (rrule, token) => {
      const created = await createLocalEvent({ rrule: "FREQ=WEEKLY" });
      const before = await occurrenceIds(created.id);
      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { rrule },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ValidationBody>().issues).toEqual([
        expect.objectContaining({ path: ["rrule"], message: token }),
      ]);
      expect(response.body).not.toContain(rrule);
      const [row] = await app.db.select().from(events).where(eq(events.id, created.id));
      expect(row!.rrule).toBe("FREQ=WEEKLY");
      expect(await occurrenceIds(created.id)).toEqual(before);
    });

    it("PATCH validates the EFFECTIVE rule: a count sent against a stored until is refused", async () => {
      const created = await createLocalEvent({
        rrule: "FREQ=WEEKLY",
        recurrence_until: "2026-12-31T00:00:00Z",
      });
      const before = await occurrenceIds(created.id);
      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        // The body alone is valid (the schema's mutual-exclusion refine only
        // sees the fields it was sent); only the merged state is invalid.
        payload: { recurrence_count: 3 },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ValidationBody>().issues[0]?.path).toEqual(["rrule"]);
      expect(response.json<ValidationBody>().issues[0]?.message).toBe("invalid_rrule");
      expect(await occurrenceIds(created.id)).toEqual(before);
    });
  });

  describe("PATCH /events/:id", () => {
    it("refuses `calendar` with a deterministic calendar_immutable token", async () => {
      const created = await createLocalEvent();
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      for (const calendar of [
        { connection_id: connectionId, google_calendar_id: googleCalendarId },
        null,
      ]) {
        const response = await app.inject({
          method: "PATCH",
          url: `/events/${created.id}`,
          payload: { title: "Edited", calendar },
        });
        expect(response.statusCode).toBe(400);
        const body = response.json<ValidationBody>();
        expect(body.error).toBe("validation_failed");
        expect(body.issues).toEqual([
          expect.objectContaining({ path: ["calendar"], message: "calendar_immutable" }),
        ]);
      }
      const [row] = await app.db.select().from(events).where(eq(events.id, created.id));
      expect(row!.title).toBe("Local event");
    });

    it("a title-only PATCH on a recurring event leaves every occurrence id byte-identical", async () => {
      const created = await createLocalEvent({ rrule: "FREQ=DAILY", title: "Daily standup" });
      const before = await occurrenceIds(created.id);
      expect(before.length).toBeGreaterThan(30);

      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { title: "Daily standup (renamed)" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().title).toBe("Daily standup (renamed)");
      expect(await occurrenceIds(created.id)).toEqual(before);
    });

    it("re-sending the same rule in a different lexical form does not regenerate the window", async () => {
      const created = await createLocalEvent({ rrule: "FREQ=WEEKLY;BYDAY=MO" });
      const before = await occurrenceIds(created.id);
      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { rrule: "RRULE:BYDAY=MO;INTERVAL=1;FREQ=WEEKLY" },
      });
      expect(response.statusCode).toBe(200);
      expect(await occurrenceIds(created.id)).toEqual(before);
    });

    it("a rule change or a start change still regenerates the future window", async () => {
      const created = await createLocalEvent({ rrule: "FREQ=DAILY" });
      const before = await occurrenceIds(created.id);

      const ruleChange = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { rrule: "FREQ=WEEKLY" },
      });
      expect(ruleChange.statusCode).toBe(200);
      const afterRule = await occurrenceIds(created.id);
      expect(afterRule).not.toEqual(before);
      expect(afterRule.length).toBeLessThan(before.length);

      const startChange = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { starts_at: "2026-09-22T10:00:00-05:00", ends_at: "2026-09-22T10:30:00-05:00" },
      });
      expect(startChange.statusCode).toBe(200);
      expect(await occurrenceIds(created.id)).not.toEqual(afterRule);
    });

    it("flips a linked local event's link to pending_push inside the mutation and enqueues after it", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const created = await createLocalEvent({
        calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      // Simulate the push job having completed.
      const syncedAt = new Date("2026-09-01T00:00:00Z");
      await app.db
        .update(eventExternalLinks)
        .set({
          syncStatus: "synced",
          googleEventId: "remote-1",
          updatedAt: syncedAt,
          lastSyncedLocalUpdatedAt: syncedAt,
        })
        .where(eq(eventExternalLinks.eventId, created.id));
      const jobsBefore = await pushJobCount(created.id);

      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { title: "Edited after sync" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().sync?.status).toBe("pending_push");

      const [link] = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, created.id));
      expect(link!.syncStatus).toBe("pending_push");
      expect(link!.updatedAt.getTime()).toBeGreaterThan(syncedAt.getTime());
      expect(await pushJobCount(created.id)).toBe(jobsBefore + 1);
    });

    it("cancel-occurrence flips the LINKED PARENT's link to pending_push; detach on a linked series is refused before any write", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const parent = await createLocalEvent({
        title: "Weekly",
        starts_at: "2026-09-21T09:00:00-05:00",
        ends_at: "2026-09-21T09:30:00-05:00",
        rrule: "FREQ=WEEKLY",
        calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      await app.db
        .update(eventExternalLinks)
        .set({ syncStatus: "synced", googleEventId: "remote-1" })
        .where(eq(eventExternalLinks.eventId, parent.id));

      // An EXDATE on the master is exactly how Google represents a cancelled
      // instance, so cancel-occurrence pushes.
      const cancel = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/cancel-occurrence`,
        payload: { original_start_at: "2026-09-28T14:00:00.000Z" },
      });
      expect(cancel.statusCode).toBe(200);
      expect(cancel.json<Event>().sync?.status).toBe("pending_push");

      // A detach would push the EXDATE too while the child is never pushed
      // -- the occurrence would silently vanish from Google -- so it is
      // refused, and nothing is written: no exdate, no child, no occurrence
      // removed, link untouched, no push enqueued.
      await app.db
        .update(eventExternalLinks)
        .set({ syncStatus: "synced" })
        .where(eq(eventExternalLinks.eventId, parent.id));
      const occurrencesBefore = await occurrenceIds(parent.id);
      const pushesBefore = await pushJobCount(parent.id);
      const detach = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-10-05T14:00:00.000Z", title: "Moved" },
      });
      expect(detach.statusCode).toBe(409);
      expect(detach.json<ErrorBody>()).toEqual({ error: "linked_series_detach_unsupported" });
      expect(detach.body).not.toContain("Moved");

      const [parentRow] = await app.db.select().from(events).where(eq(events.id, parent.id));
      expect(parentRow!.recurrenceExdates).toEqual(cancel.json<Event>().recurrence_exdates);
      expect(await app.db.select().from(events).where(eq(events.parentEventId, parent.id))).toEqual(
        [],
      );
      expect(await occurrenceIds(parent.id)).toEqual(occurrencesBefore);
      const [link] = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, parent.id));
      expect(link!.syncStatus).toBe("synced");
      expect(await pushJobCount(parent.id)).toBe(pushesBefore);
    });

    it("detach still works on an UNLINKED local series", async () => {
      const parent = await createLocalEvent({ rrule: "FREQ=WEEKLY" });
      const detach = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-10-05T14:00:00.000Z", title: "Moved" },
      });
      expect(detach.statusCode).toBe(201);
      expect(detach.json<Event>().parent_event_id).toBe(parent.id);
      expect(await pushJobCount(parent.id)).toBe(0);
    });

    it("link-calendar refuses a series that already has detached children, and a detached child itself (second-round review)", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId, { accessRole: "owner" });
      const parent = await createLocalEvent({ rrule: "FREQ=WEEKLY" });
      const detach = await app.inject({
        method: "POST",
        url: `/events/${parent.id}/detach`,
        payload: { original_start_at: "2026-10-05T14:00:00.000Z", title: "Moved" },
      });
      expect(detach.statusCode).toBe(201);
      const child = detach.json<Event>();
      for (const target of [parent, child]) {
        const response = await app.inject({
          method: "POST",
          url: `/events/${target.id}/link-calendar`,
          payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
        });
        expect(response.statusCode).toBe(409);
        expect(response.json()).toEqual({ error: "linked_series_detach_unsupported" });
      }
      expect(await app.db.select().from(eventExternalLinks)).toEqual([]);
      expect(await pushJobCount(parent.id)).toBe(0);
    });
  });

  describe("recurrence_until precision (Checkpoint 9.5 review)", () => {
    it("POST floors a timed recurrence_until to whole seconds so the Google round trip cannot change it", async () => {
      const created = await createLocalEvent({
        rrule: "FREQ=DAILY",
        recurrence_until: "2026-12-31T23:59:59.999-06:00",
      });
      expect(created.recurrence_until).toBe("2027-01-01T05:59:59.000Z");
      const [row] = await app.db.select().from(events).where(eq(events.id, created.id));
      expect(row!.recurrenceUntil!.getMilliseconds()).toBe(0);
    });

    it("PATCH floors recurrence_until too", async () => {
      const created = await createLocalEvent({ rrule: "FREQ=DAILY" });
      const response = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: { recurrence_until: "2026-12-31T23:59:59.999-06:00" },
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().recurrence_until).toBe("2027-01-01T05:59:59.000Z");
    });

    it("after the Google round trip stores .000, a PATCH re-sending the editor's .999 until keeps every occurrence id", async () => {
      const created = await createLocalEvent({
        rrule: "FREQ=DAILY",
        recurrence_until: "2026-12-31T23:59:59.999-06:00",
      });
      const before = await occurrenceIds(created.id);
      expect(before.length).toBeGreaterThan(0);

      // The client re-sends the rule it loaded alongside a title edit --
      // with the editor's own .999 -- while the row holds the whole-second
      // value the round trip produced.
      const first = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: {
          title: "Renamed",
          rrule: "FREQ=DAILY",
          recurrence_until: "2026-12-31T23:59:59.999-06:00",
        },
      });
      expect(first.statusCode).toBe(200);
      expect(await occurrenceIds(created.id)).toEqual(before);

      // A pre-9.5 row persisted WITH milliseconds against a client now
      // sending whole seconds: the comparison floors both sides.
      await app.db
        .update(events)
        .set({ recurrenceUntil: new Date("2027-01-01T05:59:59.999Z") })
        .where(eq(events.id, created.id));
      const second = await app.inject({
        method: "PATCH",
        url: `/events/${created.id}`,
        payload: {
          title: "Renamed again",
          rrule: "FREQ=DAILY",
          recurrence_until: "2027-01-01T05:59:59Z",
        },
      });
      expect(second.statusCode).toBe(200);
      expect(await occurrenceIds(created.id)).toEqual(before);
    });
  });

  describe("POST /events/:id/link-calendar applies the write-eligibility rule (Checkpoint 9.5 review)", () => {
    it.each([
      ["reader", "calendar_not_writable"],
      ["freeBusyReader", "calendar_not_writable"],
      [null, "calendar_not_writable"],
    ])(
      "refuses a Google calendar with role %s (400 %s) and writes no link",
      async (accessRole, token) => {
        const connectionId = await insertConnection("google");
        const googleCalendarId = await insertGoogleCalendar(connectionId, { accessRole });
        const event = await createLocalEvent();
        for (const route of ["link-calendar", "link-google-calendar"]) {
          const response = await app.inject({
            method: "POST",
            url: `/events/${event.id}/${route}`,
            payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
          });
          expect(response.statusCode).toBe(400);
          const body = response.json<ValidationBody>();
          expect(body.error).toBe("validation_failed");
          expect(body.issues).toEqual([
            expect.objectContaining({ path: ["calendar"], message: token }),
          ]);
        }
        expect(await app.db.select().from(eventExternalLinks)).toEqual([]);
        expect(await pushJobCount(event.id)).toBe(0);
      },
    );

    it("refuses a sync-disabled calendar (calendar_not_writable) and an inactive connection (connection_not_active)", async () => {
      const disabledConnection = await insertConnection("google");
      const disabledCalendar = await insertGoogleCalendar(disabledConnection, {
        syncEnabled: false,
      });
      const event = await createLocalEvent();
      const disabled = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-calendar`,
        payload: { connection_id: disabledConnection, google_calendar_id: disabledCalendar },
      });
      expect(disabled.statusCode).toBe(400);
      expect(disabled.json<ValidationBody>().issues).toEqual([
        expect.objectContaining({ path: ["calendar"], message: "calendar_not_writable" }),
      ]);

      const inactiveConnection = await insertConnection("google", "needs_reauth");
      const inactiveCalendar = await insertGoogleCalendar(inactiveConnection);
      const inactive = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-calendar`,
        payload: { connection_id: inactiveConnection, google_calendar_id: inactiveCalendar },
      });
      expect(inactive.statusCode).toBe(400);
      expect(inactive.json<ValidationBody>().issues).toEqual([
        expect.objectContaining({ path: ["calendar"], message: "connection_not_active" }),
      ]);

      const unknown = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-calendar`,
        payload: { connection_id: disabledConnection, google_calendar_id: "nope" },
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json<ValidationBody>().issues).toEqual([
        expect.objectContaining({ path: ["calendar"], message: "calendar_not_found" }),
      ]);
      expect(await app.db.select().from(eventExternalLinks)).toEqual([]);
    });

    it.each(["owner", "writer"])("links a Google calendar with role %s (201)", async (role) => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId, { accessRole: role });
      const event = await createLocalEvent();
      const response = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-calendar`,
        payload: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        event_id: event.id,
        connection_id: connectionId,
        google_calendar_id: googleCalendarId,
        caldav_calendar_url: null,
        sync_status: "pending_push",
      });
      expect(await pushJobCount(event.id)).toBe(1);
    });

    it("links a CalDAV calendar with a null role (201)", async () => {
      const connectionId = await insertConnection("caldav");
      const url = await insertCaldavCalendar(connectionId);
      const event = await createLocalEvent();
      const response = await app.inject({
        method: "POST",
        url: `/events/${event.id}/link-calendar`,
        payload: { connection_id: connectionId, caldav_calendar_url: url },
      });
      expect(response.statusCode).toBe(201);
      expect(response.json()).toMatchObject({
        google_calendar_id: null,
        caldav_calendar_url: url,
        sync_status: "pending_push",
      });
    });

    it("refuses a selector naming both or neither calendar id with 400 on the calendar path", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const event = await createLocalEvent();
      for (const payload of [
        { connection_id: connectionId },
        {
          connection_id: connectionId,
          google_calendar_id: googleCalendarId,
          caldav_calendar_url: "/x/",
        },
      ]) {
        const response = await app.inject({
          method: "POST",
          url: `/events/${event.id}/link-calendar`,
          payload,
        });
        expect(response.statusCode).toBe(400);
        expect(response.json<ValidationBody>().issues).toEqual([
          expect.objectContaining({ path: ["calendar"], message: "calendar_not_found" }),
        ]);
      }
    });
  });

  describe("POST /events/:id/archive", () => {
    it("is idempotent: a second archive returns the same archived_at and enqueues no second push", async () => {
      const connectionId = await insertConnection("google");
      const googleCalendarId = await insertGoogleCalendar(connectionId);
      const created = await createLocalEvent({
        calendar: { connection_id: connectionId, google_calendar_id: googleCalendarId },
      });
      await app.db
        .update(eventExternalLinks)
        .set({ syncStatus: "synced", googleEventId: "remote-1" })
        .where(eq(eventExternalLinks.eventId, created.id));
      const jobsBefore = await pushJobCount(created.id);

      const first = await app.inject({ method: "POST", url: `/events/${created.id}/archive` });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<Event>();
      expect(firstBody.archived_at).not.toBeNull();
      expect(firstBody.sync?.status).toBe("pending_push");
      expect(await pushJobCount(created.id)).toBe(jobsBefore + 1);

      const [linkAfterFirst] = await app.db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, created.id));
      expect(linkAfterFirst!.syncStatus).toBe("pending_push");

      const second = await app.inject({ method: "POST", url: `/events/${created.id}/archive` });
      expect(second.statusCode).toBe(200);
      expect(second.json<Event>()).toEqual(firstBody);
      expect(await pushJobCount(created.id)).toBe(jobsBefore + 1);
    });

    it("archiving an unlinked local event enqueues nothing and reports sync=null", async () => {
      const created = await createLocalEvent();
      const response = await app.inject({ method: "POST", url: `/events/${created.id}/archive` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Event>().sync).toBeNull();
      expect(response.json<Event>().origin).toBe("local");
      expect(await pushJobCount(created.id)).toBe(0);
    });
  });
});
