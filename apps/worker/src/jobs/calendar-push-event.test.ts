import { encryptSecret } from "@personal-os/ai-providers";
import {
  CalDavError,
  createFakeCalDavClient,
  createFakeGoogleCalendarClient,
  GoogleCalendarApiError,
  localEventToVCalendar,
  type FakeCalDavClient,
} from "@personal-os/calendar-providers";
import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  devices,
  eventExternalLinks,
  events,
  notificationDispatchLog,
  type Db,
} from "@personal-os/db";
import { eq, sql } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";

type LogRecord = Record<string, unknown>;
import {
  createCalendarPushEventDeadLetterHandler,
  createCalendarPushEventHandler,
  desiredCaldavIcalUid,
  desiredCaldavResourceHref,
  desiredGoogleEventId,
  type CalendarPushEventJobData,
} from "./calendar-push-event.js";
import { createCalendarRefreshTokenHandler } from "./calendar-refresh-token.js";

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

    describe("fixer review findings (CalDAV)", () => {
      const AUTH = { username: "testuser", password: "fake-password" };

      async function insertPendingCaldavEvent(
        connectionId: string,
        eventValues: Partial<typeof events.$inferInsert> = {},
      ) {
        const [eventRow] = await db
          .insert(events)
          .values({
            title: "CalDAV local event",
            timezone: "America/Chicago",
            origin: "local",
            startsAt: new Date("2026-08-25T14:00:00.000Z"),
            endsAt: new Date("2026-08-25T15:00:00.000Z"),
            ...eventValues,
          })
          .returning();
        const [link] = await db
          .insert(eventExternalLinks)
          .values({
            eventId: eventRow!.id,
            connectionId,
            caldavCalendarUrl: CALDAV_URL,
            syncStatus: "pending_push",
          })
          .returning();
        return { event: eventRow!, link: link! };
      }

      /** The fake, with the NEXT putEvent applying the write and then losing its response. */
      function withLostPutResponse(fake: FakeCalDavClient): FakeCalDavClient {
        const original = fake.putEvent.bind(fake);
        let armed = true;
        fake.putEvent = async (...args) => {
          const result = await original(...args);
          if (armed) {
            armed = false;
            throw Object.assign(new Error("socket hang up"), { code: "ECONNRESET" });
          }
          return result;
        };
        return fake;
      }

      it("BLOCKER-2: a lost PUT response retries onto the SAME deterministic href (412 -> adopt), leaving exactly one remote resource", async () => {
        const connectionId = await insertCaldavConnection(db);
        const { event, link } = await insertPendingCaldavEvent(connectionId);
        const fakeCalDav = withLostPutResponse(createFakeCalDavClient());
        const handler = createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          fakeCalDav,
        );

        await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();
        const between = await readCaldavLink(event.id);
        expect(between.caldavResourceUrl).toBeNull();
        expect(between.syncStatus).toBe("pending_push");
        const expectedHref = desiredCaldavResourceHref(CALDAV_URL, link.id);
        expect(remoteHrefs(fakeCalDav)).toEqual([expectedHref]);

        await handler([fakeJob({ eventId: event.id })]);
        const after = await readCaldavLink(event.id);
        expect(after.syncStatus).toBe("synced");
        expect(after.caldavResourceUrl).toBe(expectedHref);
        expect(after.caldavIcalUid).toBe(desiredCaldavIcalUid(link.id));
        // Adopted the resource the first attempt created: one resource, its etag stored.
        expect(remoteHrefs(fakeCalDav)).toEqual([expectedHref]);
        const remote = await fakeCalDav.getEvent(expectedHref, AUTH);
        expect(after.caldavEtag).toBe(remote.etag);
        expect(remote.icsData).toContain(`UID:${desiredCaldavIcalUid(link.id)}`);
      });

      it("BLOCKER-2 (second-round): an edit between the lost PUT and the retry reaches the server -- the 412 adopt re-PUTs the CURRENT body", async () => {
        const connectionId = await insertCaldavConnection(db);
        const { event, link } = await insertPendingCaldavEvent(connectionId);
        const fakeCalDav = withLostPutResponse(createFakeCalDavClient());
        const handler = createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          fakeCalDav,
        );
        await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();

        // The owner edits the title while the link still has no href.
        await db
          .update(events)
          .set({ title: "NEW TITLE 9-5", updatedAt: new Date() })
          .where(eq(events.id, event.id));

        await handler([fakeJob({ eventId: event.id })]);
        const expectedHref = desiredCaldavResourceHref(CALDAV_URL, link.id);
        expect(remoteHrefs(fakeCalDav)).toEqual([expectedHref]);
        const remote = await fakeCalDav.getEvent(expectedHref, AUTH);
        expect(remote.icsData).toContain("NEW TITLE 9-5");
        const after = await readCaldavLink(event.id);
        expect(after.caldavEtag).toBe(remote.etag);
      });

      it("BLOCKER-2: a 412 on an UPDATE (If-Match mismatch) is still a conflict, never adopted", async () => {
        const connectionId = await insertCaldavConnection(db);
        const fakeCalDav = createFakeCalDavClient();
        const href = `${CALDAV_URL}existing.ics`;
        const put = await fakeCalDav.putEvent(
          href,
          localEventToVCalendar({
            title: "Remote",
            allDay: false,
            startsAt: new Date("2026-08-25T14:00:00.000Z"),
            endsAt: new Date("2026-08-25T15:00:00.000Z"),
            timezone: "America/Chicago",
          }),
          undefined,
          AUTH,
          { ifNoneMatch: true },
        );
        const { event } = await insertPendingCaldavEvent(connectionId);
        await db
          .update(eventExternalLinks)
          .set({ caldavResourceUrl: href, caldavEtag: `${put.etag}-stale` })
          .where(eq(eventExternalLinks.eventId, event.id));
        await createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          fakeCalDav,
        )([fakeJob({ eventId: event.id })]);
        const after = await readCaldavLink(event.id);
        expect(after.syncStatus).toBe("conflict");
        expect(after.lastSyncError).toBe("conflict");
      });

      it("MAJOR-A: archiving after a lost insert deletes the resource at the deterministic href", async () => {
        const connectionId = await insertCaldavConnection(db);
        const { event, link } = await insertPendingCaldavEvent(connectionId);
        const fakeCalDav = withLostPutResponse(createFakeCalDavClient());
        const handler = createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          fakeCalDav,
        );
        await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();
        expect(remoteHrefs(fakeCalDav)).toEqual([desiredCaldavResourceHref(CALDAV_URL, link.id)]);

        await db.update(events).set({ archivedAt: new Date() }).where(eq(events.id, event.id));
        await handler([fakeJob({ eventId: event.id })]);
        expect(remoteHrefs(fakeCalDav)).toEqual([]);
        expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
      });

      it("MAJOR-B: a connection with no stored password marks the link error/auth_failed rather than leaving it pending", async () => {
        const connectionId = await insertCaldavConnection(db);
        await db
          .update(calendarConnections)
          .set({ passwordCiphertext: null, passwordIv: null, passwordAuthTag: null })
          .where(eq(calendarConnections.id, connectionId));
        const { event } = await insertPendingCaldavEvent(connectionId);
        await createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          createFakeCalDavClient(),
        )([fakeJob({ eventId: event.id })]);
        const after = await readCaldavLink(event.id);
        expect(after.syncStatus).toBe("error");
        expect(after.lastSyncError).toBe("auth_failed");
      });

      it("MAJOR-B: a detached child whose parent has no remote resource marks the link error/not_found", async () => {
        const connectionId = await insertCaldavConnection(db);
        const { event: parent } = await insertPendingCaldavEvent(connectionId, {
          rrule: "FREQ=WEEKLY",
          recurrenceTimezone: "America/Chicago",
        });
        const { event: child } = await insertPendingCaldavEvent(connectionId, {
          parentEventId: parent.id,
          originalStartAt: new Date("2026-09-01T14:00:00.000Z"),
        });
        await createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          createFakeCalDavClient(),
        )([fakeJob({ eventId: child.id })]);
        const after = await readCaldavLink(child.id);
        expect(after.syncStatus).toBe("error");
        expect(after.lastSyncError).toBe("not_found");
      });

      it.each([403, 405])(
        "MINOR-3: a %d on PUT is permanent -- link error with a closed code, nothing rethrown",
        async (status) => {
          const connectionId = await insertCaldavConnection(db);
          const { event } = await insertPendingCaldavEvent(connectionId);
          const fakeCalDav = createFakeCalDavClient();
          fakeCalDav.putEvent = () =>
            Promise.reject(new CalDavError("refused <secret body>", status, "<secret body>"));
          const sink: LogRecord[] = [];
          const restore = setLogSink({ write: (_level, record) => sink.push(record) });
          try {
            await createCalendarPushEventHandler(
              db,
              createFakeGoogleCalendarClient(),
              fakeCalDav,
            )([fakeJob({ eventId: event.id })]);
          } finally {
            restore();
          }
          const after = await readCaldavLink(event.id);
          expect(after.syncStatus).toBe("error");
          expect(after.lastSyncError).toBe(status === 403 ? "auth_failed" : "missing_scope");
          const line = sink.find((r) => r["event"] === "calendar.push_event.permanent_failure");
          expect(line).toMatchObject({ provider: "caldav", httpStatus: status });
          expect(JSON.stringify(sink)).not.toContain("secret body");
        },
      );

      it("a transient CalDAV failure (503) is still rethrown for retry", async () => {
        const connectionId = await insertCaldavConnection(db);
        const { event } = await insertPendingCaldavEvent(connectionId);
        const fakeCalDav = createFakeCalDavClient();
        fakeCalDav.putEvent = () => Promise.reject(new CalDavError("down", 503));
        await expect(
          createCalendarPushEventHandler(
            db,
            createFakeGoogleCalendarClient(),
            fakeCalDav,
          )([fakeJob({ eventId: event.id })]),
        ).rejects.toThrow();
        expect((await readCaldavLink(event.id)).syncStatus).toBe("pending_push");
      });

      const CALDAV_URL = "/calendars/users/testuser/personal/";
      async function readCaldavLink(eventId: string) {
        const [link] = await db
          .select()
          .from(eventExternalLinks)
          .where(eq(eventExternalLinks.eventId, eventId));
        return link!;
      }
      function remoteHrefs(fake: FakeCalDavClient): string[] {
        return [...fake.calendars.get(CALDAV_URL)!.resources.keys()];
      }
    });
  });

  // =========================================================================
  // Checkpoint 9.5: idempotent insert, outbound recurrence, race-safe final
  // write, shared needs_reauth transition, dead-letter alert.
  // =========================================================================
  describe("Checkpoint 9.5 -- Google push contract", () => {
    async function insertLinkedEvent(
      db: Db,
      connectionId: string,
      eventValues: Partial<typeof events.$inferInsert> = {},
      linkValues: Partial<typeof eventExternalLinks.$inferInsert> = {},
    ): Promise<{
      event: typeof events.$inferSelect;
      link: typeof eventExternalLinks.$inferSelect;
    }> {
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "Local event",
          timezone: "America/Chicago",
          origin: "local",
          startsAt: new Date("2026-09-07T09:00:00-05:00"),
          endsAt: new Date("2026-09-07T09:30:00-05:00"),
          ...eventValues,
        })
        .returning();
      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId,
          googleCalendarId: GOOGLE_CALENDAR_ID,
          googleEventId: null,
          syncStatus: "pending_push",
          ...linkValues,
        })
        .returning();
      return { event: eventRow!, link: link! };
    }

    async function readLink(db: Db, eventId: string) {
      const [link] = await db
        .select()
        .from(eventExternalLinks)
        .where(eq(eventExternalLinks.eventId, eventId));
      return link!;
    }

    it("desiredGoogleEventId is the link id without hyphens, inside Google's base32hex alphabet", () => {
      const id = desiredGoogleEventId("A1B2C3D4-E5F6-4a7b-8c9d-0e1f2a3b4c5d");
      expect(id).toBe("a1b2c3d4e5f64a7b8c9d0e1f2a3b4c5d");
      expect(id).toMatch(/^[a-v0-9]{5,1024}$/);
    });

    it("first push inserts with id = desiredGoogleEventId(link.id) and stores exactly that id", async () => {
      const connectionId = await insertConnection(db);
      const { event, link } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      const handler = createCalendarPushEventHandler(db, client);

      await handler([fakeJob({ eventId: event.id })]);

      expect(client.insertedIds).toEqual([desiredGoogleEventId(link.id)]);
      const after = await readLink(db, event.id);
      expect(after.googleEventId).toBe(desiredGoogleEventId(link.id));
      expect(after.syncStatus).toBe("synced");
      expect(after.lastSyncError).toBeNull();
      expect(client.remoteEvents.size).toBe(1);
    });

    it("a lost response (remote insert succeeded, then the request threw) retries into a 409 -> update, leaving exactly ONE remote event", async () => {
      const connectionId = await insertConnection(db);
      const { event, link } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      const handler = createCalendarPushEventHandler(db, client);
      const timeout = Object.assign(new Error("The operation was aborted due to timeout"), {
        name: "TimeoutError",
      });
      client.queueInsertFailure({ error: timeout, afterRemoteWrite: true });

      // Attempt 1: the write reached Google, the response did not come back.
      // Transient -> rethrown (contained) so pg-boss retries; nothing stored.
      await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();
      const between = await readLink(db, event.id);
      expect(between.googleEventId).toBeNull();
      expect(between.syncStatus).toBe("pending_push");
      expect(client.remoteEvents.size).toBe(1);

      // Attempt 2: same desired id -> 409 -> update -> success.
      await handler([fakeJob({ eventId: event.id })]);

      const desired = desiredGoogleEventId(link.id);
      expect(client.writeCalls.map((c) => c.kind)).toEqual(["insert", "insert", "update"]);
      expect(client.insertedIds).toEqual([desired, desired]);
      expect(client.writeCalls[2]).toMatchObject({ kind: "update", eventId: desired });
      expect(client.remoteEvents.size).toBe(1);
      expect(client.remoteEvents.has(`${GOOGLE_CALENDAR_ID}/${desired}`)).toBe(true);

      const after = await readLink(db, event.id);
      expect(after.googleEventId).toBe(desired);
      expect(after.syncStatus).toBe("synced");
    });

    it("a timed recurrence master sends Google `recurrence` lines built from the stored columns (prefixed rrule normalised, UNTIL as UTC, EXDATE at DTSTART's wall time)", async () => {
      const connectionId = await insertConnection(db);
      const { event } = await insertLinkedEvent(db, connectionId, {
        rrule: "RRULE:FREQ=WEEKLY;BYDAY=MO",
        recurrenceTimezone: "America/Chicago",
        recurrenceUntil: new Date("2026-12-28T09:00:00-06:00"),
        recurrenceExdates: ["2026-09-21"],
      });
      const client = createFakeGoogleCalendarClient();
      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);

      expect(client.writeCalls[0]).toMatchObject({
        kind: "insert",
        event: {
          recurrence: [
            "RRULE:FREQ=WEEKLY;BYDAY=MO;UNTIL=20261228T150000Z",
            "EXDATE;TZID=America/Chicago:20260921T090000",
          ],
        },
      });
    });

    it("an all-day recurrence master sends a bare rule with COUNT and VALUE=DATE exdates", async () => {
      const connectionId = await insertConnection(db);
      const { event } = await insertLinkedEvent(db, connectionId, {
        allDay: true,
        startsAt: null,
        endsAt: null,
        startDate: "2026-09-01",
        endDate: "2026-09-01",
        rrule: "FREQ=MONTHLY;BYMONTHDAY=-1",
        recurrenceTimezone: "America/Chicago",
        recurrenceCount: 6,
        recurrenceExdates: ["2026-10-31"],
      });
      const client = createFakeGoogleCalendarClient();
      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);

      expect(client.writeCalls[0]).toMatchObject({
        kind: "insert",
        event: {
          start: { date: "2026-09-01" },
          end: { date: "2026-09-02" },
          recurrence: ["RRULE:FREQ=MONTHLY;BYMONTHDAY=-1;COUNT=6", "EXDATE;VALUE=DATE:20261031"],
        },
      });
    });

    it("a one-off event and a detached child send NO recurrence field", async () => {
      const connectionId = await insertConnection(db);
      const { event } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
      expect(
        (client.writeCalls[0] as { event: { recurrence?: unknown } }).event.recurrence,
      ).toBeUndefined();
    });

    it("an all-day detached child's originalStartTime.date is the LOCAL date in the recurrence zone, not the UTC date", async () => {
      const connectionId = await insertConnection(db);
      const [parent] = await db
        .insert(events)
        .values({
          title: "All-day weekly",
          timezone: "America/Chicago",
          origin: "local",
          allDay: true,
          startDate: "2026-09-06",
          endDate: "2026-09-06",
          rrule: "FREQ=WEEKLY;BYDAY=SU",
          recurrenceTimezone: "America/Chicago",
        })
        .returning();
      await db.insert(eventExternalLinks).values({
        eventId: parent!.id,
        connectionId,
        googleCalendarId: GOOGLE_CALENDAR_ID,
        googleEventId: "g-allday-master",
        lastSyncedLocalUpdatedAt: parent!.updatedAt,
      });
      // 2026-09-14 02:00Z is 2026-09-13 21:00 in Chicago: the UTC date and the
      // local date DIFFER, which is exactly what toISOString().slice(0, 10)
      // got wrong.
      const originalStartAt = new Date("2026-09-14T02:00:00Z");
      const [child] = await db
        .insert(events)
        .values({
          title: "Moved instance",
          timezone: "America/Chicago",
          origin: "local",
          allDay: true,
          startDate: "2026-09-15",
          endDate: "2026-09-15",
          parentEventId: parent!.id,
          originalStartAt,
        })
        .returning();
      await db.insert(eventExternalLinks).values({
        eventId: child!.id,
        connectionId,
        googleCalendarId: GOOGLE_CALENDAR_ID,
        googleEventId: null,
        syncStatus: "pending_push",
      });

      const client = createFakeGoogleCalendarClient();
      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: child!.id })]);

      expect(client.writeCalls[0]).toMatchObject({
        kind: "insert",
        event: {
          recurringEventId: "g-allday-master",
          originalStartTime: { date: "2026-09-13" },
        },
      });
      expect(originalStartAt.toISOString().slice(0, 10)).toBe("2026-09-14");
    });

    it("a permanent provider refusal (403, calendar not writable) marks the link error with a closed code and does not retry", async () => {
      const connectionId = await insertConnection(db);
      const { event } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      client.failInsertOnce(403, "forbidden");

      await expect(
        createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]),
      ).resolves.toBeUndefined();

      const after = await readLink(db, event.id);
      expect(after.syncStatus).toBe("error");
      expect(after.lastSyncError).toBe("missing_scope");
      expect(after.googleEventId).toBeNull();
    });

    it("a transient provider failure (503) is rethrown so pg-boss retries, and the link stays pending_push", async () => {
      const connectionId = await insertConnection(db);
      const { event } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      client.failInsertOnce(503);

      await expect(
        createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]),
      ).rejects.toThrow();
      const after = await readLink(db, event.id);
      expect(after.syncStatus).toBe("pending_push");
    });

    it("RACE-SAFE final write: an edit landing mid-push keeps the link pending_push, stores the provider id anyway, and baselines on the PRE-edit updated_at", async () => {
      const connectionId = await insertConnection(db);
      const { event, link } = await insertLinkedEvent(db, connectionId);
      const client = createFakeGoogleCalendarClient();
      const realInsert = client.insertEvent.bind(client);
      // What PATCH /events/:id does in its own transaction while the provider
      // call is in flight: bump the event, set the link pending_push, bump the
      // link's updated_at.
      client.insertEvent = async (token, calendarId, body) => {
        const written = await realInsert(token, calendarId, body);
        await db
          .update(events)
          .set({ title: "Edited mid-push", updatedAt: new Date(Date.now() + 1000) })
          .where(eq(events.id, event.id));
        await db
          .update(eventExternalLinks)
          .set({ syncStatus: "pending_push", updatedAt: new Date(Date.now() + 1000) })
          .where(eq(eventExternalLinks.id, link.id));
        return written;
      };

      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);

      const after = await readLink(db, event.id);
      // Ids stored unconditionally ...
      expect(after.googleEventId).toBe(desiredGoogleEventId(link.id));
      expect(after.googleEtag).not.toBeNull();
      // ... but the flip did not happen: the edit's durable intent survives.
      expect(after.syncStatus).toBe("pending_push");
      // Baseline is the version that was actually pushed, older than the edit,
      // so inbound sync sees "local changed" and local wins.
      expect(after.lastSyncedLocalUpdatedAt?.getTime()).toBe(event.updatedAt.getTime());
      const [edited] = await db.select().from(events).where(eq(events.id, event.id));
      expect(edited!.updatedAt.getTime()).toBeGreaterThan(
        after.lastSyncedLocalUpdatedAt!.getTime(),
      );

      // A second push now sends the edit and flips.
      await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
      const final = await readLink(db, event.id);
      expect(final.syncStatus).toBe("synced");
      expect(client.writeCalls.map((c) => c.kind)).toEqual(["insert", "update"]);
      expect(client.remoteEvents.size).toBe(1);
    });

    it("RACE-SAFE final write on the CalDAV branch too", async () => {
      const pwSecret = encryptSecret("fake-password", env.CREDENTIALS_ENCRYPTION_KEY);
      const [conn] = await db
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
      const [eventRow] = await db
        .insert(events)
        .values({
          title: "CalDAV local",
          timezone: "America/Chicago",
          origin: "local",
          startsAt: new Date("2026-08-25T14:00:00.000Z"),
          endsAt: new Date("2026-08-25T15:00:00.000Z"),
        })
        .returning();
      const [link] = await db
        .insert(eventExternalLinks)
        .values({
          eventId: eventRow!.id,
          connectionId: conn!.id,
          caldavCalendarUrl: "/calendars/users/testuser/personal/",
          syncStatus: "pending_push",
        })
        .returning();
      const fakeCalDav = (await import("@personal-os/calendar-providers")).createFakeCalDavClient();
      const realPut = fakeCalDav.putEvent.bind(fakeCalDav);
      fakeCalDav.putEvent = async (...args) => {
        const res = await realPut(...args);
        await db
          .update(eventExternalLinks)
          .set({ syncStatus: "pending_push", updatedAt: new Date(Date.now() + 1000) })
          .where(eq(eventExternalLinks.id, link!.id));
        return res;
      };
      const handler = createCalendarPushEventHandler(
        db,
        createFakeGoogleCalendarClient(),
        fakeCalDav,
      );
      await handler([fakeJob({ eventId: eventRow!.id })]);

      const after = await readLink(db, eventRow!.id);
      expect(after.caldavResourceUrl).not.toBeNull();
      expect(after.caldavEtag).not.toBeNull();
      expect(after.syncStatus).toBe("pending_push");
    });

    describe("needs_reauth goes through the ONE shared transition (ADR-058 key minted once per episode)", () => {
      let boss: { send: ReturnType<typeof vi.fn> };
      let sink: LogRecord[];
      let restore: () => void;

      beforeEach(() => {
        boss = { send: vi.fn() };
        sink = [];
        restore = setLogSink({ write: (_level, record) => sink.push(record) });
      });
      afterEach(() => {
        restore();
        vi.unstubAllGlobals();
      });

      async function insertExpiredConnection(): Promise<string> {
        const refreshSecret = encryptSecret("fake-refresh-token", env.CREDENTIALS_ENCRYPTION_KEY);
        const [row] = await db
          .insert(calendarConnections)
          .values({
            provider: "google",
            googleAccountEmail: "user@example.com",
            googleAccountId: `account-${Math.random()}`,
            refreshTokenCiphertext: refreshSecret.ciphertext,
            refreshTokenIv: refreshSecret.iv,
            refreshTokenAuthTag: refreshSecret.authTag,
            accessTokenExpiresAt: new Date(Date.now() - 60_000),
            grantedScope: "https://www.googleapis.com/auth/calendar",
            status: "active",
          })
          .returning({ id: calendarConnections.id });
        return row!.id;
      }

      function alertKeys(): string[] {
        return boss.send.mock.calls
          .map((call) => call[1] as { dedupeKey?: string; category?: string })
          .filter((payload) => payload.category === "alert")
          .map((payload) => payload.dedupeKey ?? "");
      }

      it("push-event's permanent OAuth failure mints the SAME key the refresh-token job would, and a second failure does not re-stamp updated_at", async () => {
        const connectionId = await insertExpiredConnection();
        await db.insert(devices).values({
          name: "Device",
          platform: "android",
          tokenHash: "hash-reauth",
          pushToken: "ExponentPushToken[x]",
          notifyAlerts: true,
          notificationsEnabled: true,
        });
        const { event } = await insertLinkedEvent(db, connectionId);
        vi.stubGlobal(
          "fetch",
          vi
            .fn()
            .mockImplementation(() =>
              Promise.resolve(
                new Response(JSON.stringify({ error: "invalid_grant" }), { status: 400 }),
              ),
            ),
        );

        const push = createCalendarPushEventHandler(
          db,
          createFakeGoogleCalendarClient(),
          undefined,
          boss as unknown as PgBoss,
        );
        await push([fakeJob({ eventId: event.id })]);

        const [afterFirst] = await db
          .select()
          .from(calendarConnections)
          .where(eq(calendarConnections.id, connectionId));
        expect(afterFirst?.status).toBe("needs_reauth");
        expect(afterFirst?.lastSyncError).toBe("auth_expired");
        const keysAfterFirst = alertKeys();
        expect(keysAfterFirst).toHaveLength(1);
        const key = keysAfterFirst[0]!;
        expect(key).toBe(
          `calendar-needs-reauth:${connectionId}:${afterFirst!.updatedAt.toISOString()}`,
        );

        // Second push failure on the same episode: same key, untouched timestamp.
        await push([fakeJob({ eventId: event.id })]);
        const [afterSecond] = await db
          .select()
          .from(calendarConnections)
          .where(eq(calendarConnections.id, connectionId));
        expect(afterSecond!.updatedAt.getTime()).toBe(afterFirst!.updatedAt.getTime());
        expect(new Set(alertKeys())).toEqual(new Set([key]));

        // And the refresh-token job, observing the same episode, derives the
        // identical key -- one episode, one key, whichever job sees it.
        const refresh = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);
        await refresh([
          { id: "job-r", name: "calendar.google.refresh-token", data: { connectionId } } as never,
        ]);
        expect(new Set(alertKeys())).toEqual(new Set([key]));

        // Nothing provider-authored reached a log line.
        for (const record of sink) {
          expect(JSON.stringify(record)).not.toContain("invalid_grant");
        }
      });
    });

    describe("dead-letter handler", () => {
      let boss: { send: ReturnType<typeof vi.fn> };
      let sink: LogRecord[];
      let restore: () => void;

      beforeEach(() => {
        boss = { send: vi.fn() };
        sink = [];
        restore = setLogSink({ write: (_level, record) => sink.push(record) });
      });
      afterEach(() => restore());

      async function insertEligibleDevice(): Promise<void> {
        await db.insert(devices).values({
          name: "Device",
          platform: "android",
          tokenHash: `hash-${Math.random()}`,
          pushToken: "ExponentPushToken[x]",
          notifyAlerts: true,
          notificationsEnabled: true,
        });
      }

      it("flips a pending_push link to error/retries_exhausted WITHOUT bumping updated_at, and alerts with the episode-scoped key", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        await insertEligibleDevice();
        const handler = createCalendarPushEventDeadLetterHandler(db, boss as unknown as PgBoss);

        await handler([fakeJob({ eventId: event.id })]);

        const after = await readLink(db, event.id);
        expect(after.syncStatus).toBe("error");
        expect(after.lastSyncError).toBe("retries_exhausted");
        expect(after.updatedAt.getTime()).toBe(link.updatedAt.getTime());

        expect(boss.send).toHaveBeenCalledTimes(1);
        const [queue, payload] = boss.send.mock.calls[0] as [string, Record<string, unknown>];
        expect(queue).toBe("notifications.dispatch");
        expect(payload["category"]).toBe("alert");
        expect(payload["dedupeKey"]).toBe(
          `calendar.push-event.dead:${event.id}:${link.updatedAt.toISOString()}`,
        );
        expect(payload["body"]).toBe(
          "A calendar event could not be synced. Open it in Personal OS and edit it to retry.",
        );
        expect(JSON.stringify(payload)).not.toContain("Local event");
        expect(payload["data"]).toEqual({ eventId: event.id, linkId: link.id });

        const line = sink.find((r) => r["event"] === "calendar.push_event.dead_letter");
        expect(line).toBeDefined();
        expect(line).toMatchObject({ alert: "sent", deviceCount: 1 });
        expect(JSON.stringify(line)).not.toContain("Local event");
      });

      it("never overwrites a link that is no longer pending_push, and alerts nobody", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(
          db,
          connectionId,
          {},
          {
            googleEventId: "g-1",
            syncStatus: "synced",
          },
        );
        await insertEligibleDevice();
        await createCalendarPushEventDeadLetterHandler(
          db,
          boss as unknown as PgBoss,
        )([fakeJob({ eventId: event.id })]);
        const after = await readLink(db, event.id);
        expect(after.syncStatus).toBe("synced");
        expect(after.lastSyncError).toBeNull();
        expect(boss.send).not.toHaveBeenCalled();
        expect(sink.some((r) => r["event"] === "calendar.push_event.dead_letter_skipped")).toBe(
          true,
        );
      });

      it("a redelivered dead job derives the same key and, once a dispatch row exists, enqueues nothing more", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        await insertEligibleDevice();
        const handler = createCalendarPushEventDeadLetterHandler(db, boss as unknown as PgBoss);
        const key = `calendar.push-event.dead:${event.id}:${link.updatedAt.toISOString()}`;

        // The dispatch job claims `<key>:<deviceId>`; model that claim.
        await db.insert(notificationDispatchLog).values({
          dedupeKey: `${key}:some-device`,
          status: "accepted",
        });
        // Redelivery: the row is now `error`, so the handler skips -- but even a
        // still-pending row would find the claim and not re-enqueue.
        await db
          .update(eventExternalLinks)
          .set({ syncStatus: "pending_push" })
          .where(eq(eventExternalLinks.id, link.id));
        await handler([fakeJob({ eventId: event.id })]);
        expect(boss.send).not.toHaveBeenCalled();
        const line = sink.find((r) => r["event"] === "calendar.push_event.dead_letter");
        expect(line).toMatchObject({ alert: "already_attempted", dedupeKey: key });
      });

      it("a PATCH that re-armed the link between the read and the flip is a NEW episode: no flip, no alert (second-round review)", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        await insertEligibleDevice();
        // Model the interleaving: the dead handler's read sees the old
        // `updated_at`; by the time it flips, an edit has bumped it.
        const handler = createCalendarPushEventDeadLetterHandler(db, {
          send: () => Promise.reject(new Error("send must not be reached")),
        } as unknown as PgBoss);
        const original = db.select.bind(db);
        let bumped = false;
        vi.spyOn(db, "select").mockImplementation(((...args: unknown[]) => {
          const q = (original as unknown as (...a: unknown[]) => unknown)(...args) as {
            from: (...a: unknown[]) => { where: (...a: unknown[]) => Promise<unknown[]> };
          };
          const from = q.from.bind(q);
          q.from = (...fa: unknown[]) => {
            const w = from(...fa);
            const where = w.where.bind(w);
            w.where = async (...wa: unknown[]) => {
              const rows = await where(...wa);
              if (!bumped) {
                bumped = true;
                await db
                  .update(eventExternalLinks)
                  .set({ syncStatus: "pending_push", updatedAt: new Date(Date.now() + 5000) })
                  .where(eq(eventExternalLinks.id, link.id));
              }
              return rows;
            };
            return w;
          };
          return q;
        }) as never);
        try {
          await handler([fakeJob({ eventId: event.id })]);
        } finally {
          vi.restoreAllMocks();
        }
        const after = await readLink(db, event.id);
        expect(after.syncStatus).toBe("pending_push");
        expect(after.lastSyncError).toBeNull();
        expect(sink.some((r) => r["event"] === "calendar.push_event.dead_letter")).toBe(false);
        const skipped = sink.find((r) => r["event"] === "calendar.push_event.dead_letter_skipped");
        expect(skipped).toMatchObject({ reason: "not_pending" });
      });

      it("with no eligible device the exhaustion is still recorded in the log with alert: no_targets", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId);
        await createCalendarPushEventDeadLetterHandler(
          db,
          boss as unknown as PgBoss,
        )([fakeJob({ eventId: event.id })]);
        expect(boss.send).not.toHaveBeenCalled();
        const line = sink.find((r) => r["event"] === "calendar.push_event.dead_letter");
        expect(line).toMatchObject({ alert: "no_targets", deviceCount: 0 });
        expect((await readLink(db, event.id)).syncStatus).toBe("error");
      });

      it("a failing alert enqueue rolls the flip back so a redelivery records AND alerts (fixer review, MINOR-2)", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        await insertEligibleDevice();
        boss.send.mockRejectedValueOnce(new Error("pg-boss down SECRET"));
        const handler = createCalendarPushEventDeadLetterHandler(db, boss as unknown as PgBoss);

        // Before the fix the flip committed first, so this attempt recorded
        // `error/retries_exhausted` and the alert was lost for ever.
        await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();
        const between = await readLink(db, event.id);
        expect(between.syncStatus).toBe("pending_push");
        expect(between.lastSyncError).toBeNull();
        const deferred = sink.find(
          (r) => r["event"] === "calendar.push_event.dead_letter_deferred",
        );
        expect(deferred).toBeDefined();
        expect(JSON.stringify(deferred)).not.toContain("SECRET");

        // Redelivery: same key, and now both halves land.
        await handler([fakeJob({ eventId: event.id })]);
        const after = await readLink(db, event.id);
        expect(after.syncStatus).toBe("error");
        expect(after.lastSyncError).toBe("retries_exhausted");
        expect(after.updatedAt.getTime()).toBe(link.updatedAt.getTime());
        const alerts = boss.send.mock.calls.filter(
          (c) => (c[1] as { category?: string }).category === "alert",
        );
        expect(alerts).toHaveLength(2); // one rejected, one accepted
        expect((alerts[1]![1] as { dedupeKey: string }).dedupeKey).toBe(
          `calendar.push-event.dead:${event.id}:${link.updatedAt.toISOString()}`,
        );
      });
    });

    describe("fixer review findings", () => {
      it("MAJOR-A: archiving after a LOST insert deletes the remote event at the link-derived id, leaving zero remote events", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        const client = createFakeGoogleCalendarClient();
        const handler = createCalendarPushEventHandler(db, client);
        const timeout = Object.assign(new Error("timeout"), { name: "TimeoutError" });
        client.queueInsertFailure({ error: timeout, afterRemoteWrite: true });
        await expect(handler([fakeJob({ eventId: event.id })])).rejects.toThrow();
        expect(client.remoteEvents.size).toBe(1);
        expect((await readLink(db, event.id)).googleEventId).toBeNull();

        // The owner archives before the retry runs.
        await db.update(events).set({ archivedAt: new Date() }).where(eq(events.id, event.id));
        await handler([fakeJob({ eventId: event.id })]);

        expect(client.writeCalls.at(-1)).toEqual({
          kind: "delete",
          calendarId: GOOGLE_CALENDAR_ID,
          eventId: desiredGoogleEventId(link.id),
        });
        expect(client.remoteEvents.size).toBe(0);
        expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
      });

      it("MAJOR-A: archiving a never-inserted link tolerates the 404 and still unlinks", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId, { archivedAt: new Date() });
        const client = createFakeGoogleCalendarClient();
        client.queueDeleteFailure(new GoogleCalendarApiError("gone", 404, "notFound"));
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        expect(client.writeCalls.map((c) => c.kind)).toEqual(["delete"]);
        expect(await db.select().from(eventExternalLinks)).toHaveLength(0);
      });

      it("MAJOR-B: an inactive connection leaves the link pending_push (no terminal connection_inactive), and the push completes once it is active again", async () => {
        const connectionId = await insertConnection(db);
        await db
          .update(calendarConnections)
          .set({ status: "needs_reauth" })
          .where(eq(calendarConnections.id, connectionId));
        const { event } = await insertLinkedEvent(db, connectionId);
        const client = createFakeGoogleCalendarClient();
        const handler = createCalendarPushEventHandler(db, client);
        const sink: LogRecord[] = [];
        const restore = setLogSink({ write: (_level, record) => sink.push(record) });
        try {
          await handler([fakeJob({ eventId: event.id })]);
        } finally {
          restore();
        }
        const between = await readLink(db, event.id);
        expect(between.syncStatus).toBe("pending_push");
        expect(between.lastSyncError).toBeNull();
        expect(client.writeCalls).toHaveLength(0);
        expect(sink.find((r) => r["event"] === "calendar.push_event.skipped")).toMatchObject({
          reason: "connection_inactive",
          connectionStatus: "needs_reauth",
        });

        await db
          .update(calendarConnections)
          .set({ status: "active" })
          .where(eq(calendarConnections.id, connectionId));
        await handler([fakeJob({ eventId: event.id })]);
        expect((await readLink(db, event.id)).syncStatus).toBe("synced");
      });

      it("MAJOR-E: a recurring master sends start/end timeZone = recurrence_timezone, not the event's own zone", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId, {
          timezone: "Europe/Berlin",
          recurrenceTimezone: "America/Chicago",
          rrule: "FREQ=WEEKLY;BYDAY=MO",
          recurrenceExdates: ["2026-09-21"],
        });
        const client = createFakeGoogleCalendarClient();
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        const first = client.writeCalls[0]!;
        if (first.kind === "delete") throw new Error("unreachable");
        const body = first.event as {
          start: { timeZone: string };
          end: { timeZone: string };
          recurrence: string[];
        };
        expect(body.start.timeZone).toBe("America/Chicago");
        expect(body.end.timeZone).toBe("America/Chicago");
        expect(body.recurrence[1]).toMatch(/^EXDATE;TZID=America\/Chicago:/);
      });

      it("MAJOR-E: a one-off keeps its own zone", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId, { timezone: "Europe/Berlin" });
        const client = createFakeGoogleCalendarClient();
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        const first = client.writeCalls[0]!;
        if (first.kind === "delete") throw new Error("unreachable");
        const body = first.event as { start: { timeZone: string } };
        expect(body.start.timeZone).toBe("Europe/Berlin");
      });

      it("MINOR-1: a 409 whose reason is NOT duplicate is rethrown (retried), never resolved into an update", async () => {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId);
        const client = createFakeGoogleCalendarClient();
        client.failInsertOnce(409, "requiredAccessLevel");
        await expect(
          createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]),
        ).rejects.toThrow();
        expect(client.writeCalls.map((c) => c.kind)).toEqual(["insert"]);
        const after = await readLink(db, event.id);
        expect(after.syncStatus).toBe("pending_push");
        expect(after.googleEventId).toBeNull();
      });

      it("MINOR-1: a 409 with no reason at all still falls through to the update", async () => {
        const connectionId = await insertConnection(db);
        const { event, link } = await insertLinkedEvent(db, connectionId);
        const client = createFakeGoogleCalendarClient();
        client.failInsertOnce(409);
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        expect(client.writeCalls.map((c) => c.kind)).toEqual(["insert", "update"]);
        expect((await readLink(db, event.id)).googleEventId).toBe(desiredGoogleEventId(link.id));
      });
    });

    it("every log line the push job emits carries ids/counts/tokens only -- no title, location or provider text", async () => {
      const sink: LogRecord[] = [];
      const restore = setLogSink({ write: (_level, record) => sink.push(record) });
      try {
        const connectionId = await insertConnection(db);
        const { event } = await insertLinkedEvent(db, connectionId, {
          title: "Dentist appointment SECRET-TITLE",
          location: "123 Main St SECRET-LOCATION",
        });
        const client = createFakeGoogleCalendarClient();
        client.failInsertOnce(403, "forbidden");
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        await createCalendarPushEventHandler(db, client)([fakeJob({ eventId: event.id })]);
        expect(sink.length).toBeGreaterThan(0);
        const text = JSON.stringify(sink);
        expect(text).not.toContain("SECRET-TITLE");
        expect(text).not.toContain("SECRET-LOCATION");
        expect(text).not.toContain("fake insert HTTP");
        for (const record of sink) {
          expect(record["event"]).toMatch(/^calendar\.push_event\./);
        }
      } finally {
        restore();
      }
    });

    it("the conditional flip compares updated_at at full precision (a microsecond-bearing row still flips)", async () => {
      const connectionId = await insertConnection(db);
      const { event, link } = await insertLinkedEvent(db, connectionId);
      // Force a sub-millisecond updated_at, the shape defaultNow() produces.
      await db
        .update(eventExternalLinks)
        .set({ updatedAt: sql`'2026-09-14T10:00:00.123456Z'::timestamptz` })
        .where(eq(eventExternalLinks.id, link.id));
      await createCalendarPushEventHandler(
        db,
        createFakeGoogleCalendarClient(),
      )([fakeJob({ eventId: event.id })]);
      expect((await readLink(db, event.id)).syncStatus).toBe("synced");
    });
  });
});
