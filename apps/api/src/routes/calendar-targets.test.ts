// GET /calendar-targets (Checkpoint 9.5): the write-eligibility rule from the
// contract, exercised through the real route against the real database.
// Eligible := sync_enabled AND connection active AND (Google role in
// {owner, writer} OR provider caldav). A NULL Google role is unknown, and
// unknown is not writable.
import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import { CalendarTargetsResponseSchema, type CalendarTarget } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { isWriteEligibleCalendar } from "./calendar-targets.js";

describe("GET /calendar-targets", () => {
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
              serverUrl: `https://caldav-${Math.random()}.example.com`,
              username: "testuser",
              status,
            },
      )
      .returning({ id: calendarConnections.id });
    return connection!.id;
  }

  async function insertCalendar(
    connectionId: string,
    values: {
      googleCalendarId?: string;
      caldavCalendarUrl?: string;
      summary: string;
      syncEnabled?: boolean;
      accessRole?: string | null;
    },
  ): Promise<void> {
    await app.db.insert(calendarConnectionCalendars).values({
      connectionId,
      googleCalendarId: values.googleCalendarId ?? null,
      caldavCalendarUrl: values.caldavCalendarUrl ?? null,
      summary: values.summary,
      syncEnabled: values.syncEnabled ?? true,
      accessRole: values.accessRole ?? null,
    });
  }

  async function targets(): Promise<CalendarTarget[]> {
    const response = await app.inject({ method: "GET", url: "/calendar-targets" });
    expect(response.statusCode).toBe(200);
    return CalendarTargetsResponseSchema.parse(response.json()).items;
  }

  it("returns an empty list when nothing is connected", async () => {
    expect(await targets()).toEqual([]);
  });

  it("lists only owner/writer Google calendars and every sync-enabled CalDAV calendar, in a total order", async () => {
    const google = await insertConnection("google");
    await insertCalendar(google, {
      googleCalendarId: "zeta@g",
      summary: "Zeta",
      accessRole: "writer",
    });
    await insertCalendar(google, {
      googleCalendarId: "primary",
      summary: "Alpha",
      accessRole: "owner",
    });
    await insertCalendar(google, {
      googleCalendarId: "shared@g",
      summary: "Beta",
      accessRole: "reader",
    });
    await insertCalendar(google, {
      googleCalendarId: "busy@g",
      summary: "Busy",
      accessRole: "freeBusyReader",
    });
    await insertCalendar(google, {
      googleCalendarId: "unknown@g",
      summary: "Unknown",
      accessRole: null,
    });
    await insertCalendar(google, {
      googleCalendarId: "off@g",
      summary: "Aardvark (off)",
      accessRole: "owner",
      syncEnabled: false,
    });
    const caldav = await insertConnection("caldav");
    await insertCalendar(caldav, { caldavCalendarUrl: "/cal/personal/", summary: "Personal" });
    await insertCalendar(caldav, {
      caldavCalendarUrl: "/cal/off/",
      summary: "Archive (off)",
      syncEnabled: false,
    });

    const items = await targets();
    expect(items).toEqual([
      {
        connection_id: google,
        provider: "google",
        google_calendar_id: "primary",
        caldav_calendar_url: null,
        summary: "Alpha",
        access_role: "owner",
      },
      {
        connection_id: google,
        provider: "google",
        google_calendar_id: "zeta@g",
        caldav_calendar_url: null,
        summary: "Zeta",
        access_role: "writer",
      },
      {
        connection_id: caldav,
        provider: "caldav",
        google_calendar_id: null,
        caldav_calendar_url: "/cal/personal/",
        summary: "Personal",
        access_role: null,
      },
    ]);
  });

  it("excludes every calendar of a connection that is not active, whatever its role", async () => {
    const reauth = await insertConnection("google", "needs_reauth");
    await insertCalendar(reauth, {
      googleCalendarId: "primary",
      summary: "Owner",
      accessRole: "owner",
    });
    const disconnected = await insertConnection("caldav", "disconnected");
    await insertCalendar(disconnected, { caldavCalendarUrl: "/cal/p/", summary: "Personal" });
    const active = await insertConnection("google");
    await insertCalendar(active, {
      googleCalendarId: "primary",
      summary: "Live",
      accessRole: "owner",
    });

    const items = await targets();
    expect(items.map((item) => item.connection_id)).toEqual([active]);
  });

  it("never carries anything beyond the six contract fields", async () => {
    const google = await insertConnection("google");
    await insertCalendar(google, {
      googleCalendarId: "primary",
      summary: "Alpha",
      accessRole: "owner",
    });
    const [item] = await targets();
    expect(Object.keys(item!).sort()).toEqual([
      "access_role",
      "caldav_calendar_url",
      "connection_id",
      "google_calendar_id",
      "provider",
      "summary",
    ]);
  });

  describe("isWriteEligibleCalendar (the shared rule POST /events applies)", () => {
    const active = {
      status: "active",
      provider: "google",
    } as typeof calendarConnections.$inferSelect;
    const caldavActive = {
      status: "active",
      provider: "caldav",
    } as typeof calendarConnections.$inferSelect;
    const inactive = {
      status: "needs_reauth",
      provider: "google",
    } as typeof calendarConnections.$inferSelect;
    const calendar = (
      overrides: Partial<typeof calendarConnectionCalendars.$inferSelect>,
    ): typeof calendarConnectionCalendars.$inferSelect =>
      ({
        syncEnabled: true,
        accessRole: "owner",
        ...overrides,
      }) as typeof calendarConnectionCalendars.$inferSelect;

    it.each([
      ["owner", true],
      ["writer", true],
      ["reader", false],
      ["freeBusyReader", false],
      ["unknown", false],
      [null, false],
    ])("google role %s -> %s", (accessRole, eligible) => {
      expect(isWriteEligibleCalendar(calendar({ accessRole }), active)).toBe(eligible);
    });

    it("caldav ignores the role; sync_enabled and connection status still gate", () => {
      expect(isWriteEligibleCalendar(calendar({ accessRole: null }), caldavActive)).toBe(true);
      expect(isWriteEligibleCalendar(calendar({ syncEnabled: false }), caldavActive)).toBe(false);
      expect(isWriteEligibleCalendar(calendar({ syncEnabled: false }), active)).toBe(false);
      expect(isWriteEligibleCalendar(calendar({}), inactive)).toBe(false);
    });
  });
});
