import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import { calendarConnections, devices, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { env } from "../env.js";
import {
  createCalendarRefreshTokenDeadLetterHandler,
  createCalendarRefreshTokenHandler,
  enqueueCalendarRefreshForAllActiveConnections,
  type CalendarRefreshTokenJobData,
} from "./calendar-refresh-token.js";

async function insertConnection(
  db: Db,
  overrides: Partial<typeof calendarConnections.$inferInsert> = {},
): Promise<string> {
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
      accessTokenExpiresAt: new Date(Date.now() - 60_000), // already stale
      grantedScope: "https://www.googleapis.com/auth/calendar",
      status: "active",
      ...overrides,
    })
    .returning({ id: calendarConnections.id });
  return row!.id;
}

function fakeJob(data: CalendarRefreshTokenJobData): Job<CalendarRefreshTokenJobData> {
  return {
    id: "job-1",
    name: "calendar.google.refresh-token",
    data,
  } as Job<CalendarRefreshTokenJobData>;
}

describe("calendar.google.refresh-token", () => {
  let db: Db;
  let boss: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    boss = { send: vi.fn() };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes a stale access token and stores it encrypted", async () => {
    const connectionId = await insertConnection(db);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access-token",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);
    await handler([fakeJob({ connectionId })]);

    const [row] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(row?.status).toBe("active");
    expect(row?.accessTokenExpiresAt?.getTime()).toBeGreaterThan(Date.now());
    expect(row?.accessTokenCiphertext).not.toBeNull();
    const decrypted = decryptSecret(
      {
        ciphertext: row!.accessTokenCiphertext!,
        iv: row!.accessTokenIv!,
        authTag: row!.accessTokenAuthTag!,
      },
      env.CREDENTIALS_ENCRYPTION_KEY,
    );
    expect(decrypted).toBe("new-access-token");
  });

  it("skips a connection whose token is still fresh", async () => {
    const connectionId = await insertConnection(db, {
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);
    await handler([fakeJob({ connectionId })]);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("marks the connection needs_reauth on invalid_grant and alerts eligible devices", async () => {
    const connectionId = await insertConnection(db);
    await db.insert(devices).values({
      name: "Test device",
      platform: "android",
      tokenHash: "hash-1",
      notifyAlerts: true,
      notificationsEnabled: true,
    });

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked" }),
        {
          status: 400,
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);
    await handler([fakeJob({ connectionId })]);

    const [row] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(row?.status).toBe("needs_reauth");
    // This assertion previously read `toContain("revoked")` -- i.e. it PINNED
    // the defect: "Token has been revoked" is Google's own error_description,
    // and asserting it survived into the column is asserting the leak works.
    // The column now carries a classification code and nothing else.
    expect(row?.lastSyncError).toBe("auth_expired");
    expect(row?.lastSyncError).not.toContain("revoked");
    expect(row?.lastSyncError).not.toContain("Token");
    expect(boss.send).toHaveBeenCalledTimes(1);
    const [queueName, payload] = boss.send.mock.calls[0] as [string, Record<string, unknown>];
    expect(queueName).toBe("notifications.dispatch");
    expect(payload["category"]).toBe("alert");
  });

  it("rethrows a transient failure so pg-boss retries", async () => {
    const connectionId = await insertConnection(db);
    const fetchMock = vi.fn().mockRejectedValue(new Error("network blip"));
    vi.stubGlobal("fetch", fetchMock);

    const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);
    await expect(handler([fakeJob({ connectionId })])).rejects.toThrow();

    const [row] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(row?.status).toBe("active"); // unchanged -- transient, not terminal
  });

  it("dead-letter handler records exhausted-retries without changing status", async () => {
    const connectionId = await insertConnection(db);
    const handler = createCalendarRefreshTokenDeadLetterHandler(db);
    await handler([fakeJob({ connectionId })]);
    const [row] = await db
      .select()
      .from(calendarConnections)
      .where(eq(calendarConnections.id, connectionId));
    expect(row?.status).toBe("active");
    expect(row?.lastSyncError).toBe("retries_exhausted");
  });

  describe("enqueueCalendarRefreshForAllActiveConnections (provider scoping)", () => {
    async function insertCaldavConnection(
      db: Db,
      overrides: Partial<typeof calendarConnections.$inferInsert> = {},
    ): Promise<string> {
      const [row] = await db
        .insert(calendarConnections)
        .values({
          provider: "caldav",
          serverUrl: "https://caldav.example.com",
          username: "caldav-user",
          authType: "basic",
          status: "active",
          ...overrides,
        })
        .returning({ id: calendarConnections.id });
      return row!.id;
    }

    it("enqueues an active google connection", async () => {
      const connectionId = await insertConnection(db);
      await enqueueCalendarRefreshForAllActiveConnections(
        db,
        boss as unknown as PgBoss,
        "calendar.google.refresh-token",
      );
      expect(boss.send).toHaveBeenCalledWith("calendar.google.refresh-token", { connectionId });
    });

    it("does not enqueue an active caldav connection", async () => {
      await insertCaldavConnection(db);
      await enqueueCalendarRefreshForAllActiveConnections(
        db,
        boss as unknown as PgBoss,
        "calendar.google.refresh-token",
      );
      expect(boss.send).not.toHaveBeenCalled();
    });

    it("never changes a caldav connection's status via the google refresh cron", async () => {
      const connectionId = await insertCaldavConnection(db);
      await enqueueCalendarRefreshForAllActiveConnections(
        db,
        boss as unknown as PgBoss,
        "calendar.google.refresh-token",
      );
      // Enqueue is a no-op for CalDAV (previous assertion), so the handler
      // never runs against this row -- confirm it stays exactly as inserted.
      const [row] = await db
        .select()
        .from(calendarConnections)
        .where(eq(calendarConnections.id, connectionId));
      expect(row?.status).toBe("active");
      expect(row?.lastSyncError).toBeNull();
    });
  });
});
