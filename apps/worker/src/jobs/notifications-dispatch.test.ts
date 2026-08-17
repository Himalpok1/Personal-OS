import { devices, notificationDispatchLog, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import type { NotificationsDispatchJobData } from "./notifications-dispatch.js";

const { sendPushNotificationsAsyncMock } = vi.hoisted(() => ({
  sendPushNotificationsAsyncMock: vi.fn(),
}));

vi.mock("expo-server-sdk", () => ({
  // A regular function, not an arrow function -- notifications-dispatch.ts
  // calls `new Expo()`, and an arrow function can't be invoked with `new`
  // (it has no [[Construct]] internal method), which fails at module-load
  // time with "is not a constructor".
  Expo: vi.fn().mockImplementation(function Expo() {
    return { sendPushNotificationsAsync: sendPushNotificationsAsyncMock };
  }),
}));

const { createNotificationsDispatchDeadLetterHandler, createNotificationsDispatchHandler } =
  await import("./notifications-dispatch.js");

function fakeJob(data: NotificationsDispatchJobData): Job<NotificationsDispatchJobData> {
  return { id: "job-1", name: "notifications.dispatch", data } as Job<NotificationsDispatchJobData>;
}

async function insertDevice(
  db: Db,
  overrides: Partial<typeof devices.$inferInsert> = {},
): Promise<string> {
  const [row] = await db
    .insert(devices)
    .values({
      name: "Test device",
      platform: "android",
      tokenHash: `hash-${Math.random()}`,
      pushToken: "ExponentPushToken[abc]",
      notifyConfirmations: true,
      notifyAlerts: true,
      notifyDigests: true,
      ...overrides,
    })
    .returning({ id: devices.id });
  return row!.id;
}

async function dispatchLogRow(db: Db, dedupeKey: string) {
  const [row] = await db
    .select()
    .from(notificationDispatchLog)
    .where(eq(notificationDispatchLog.dedupeKey, dedupeKey));
  return row;
}

describe("notifications.dispatch", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    sendPushNotificationsAsyncMock.mockReset();
  });

  it("accepts: a successful ticket marks the dispatch row 'accepted' with the Expo ticket id", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: "ok", id: "receipt-1" }]);

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-1",
      }),
    ]);

    const row = await dispatchLogRow(db, `confirmation:inbox-1:${deviceId}`);
    expect(row?.status).toBe("accepted");
    expect(row?.acceptedAt).not.toBeNull();
    expect(row?.expoTicketId).toBe("receipt-1");
  });

  it("DeviceNotRegistered: finalizes as failed and clears the device's push_token, without rethrowing", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([
      { status: "error", message: "not registered", details: { error: "DeviceNotRegistered" } },
    ]);

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-2",
      }),
    ]);

    const row = await dispatchLogRow(db, `confirmation:inbox-2:${deviceId}`);
    expect(row?.status).toBe("failed");
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(device?.pushToken).toBeNull();
  });

  it("other permanent errors (e.g. MessageTooBig) finalize as failed without clearing push_token", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([
      { status: "error", message: "too big", details: { error: "MessageTooBig" } },
    ]);

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-3",
      }),
    ]);

    const row = await dispatchLogRow(db, `confirmation:inbox-3:${deviceId}`);
    expect(row?.status).toBe("failed");
    const [device] = await db.select().from(devices).where(eq(devices.id, deviceId));
    expect(device?.pushToken).toBe("ExponentPushToken[abc]");
  });

  it("a transient error leaves the row 'pending' and rethrows to trigger a retry", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([
      { status: "error", message: "provider error", details: { error: "ProviderError" } },
    ]);

    await expect(
      createNotificationsDispatchHandler(db)([
        fakeJob({
          category: "confirmation",
          title: "t",
          body: "b",
          dedupeKey: "confirmation:inbox-4",
        }),
      ]),
    ).rejects.toThrow();

    const row = await dispatchLogRow(db, `confirmation:inbox-4:${deviceId}`);
    expect(row?.status).toBe("pending");
  });

  it("MessageRateExceeded is transient and triggers pg-boss backoff", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([
      { status: "error", message: "slow down", details: { error: "MessageRateExceeded" } },
    ]);

    await expect(
      createNotificationsDispatchHandler(db)([
        fakeJob({
          category: "confirmation",
          title: "t",
          body: "b",
          dedupeKey: "confirmation:rate-limited",
        }),
      ]),
    ).rejects.toThrow(/transient failure/);

    expect((await dispatchLogRow(db, `confirmation:rate-limited:${deviceId}`))?.status).toBe(
      "pending",
    );
  });

  it("a permanently failed row is terminal and is not claimed again", async () => {
    const deviceId = await insertDevice(db);
    await db.insert(notificationDispatchLog).values({
      dedupeKey: `confirmation:permanent:${deviceId}`,
      status: "failed",
      lastError: "MessageTooBig",
    });

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:permanent",
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it("retries when Expo returns fewer tickets than claimed messages", async () => {
    const firstDeviceId = await insertDevice(db);
    const secondDeviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: "ok", id: "ticket-one" }]);

    await expect(
      createNotificationsDispatchHandler(db)([
        fakeJob({
          category: "confirmation",
          title: "t",
          body: "b",
          dedupeKey: "confirmation:short-response",
        }),
      ]),
    ).rejects.toThrow(/transient failure/);

    const statuses = await Promise.all(
      [firstDeviceId, secondDeviceId].map(async (deviceId) =>
        dispatchLogRow(db, `confirmation:short-response:${deviceId}`),
      ),
    );
    expect(statuses.map((row) => row?.status).sort()).toEqual(["accepted", "pending"]);
    expect(statuses.find((row) => row?.status === "pending")?.lastError).toMatch(/no ticket/);
  });

  it("a network-level failure (sendPushNotificationsAsync throws) leaves the row 'pending' and rethrows", async () => {
    const deviceId = await insertDevice(db);
    sendPushNotificationsAsyncMock.mockRejectedValue(new Error("fetch failed"));

    await expect(
      createNotificationsDispatchHandler(db)([
        fakeJob({
          category: "confirmation",
          title: "t",
          body: "b",
          dedupeKey: "confirmation:inbox-4b",
        }),
      ]),
    ).rejects.toThrow(/fetch failed/);

    const row = await dispatchLogRow(db, `confirmation:inbox-4b:${deviceId}`);
    expect(row?.status).toBe("pending");
  });

  it("a crash-window 'pending' row from a prior attempt is retried on the same key, not skipped", async () => {
    const deviceId = await insertDevice(db);
    await db
      .insert(notificationDispatchLog)
      .values({ dedupeKey: `confirmation:inbox-5:${deviceId}`, status: "pending" });
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: "ok", id: "receipt-5" }]);

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-5",
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).toHaveBeenCalledTimes(1);
    const row = await dispatchLogRow(db, `confirmation:inbox-5:${deviceId}`);
    expect(row?.status).toBe("accepted");
  });

  it("an already-'accepted' row is skipped -- no duplicate send", async () => {
    const deviceId = await insertDevice(db);
    await db.insert(notificationDispatchLog).values({
      dedupeKey: `confirmation:inbox-6:${deviceId}`,
      status: "accepted",
      acceptedAt: new Date(),
    });

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-6",
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it("skips a device that has notifyConfirmations disabled", async () => {
    await insertDevice(db, { notifyConfirmations: false });

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-7",
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it("skips a revoked device", async () => {
    await insertDevice(db, { revokedAt: new Date() });

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-8",
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
  });

  it("can target one device for a diagnostic notification", async () => {
    const targetDeviceId = await insertDevice(db, { pushToken: "ExponentPushToken[target]" });
    await insertDevice(db, { pushToken: "ExponentPushToken[other]" });
    sendPushNotificationsAsyncMock.mockResolvedValue([{ status: "ok", id: "target-ticket" }]);

    await createNotificationsDispatchHandler(db)([
      fakeJob({
        category: "alert",
        title: "test",
        body: "test",
        dedupeKey: "test:one-device",
        deviceId: targetDeviceId,
      }),
    ]);

    expect(sendPushNotificationsAsyncMock).toHaveBeenCalledWith([
      expect.objectContaining({ to: "ExponentPushToken[target]" }),
    ]);
  });

  describe("quiet hours", () => {
    beforeEach(() => {
      // 2026-08-16T15:00:00Z = 10:00 America/Chicago (CDT, UTC-5).
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-16T15:00:00Z"));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("suppresses a confirmation during quiet hours", async () => {
      await insertDevice(db, {
        quietHoursStart: "09:00",
        quietHoursEnd: "17:00",
        quietHoursTimezone: "America/Chicago",
      });

      await createNotificationsDispatchHandler(db)([
        fakeJob({
          category: "confirmation",
          title: "t",
          body: "b",
          dedupeKey: "confirmation:inbox-9",
        }),
      ]);

      expect(sendPushNotificationsAsyncMock).not.toHaveBeenCalled();
    });

    it("never suppresses an alert, even during quiet hours", async () => {
      await insertDevice(db, {
        quietHoursStart: "09:00",
        quietHoursEnd: "17:00",
        quietHoursTimezone: "America/Chicago",
      });
      sendPushNotificationsAsyncMock.mockResolvedValue([{ status: "ok", id: "receipt-alert" }]);

      await createNotificationsDispatchHandler(db)([
        fakeJob({ category: "alert", title: "t", body: "b", dedupeKey: "alert:inbox-10" }),
      ]);

      expect(sendPushNotificationsAsyncMock).toHaveBeenCalledTimes(1);
    });
  });
});

describe("notifications.dispatch dead-letter handler", () => {
  let db: Db;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
  });

  it("finalizes a still-'pending' row matching the dedupeKey prefix as 'failed'", async () => {
    const deviceId = await insertDevice(db);
    await db
      .insert(notificationDispatchLog)
      .values({ dedupeKey: `confirmation:inbox-11:${deviceId}`, status: "pending" });

    await createNotificationsDispatchDeadLetterHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-11",
      }),
    ]);

    const row = await dispatchLogRow(db, `confirmation:inbox-11:${deviceId}`);
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("retries exhausted");
  });

  it("does not touch an already-'accepted' row", async () => {
    const deviceId = await insertDevice(db);
    await db.insert(notificationDispatchLog).values({
      dedupeKey: `confirmation:inbox-12:${deviceId}`,
      status: "accepted",
      acceptedAt: new Date(),
    });

    await createNotificationsDispatchDeadLetterHandler(db)([
      fakeJob({
        category: "confirmation",
        title: "t",
        body: "b",
        dedupeKey: "confirmation:inbox-12",
      }),
    ]);

    const row = await dispatchLogRow(db, `confirmation:inbox-12:${deviceId}`);
    expect(row?.status).toBe("accepted");
  });
});
