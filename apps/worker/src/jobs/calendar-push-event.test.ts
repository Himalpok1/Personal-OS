import { encryptSecret } from "@personal-os/ai-providers";
import {
  createFakeGoogleCalendarClient,
  GoogleCalendarApiError,
} from "@personal-os/calendar-providers";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  eventExternalLinks,
  events,
  type Db,
} from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { env } from "../env.js";
import {
  createCalendarPushEventHandler,
  type CalendarPushEventJobData,
} from "./calendar-push-event.js";

const GOOGLE_CALENDAR_ID = "primary";

async function insertConnection(db: Db): Promise<string> {
  const accessSecret = encryptSecret("fake-access-token", env.CREDENTIALS_ENCRYPTION_KEY);
  const [row] = await db
    .insert(calendarConnections)
    .values({
      provider: "google",
      googleAccountEmail: "user@example.com",
      googleAccountId: `account-${Math.random()}`,
      accessTokenCiphertext: accessSecret.ciphertext,
      accessTokenIv: accessSecret.iv,
      accessTokenAuthTag: accessSecret.authTag,
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
      grantedScope: "https://www.googleapis.com/auth/calendar",
      status: "active",
    })
    .returning({ id: calendarConnections.id });
  return row!.id;
}

function fakeJob(data: CalendarPushEventJobData): Job<CalendarPushEventJobData> {
  return { id: "job-1", name: "calendar.google.push-event", data } as Job<CalendarPushEventJobData>;
}

