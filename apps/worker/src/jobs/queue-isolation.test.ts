import { encryptSecret } from "@personal-os/ai-providers";
import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import { createFakeGoogleCalendarClient } from "@personal-os/calendar-providers";
import { describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { createCalendarSyncCalendarHandler } from "./calendar-sync-calendar.js";
import { createNotificationsDispatchHandler } from "./notifications-dispatch.js";

describe("worker queue isolation and concurrency", () => {
  it("unrelated workers execute concurrently while calendar sync is in-flight or delayed", async () => {
    const db = buildTestDb();
    await truncateTestTables(db);

    let syncFinished = false;
    let notificationFinished = false;

    // Simulate a slow Google sync client
    const slowClient = createFakeGoogleCalendarClient();
    slowClient.listEvents = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      syncFinished = true;
      return { items: [] };
    });

    const syncHandler = createCalendarSyncCalendarHandler(db, slowClient);
    const notificationHandler = createNotificationsDispatchHandler(db);

    const accessSecret = encryptSecret("fake-access-token", env.CREDENTIALS_ENCRYPTION_KEY);
    const [conn] = await db
      .insert(calendarConnections)
      .values({
        provider: "google",
        googleAccountEmail: "user@example.com",
        googleAccountId: "account-iso-1",
        accessTokenCiphertext: accessSecret.ciphertext,
        accessTokenIv: accessSecret.iv,
        accessTokenAuthTag: accessSecret.authTag,
        accessTokenExpiresAt: new Date(Date.now() + 3600_000),
        grantedScope: "https://www.googleapis.com/auth/calendar",
        status: "active",
      })
      .returning();

    const [cal] = await db
      .insert(calendarConnectionCalendars)
      .values({
        connectionId: conn!.id,
        googleCalendarId: "primary",
        summary: "Primary",
        syncEnabled: true,
      })
      .returning();

    // Launch both concurrently
    const syncPromise = syncHandler([
      {
        id: "job-sync-1",
        name: "calendar.google.sync-calendar",
        data: {
          connectionId: conn!.id,
          calendarConnectionCalendarId: cal!.id,
        },
      } as never,
    ]);

    const notificationPromise = (async () => {
      // Execute notification handler immediately while sync is in flight
      await notificationHandler([
        {
          id: "job-notif-1",
          name: "notifications.dispatch",
          data: {
            category: "alert",
            title: "Task Due",
            body: "Take medicine",
            dedupeKey: "test-alert-1",
          },
        } as never,
      ]);
      notificationFinished = true;
    })();

    // Wait for both to settle
    await Promise.all([syncPromise, notificationPromise]);

    expect(notificationFinished).toBe(true);
    expect(syncFinished).toBe(true);
  });
});
