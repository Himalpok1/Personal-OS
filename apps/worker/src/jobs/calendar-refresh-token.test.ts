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

  // =========================================================================
  // OCCURRENCE-SCOPED DEDUPE (Checkpoint 8.1, Lane A)
  //
  // `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no
  // TTL. The old key was `calendar-needs-reauth:${connectionId}` -- scoped to an
  // identity that outlives every failure -- so it burned on the FIRST outage and
  // could never alert again. It did: accepted 2026-08-25, which is why the real
  // failure of 2026-08-31 notified nobody (ADR-057 finding #4).
  //
  // The four cases below are the full contract: occurrence A alerts, a retry of
  // A does not duplicate, recovery re-arms, and occurrence B alerts again with a
  // DIFFERENT key.
  // =========================================================================
  describe("occurrence-scoped alert dedupe", () => {
    async function insertEligibleDevice(suffix: string): Promise<void> {
      await db.insert(devices).values({
        name: `Device ${suffix}`,
        platform: "android",
        tokenHash: `hash-${suffix}`,
        notifyAlerts: true,
        notificationsEnabled: true,
      });
    }

    function stubInvalidGrant(): void {
      // A FRESH Response per call, not a shared one. A Response body can be read
      // exactly once, so `mockResolvedValue(new Response(...))` succeeds on the
      // first refresh and then misclassifies every later one -- which is
      // precisely what this test needs to do twice.
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
    }

    function alertKeys(): string[] {
      return boss.send.mock.calls
        .map((call) => call[1] as { dedupeKey?: string; category?: string })
        .filter((payload) => payload.category === "alert")
        .map((payload) => payload.dedupeKey ?? "");
    }

    it("occurrence A alerts; a RETRY of A produces the SAME key; recovery then occurrence B produces a DIFFERENT key", async () => {
      const connectionId = await insertConnection(db);
      await insertEligibleDevice("1");
      stubInvalidGrant();
      const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);

      // ---- occurrence A -------------------------------------------------
      await handler([fakeJob({ connectionId })]);
      const afterA = alertKeys();
      expect(afterA).toHaveLength(1);
      const keyA = afterA[0]!;
      expect(keyA.startsWith(`calendar-needs-reauth:${connectionId}:`)).toBe(true);

      // ---- retry of A ---------------------------------------------------
      // pg-boss redelivers the SAME job. The connection is already
      // needs_reauth, so the conditional UPDATE matches nothing, `updated_at`
      // is not re-stamped, and the derived key must be byte-identical. That is
      // what makes the re-enqueue safe rather than spammy: the dispatch log
      // dedupes it.
      await handler([fakeJob({ connectionId })]);
      const afterRetry = alertKeys();
      expect(afterRetry).toHaveLength(2);
      expect(afterRetry[1]).toBe(keyA);
      expect(new Set(afterRetry).size).toBe(1);

      // ---- recovery -----------------------------------------------------
      // What a reconnect does: status back to active, error cleared, and a new
      // `updated_at`. Advanced explicitly so the two episodes cannot collide on
      // a same-millisecond timestamp in a fast test.
      await db
        .update(calendarConnections)
        .set({ status: "active", lastSyncError: null, updatedAt: new Date(Date.now() + 5_000) })
        .where(eq(calendarConnections.id, connectionId));

      // ---- occurrence B -------------------------------------------------
      await handler([fakeJob({ connectionId })]);
      const afterB = alertKeys();
      expect(afterB).toHaveLength(3);
      const keyB = afterB[2]!;
      expect(keyB.startsWith(`calendar-needs-reauth:${connectionId}:`)).toBe(true);
      // THE WHOLE POINT: a second, independent outage is notifiable.
      expect(keyB).not.toBe(keyA);
    });

    it("re-enqueues the same key when a retry finds the connection already needs_reauth", async () => {
      // Models the silent, permanent alert loss this lane also fixes: the status
      // UPDATE committed but the enqueue never happened. Before 8.1 the retry
      // hit a bare `continue`, returned normally, and pg-boss marked the job
      // COMPLETE with nobody ever told.
      const connectionId = await insertConnection(db, { status: "needs_reauth" });
      await insertEligibleDevice("2");
      const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);

      await handler([fakeJob({ connectionId })]);

      const keys = alertKeys();
      expect(keys).toHaveLength(1);
      expect(keys[0]!.startsWith(`calendar-needs-reauth:${connectionId}:`)).toBe(true);
    });

    it("does not alert for a connection that is neither active nor needs_reauth", async () => {
      const connectionId = await insertConnection(db, { status: "disconnected" });
      await insertEligibleDevice("3");
      const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);

      await handler([fakeJob({ connectionId })]);

      expect(alertKeys()).toHaveLength(0);
    });

    it("never puts an account email in the alert body", async () => {
      // The body used to interpolate `googleAccountEmail`, making it the only
      // alert in the system carrying a personal identifier -- on a lock screen.
      const connectionId = await insertConnection(db, {
        googleAccountEmail: "secret-address@example.com",
      });
      await insertEligibleDevice("4");
      stubInvalidGrant();
      const handler = createCalendarRefreshTokenHandler(db, boss as unknown as PgBoss);

      await handler([fakeJob({ connectionId })]);

      const payloads = boss.send.mock.calls.map((call) => JSON.stringify(call[1]));
      expect(payloads).toHaveLength(1);
      expect(payloads[0]).not.toContain("secret-address@example.com");
      expect(payloads[0]).not.toContain("@");
    });
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
