import { encryptSecret } from "@personal-os/ai-providers";
import {
  createFakeGoogleCalendarClient,
  GoogleCalendarApiError,
} from "@personal-os/calendar-providers";
import {
  calendarConnectionCalendars,
  calendarConnections,
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
});