describe("calendar.google.push-event", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  it("no-ops for an event with no event_external_links row", async () => {
    const [eventRow] = await db
      .insert(events)
      .values({
        title: "Unlinked",
        timezone: "America/Chicago",
        startsAt: new Date(),
        endsAt: new Date(),
      })
      .returning();
    const client = createFakeGoogleCalendarClient();
    const handler = createCalendarPushEventHandler(db, client);
    await handler([fakeJob({ eventId: eventRow!.id })]);
    expect(client.writeCalls).toHaveLength(0);
  });

  it("pushes a local edit as updateEvent and advances the conflict baseline", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
    });
    const [eventRow] = await db
      .insert(events)
      .values({
        title: "Renamed locally",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-01T15:00:00-05:00"),
        endsAt: new Date("2026-09-01T15:30:00-05:00"),
      })
      .returning();
    await db.insert(eventExternalLinks).values({
      eventId: eventRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: "g-event-1",
      lastSyncedLocalUpdatedAt: new Date(0),
    });

    const client = createFakeGoogleCalendarClient();
    const handler = createCalendarPushEventHandler(db, client);
    await handler([fakeJob({ eventId: eventRow!.id })]);

    expect(client.writeCalls).toHaveLength(1);
    expect(client.writeCalls[0]).toMatchObject({ kind: "update", eventId: "g-event-1" });

    const [link] = await db
      .select()
      .from(eventExternalLinks)
      .where(eq(eventExternalLinks.eventId, eventRow!.id));
    expect(link?.lastSyncedLocalUpdatedAt?.getTime()).toBe(eventRow!.updatedAt.getTime());
    expect(link?.googleUpdatedAt).not.toBeNull();
  });

  it("inserts (not updates) on the first push of a locally-linked event with no googleEventId yet, and fills it in", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
    });
    const [eventRow] = await db
      .insert(events)
      .values({
        title: "New local-only event, explicitly linked",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-01T15:00:00-05:00"),
        endsAt: new Date("2026-09-01T15:30:00-05:00"),
      })
      .returning();
    // Mirrors what POST /events/:id/link-google-calendar creates: a
    // pending_push row with no googleEventId, since the event doesn't exist
    // on Google's side yet.
    await db.insert(eventExternalLinks).values({
      eventId: eventRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: null,
      syncStatus: "pending_push",
    });

    const client = createFakeGoogleCalendarClient();
    const handler = createCalendarPushEventHandler(db, client);
    await handler([fakeJob({ eventId: eventRow!.id })]);

    expect(client.writeCalls).toHaveLength(1);
    expect(client.writeCalls[0]).toMatchObject({ kind: "insert" });

    const [link] = await db
      .select()
      .from(eventExternalLinks)
      .where(eq(eventExternalLinks.eventId, eventRow!.id));
    expect(link?.googleEventId).not.toBeNull();
    expect(link?.syncStatus).toBe("synced");
    expect(link?.lastSyncedLocalUpdatedAt?.getTime()).toBe(eventRow!.updatedAt.getTime());
  });

  it("deletes on Google and removes the link when the local event is archived", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
    });
    const [eventRow] = await db
      .insert(events)
      .values({
        title: "Archived event",
        timezone: "America/Chicago",
        startsAt: new Date(),
        endsAt: new Date(),
        archivedAt: new Date(),
      })
      .returning();
    await db.insert(eventExternalLinks).values({
      eventId: eventRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: "g-event-2",
    });

    const client = createFakeGoogleCalendarClient();
    const handler = createCalendarPushEventHandler(db, client);
    await handler([fakeJob({ eventId: eventRow!.id })]);

    expect(client.writeCalls).toEqual([
      { kind: "delete", calendarId: GOOGLE_CALENDAR_ID, eventId: "g-event-2" },
    ]);
    expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
  });

  it("treats a 404 from deleteEvent as already-gone, not a failure", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
    });
    const [eventRow] = await db
      .insert(events)
      .values({
        title: "Gone",
        timezone: "UTC",
        startsAt: new Date(),
        endsAt: new Date(),
        archivedAt: new Date(),
      })
      .returning();
    await db.insert(eventExternalLinks).values({
      eventId: eventRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: "g-event-3",
    });

    const client = createFakeGoogleCalendarClient();
    client.deleteEvent = vi
      .fn()
      .mockRejectedValue(new GoogleCalendarApiError("not found", 404, undefined));
    const handler = createCalendarPushEventHandler(db, client);
    await expect(handler([fakeJob({ eventId: eventRow!.id })])).resolves.not.toThrow();
    expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
  });

  it("pushes a detached recurring occurrence to Google with recurringEventId and originalStartTime", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      summary: "Primary",
      syncEnabled: true,
    });
    const [parentRow] = await db
      .insert(events)
      .values({
        title: "Weekly Standup",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-07T09:00:00-05:00"),
        endsAt: new Date("2026-09-07T09:30:00-05:00"),
        rrule: "RRULE:FREQ=WEEKLY;INTERVAL=1",
      })
      .returning();
    await db.insert(eventExternalLinks).values({
      eventId: parentRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: "g-master-1",
      lastSyncedLocalUpdatedAt: parentRow!.updatedAt,
    });

    const originalStartAt = new Date("2026-09-14T09:00:00-05:00");
    const [childRow] = await db
      .insert(events)
      .values({
        title: "Weekly Standup (moved)",
        timezone: "America/Chicago",
        startsAt: new Date("2026-09-14T10:00:00-05:00"),
        endsAt: new Date("2026-09-14T10:30:00-05:00"),
        parentEventId: parentRow!.id,
        originalStartAt,
      })
      .returning();

    await db.insert(eventExternalLinks).values({
      eventId: childRow!.id,
      connectionId,
      googleCalendarId: GOOGLE_CALENDAR_ID,
      googleEventId: null,
      syncStatus: "pending_push",
    });

    const client = createFakeGoogleCalendarClient();
    const handler = createCalendarPushEventHandler(db, client);
    await handler([fakeJob({ eventId: childRow!.id })]);

    expect(client.writeCalls).toHaveLength(1);
    expect(client.writeCalls[0]).toMatchObject({
      kind: "insert",
      calendarId: GOOGLE_CALENDAR_ID,
      event: {
        summary: "Weekly Standup (moved)",
        recurringEventId: "g-master-1",
        originalStartTime: {
          dateTime: originalStartAt.toISOString(),
          timeZone: "America/Chicago",
        },
      },
    });

    const [instanceRow] = await db
      .select()
      .from(calendarEventInstances)
      .where(eq(calendarEventInstances.localDetachedEventId, childRow!.id));
    expect(instanceRow?.mappingStatus).toBe("detached");
    expect(instanceRow?.googleMasterEventId).toBe("g-master-1");
    expect(instanceRow?.localParentEventId).toBe(parentRow!.id);
  });

  describe("CalDAV push events", () => {
    async function insertCaldavConnection(db: Db): Promise<string> {
      const pwSecret = encryptSecret("fake-password", env.CREDENTIALS_ENCRYPTION_KEY);
      const [row] = await db
        .insert(calendarConnections)
        .values({
          provider: "caldav",
          serverUrl: "https://caldav.example.com",
          username: "testuser",
          authType: "basic",
          principalUrl: "/principals/users/testuser/",
          calendarHomeSetUrl: "/calendars/users/testuser/",
          passwordCiphertext: pwSecret.ciphertext,
          passwordIv: pwSecret.iv,
          passwordAuthTag: pwSecret.authTag,
          status: "active",
        })
        .returning({ id: calendarConnections.id });
      return row!.id;
    }

    it("pushes a new standalone event with PUT and If-None-Match: *", async () => {
      const connectionId = await insertCaldavConnection(db);
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "New Local Event",
          timezone: "America/Chicago",
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T15:00:00.000Z"),
        })
        .returning();

      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          caldavCalendarUrl: "/calendars/users/testuser/personal/",
          syncStatus: "pending_push",
        })
        .returning();

      const fakeCalDav = (await import("@personal-os/calendar-providers")).createFakeCalDavClient();
      const fakeGoogle = createFakeGoogleCalendarClient();
      const handler = createCalendarPushEventHandler(db, fakeGoogle, fakeCalDav);

      await handler([fakeJob({ eventId: eventRow!.id })]);

      const [updatedLink] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.id, link!.id));

      expect(updatedLink?.syncStatus).toBe("synced");
      expect(updatedLink?.caldavResourceUrl).toBeDefined();
      expect(updatedLink?.caldavEtag).toBeDefined();

      const remoteEvent = await fakeCalDav.getEvent(updatedLink!.caldavResourceUrl!, {
        username: "testuser",
        password: "fake-password",
      });
      expect(remoteEvent.icsData).toContain("SUMMARY:New Local Event");
    });

    it("pushes an update to an existing event with If-Match: ETag", async () => {
      const connectionId = await insertCaldavConnection(db);
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "Initial Title",
          timezone: "America/Chicago",
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T15:00:00.000Z"),
        })
        .returning();

      const fakeCalDav = (await import("@personal-os/calendar-providers")).createFakeCalDavClient();
      const auth = { username: "testuser", password: "fake-password" };
      const resourceHref = "/calendars/users/testuser/personal/existing.ics";
      const initialPut = await fakeCalDav.putEvent(
        resourceHref,
        (await import("@personal-os/calendar-providers")).localEventToVCalendar({
          title: "Initial Title",
          allDay: false,
          startsAt: eventRow!.startsAt!,
          endsAt: eventRow!.endsAt!,
          timezone: "America/Chicago",
        }),
        undefined,
        auth,
        { ifNoneMatch: true },
      );

      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          caldavCalendarUrl: "/calendars/users/testuser/personal/",
          caldavResourceUrl: resourceHref,
          caldavEtag: initialPut.etag,
          syncStatus: "pending_push",
        })
        .returning();

      // Edit locally
      await db
        .update(events)
        .set({ title: "Updated Title", updatedAt: new Date() })
        .where(eq(events.id, eventRow!.id));

      const fakeGoogle = createFakeGoogleCalendarClient();
      const handler = createCalendarPushEventHandler(db, fakeGoogle, fakeCalDav);

      await handler([fakeJob({ eventId: eventRow!.id })]);

      const [updatedLink] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.id, link!.id));

      expect(updatedLink?.syncStatus).toBe("synced");
      expect(updatedLink?.caldavEtag).not.toBe(initialPut.etag);

      const remoteEvent = await fakeCalDav.getEvent(resourceHref, auth);
      expect(remoteEvent.icsData).toContain("SUMMARY:Updated Title");
    });

    // Checkpoint 4.7 fix: caldavEtag alone was previously advanced on push,
    // but caldavUpdatedAt (the baseline calendar-sync-calendar.ts's
    // decideConflict() compares against on the next inbound pass) was not --
    // leaving the sync engine to see a stale remote baseline and needlessly
    // re-apply the event it had just pushed. Both must advance together.
    it("advances caldavUpdatedAt alongside caldavEtag on a successful push", async () => {
      const connectionId = await insertCaldavConnection(db);
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "Baseline check",
          timezone: "America/Chicago",
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T15:00:00.000Z"),
        })
        .returning();

      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          caldavCalendarUrl: "/calendars/users/testuser/personal/",
          syncStatus: "pending_push",
        })
        .returning();

      const fakeCalDav = (await import("@personal-os/calendar-providers")).createFakeCalDavClient();
      const fakeGoogle = createFakeGoogleCalendarClient();
      const handler = createCalendarPushEventHandler(db, fakeGoogle, fakeCalDav);

      expect(link?.caldavUpdatedAt).toBeNull();
      await handler([fakeJob({ eventId: eventRow!.id })]);

      const [updatedLink] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.id, link!.id));

      expect(updatedLink?.caldavEtag).toBeDefined();
      expect(updatedLink?.caldavUpdatedAt).not.toBeNull();
      expect(updatedLink?.lastSyncedLocalUpdatedAt?.getTime()).toBe(eventRow!.updatedAt.getTime());
    });
  });
});
