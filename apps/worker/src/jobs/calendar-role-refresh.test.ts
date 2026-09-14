import { encryptSecret } from "@personal-os/ai-providers";
import { createFakeGoogleCalendarClient } from "@personal-os/calendar-providers";
import { calendarConnectionCalendars, calendarConnections, type Db } from "@personal-os/db";
import { ENTITY_TITLE_MAX_CHARS } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";
import { refreshCalendarAccessRoles } from "./calendar-role-refresh.js";

type LogRecord = Record<string, unknown>;

async function insertConnection(
  db: Db,
  overrides: Partial<typeof calendarConnections.$inferInsert> = {},
): Promise<string> {
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
      ...overrides,
    })
    .returning({ id: calendarConnections.id });
  return row!.id;
}

async function insertCalendar(
  db: Db,
  connectionId: string,
  googleCalendarId: string,
  accessRole: string | null,
): Promise<string> {
  const [row] = await db
    .insert(calendarConnectionCalendars)
    .values({
      connectionId,
      googleCalendarId,
      summary: googleCalendarId,
      syncEnabled: true,
      accessRole,
    })
    .returning({ id: calendarConnectionCalendars.id });
  return row!.id;
}

// Fixer review, MINOR-5: the worker keeps `access_role` honest between Settings
// visits -- a calendar demoted on Google's side must stop being write-eligible.
describe("refreshCalendarAccessRoles", () => {
  let db: Db;
  let sink: LogRecord[];
  let restore: () => void;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    sink = [];
    restore = setLogSink({ write: (_level, record) => sink.push(record) });
  });
  afterEach(() => {
    restore();
    vi.unstubAllGlobals();
  });

  // Checkpoint 9.6 (ADR-065): the display name is provider-authored, so an
  // over-long one is truncated at write to the shared title bound.
  it("bounds a provider display name at write, surrogate-safely", async () => {
    const connectionId = await insertConnection(db);
    const id = await insertCalendar(db, connectionId, "cal-long", "writer");
    const client = createFakeGoogleCalendarClient({
      calendars: [
        {
          id: "cal-long",
          summary: "n".repeat(ENTITY_TITLE_MAX_CHARS - 1) + "\u{1F600}" + "tail",
          accessRole: "writer",
        },
      ],
    });

    await refreshCalendarAccessRoles(db, client);

    const [row] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, id));
    expect(row?.summary).toHaveLength(ENTITY_TITLE_MAX_CHARS - 1);
    expect(row?.summary.endsWith("n")).toBe(true);
  });

  it("keeps the stored display name when the provider omits `summary` (never writes an empty one)", async () => {
    const connectionId = await insertConnection(db);
    const id = await insertCalendar(db, connectionId, "cal-nameless", "writer");
    await db
      .update(calendarConnectionCalendars)
      .set({ summary: "Kept name" })
      .where(eq(calendarConnectionCalendars.id, id));
    // Google's calendarList may omit `summary`; the client's item type says
    // `string` but passes the absence through. Modelled the way it arrives.
    const client = createFakeGoogleCalendarClient({
      calendars: [
        { id: "cal-nameless", summary: undefined as unknown as string, accessRole: "reader" },
      ],
    });

    await refreshCalendarAccessRoles(db, client);

    const [row] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.id, id));
    expect(row?.summary).toBe("Kept name");
    expect(row?.accessRole).toBe("reader");
  });

  it("updates role + summary on existing rows, NULLs the role of rows absent from the listing, and never inserts", async () => {
    const connectionId = await insertConnection(db);
    const kept = await insertCalendar(db, connectionId, "cal-writer", "writer");
    const demoted = await insertCalendar(db, connectionId, "cal-demoted", "owner");
    const unshared = await insertCalendar(db, connectionId, "cal-unshared", "writer");
    const client = createFakeGoogleCalendarClient({
      calendars: [
        { id: "cal-writer", summary: "Team", accessRole: "writer" },
        { id: "cal-demoted", summary: "Was mine", accessRole: "reader" },
        { id: "cal-new", summary: "Never chosen", accessRole: "owner" },
      ],
    });

    const summary = await refreshCalendarAccessRoles(db, client);
    expect(summary).toEqual({ connections: 1, updated: 2, cleared: 1, failed: 0 });

    const rows = await db.select().from(calendarConnectionCalendars);
    expect(rows).toHaveLength(3); // cal-new was NOT inserted
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get(kept)).toMatchObject({ accessRole: "writer", summary: "Team" });
    expect(byId.get(demoted)).toMatchObject({ accessRole: "reader", summary: "Was mine" });
    expect(byId.get(unshared)).toMatchObject({ accessRole: null, summary: "cal-unshared" });

    const line = sink.find((r) => r["event"] === "calendar.role_refresh.completed");
    expect(line).toMatchObject({ connections: 1, updated: 2, cleared: 1, failed: 0 });
    // Counts only: no calendar id or name in any line.
    expect(JSON.stringify(sink)).not.toContain("cal-");
    expect(JSON.stringify(sink)).not.toContain("Was mine");
  });

  it("an empty listing is treated as a failed pass and clears NOTHING (second-round review)", async () => {
    const connectionId = await insertConnection(db);
    await insertCalendar(db, connectionId, "cal-a", "owner");
    const client = createFakeGoogleCalendarClient({ calendars: [] });
    const summary = await refreshCalendarAccessRoles(db, client);
    expect(summary).toMatchObject({ updated: 0, cleared: 0, failed: 1 });
    const [row] = await db.select().from(calendarConnectionCalendars);
    expect(row?.accessRole).toBe("owner");
  });

  it("skips non-active and CalDAV connections, and one failing connection does not stop the others", async () => {
    const active = await insertConnection(db);
    const inactive = await insertConnection(db, { status: "needs_reauth" });
    const caldav = await insertConnection(db, {
      provider: "caldav",
      googleAccountEmail: null,
      googleAccountId: null,
      serverUrl: "https://caldav.example.com",
      username: "u",
      authType: "basic",
    });
    await insertCalendar(db, active, "cal-a", null);
    await insertCalendar(db, inactive, "cal-b", "owner");
    await db.insert(calendarConnectionCalendars).values({
      connectionId: caldav,
      caldavCalendarUrl: "/cal/",
      summary: "CalDAV",
      syncEnabled: true,
      accessRole: null,
    });
    const client = createFakeGoogleCalendarClient({
      calendars: [{ id: "cal-a", summary: "A", accessRole: "owner" }],
    });
    const summary = await refreshCalendarAccessRoles(db, client);
    expect(summary).toEqual({ connections: 1, updated: 1, cleared: 0, failed: 0 });
    const [b] = await db
      .select()
      .from(calendarConnectionCalendars)
      .where(eq(calendarConnectionCalendars.connectionId, inactive));
    expect(b?.accessRole).toBe("owner"); // untouched
  });

  it("a listing failure is counted, logged as a token, and does not throw", async () => {
    const connectionId = await insertConnection(db);
    await insertCalendar(db, connectionId, "cal-a", "owner");
    const client = createFakeGoogleCalendarClient();
    client.listCalendars = () => Promise.reject(new Error("boom SECRET-PROSE"));
    const summary = await refreshCalendarAccessRoles(db, client);
    expect(summary).toEqual({ connections: 1, updated: 0, cleared: 0, failed: 1 });
    const [row] = await db.select().from(calendarConnectionCalendars);
    expect(row?.accessRole).toBe("owner"); // nothing cleared on failure
    const line = sink.find((r) => r["event"] === "calendar.role_refresh.connection_failed");
    expect(line).toMatchObject({ connectionId });
    expect(JSON.stringify(sink)).not.toContain("SECRET-PROSE");
  });

  it("a permanent OAuth failure goes through the shared needs_reauth transition and alerts once", async () => {
    const refreshSecret = encryptSecret("fake-refresh-token", env.CREDENTIALS_ENCRYPTION_KEY);
    const connectionId = await insertConnection(db, {
      accessTokenCiphertext: null,
      accessTokenIv: null,
      accessTokenAuthTag: null,
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
      refreshTokenCiphertext: refreshSecret.ciphertext,
      refreshTokenIv: refreshSecret.iv,
      refreshTokenAuthTag: refreshSecret.authTag,
    });
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
    const boss = { send: vi.fn() };
    const summary = await refreshCalendarAccessRoles(
      db,
      createFakeGoogleCalendarClient(),
      boss as unknown as PgBoss,
    );
    expect(summary.failed).toBe(1);
    const [conn] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(conn?.status).toBe("needs_reauth");
    expect(conn?.lastSyncError).toBe("auth_expired");
    expect(JSON.stringify(sink)).not.toContain("invalid_grant");
  });
});
