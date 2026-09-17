// Canvas invalid-token alerting (Checkpoint 10.4, ADR-073).
//
// Before this checkpoint there was NO Canvas alert producer at all: a dead PAT
// flipped `canvas_connections.status` to `invalid_token` (Checkpoint 10.2) and
// the Settings screen's own status rendering was the only surface. These
// tests pin the whole contract -- what triggers, what does not, what the key
// looks like across an episode, and what the body is forbidden to carry --
// mirroring apps/worker/src/mail/alerts.test.ts's own coverage shape.
import { canvasConnections, devices, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb } from "../test/build-test-db.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { enqueueCanvasInvalidTokenAlert } from "./alerts.js";
import { seedCanvasConnection, truncateCanvasTestTables } from "./test-fixtures.js";

const db: Db = buildTestDb();
const NOW = new Date("2026-09-16T12:00:00.000Z");

/**
 * Reproduces what `markConnectionInvalidToken` (orchestrate.ts, private to
 * that module) writes on a SECOND consecutive connection-level auth_failed:
 * status flipped, error columns stamped. Written directly here rather than
 * imported -- these tests are about the alert producer, which orchestrate.ts
 * already calls at exactly this point, not about re-deriving the hysteresis
 * that gates it (see orchestrate.test.ts for that contract).
 */
async function markInvalidToken(connectionId: string, at: Date): Promise<void> {
  await db
    .update(canvasConnections)
    .set({
      status: "invalid_token",
      lastSyncError: "auth_failed",
      lastSyncErrorAt: at,
      updatedAt: at,
    })
    .where(eq(canvasConnections.id, connectionId));
}

describe("canvas invalid-token alerting", () => {
  let boss: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await truncateCanvasTestTables(db);
    await db.delete(devices);
    boss = { send: vi.fn() };
  });

  async function insertEligibleDevice(suffix = "1"): Promise<void> {
    await db.insert(devices).values({
      name: `Device ${suffix}`,
      platform: "android",
      tokenHash: `canvas-alert-hash-${suffix}`,
      notifyAlerts: true,
      notificationsEnabled: true,
    });
  }

  function alertPayloads(): { dedupeKey: string; category: string; body: string; title: string }[] {
    return boss.send.mock.calls
      .filter((call) => call[0] === NOTIFICATIONS_DISPATCH_QUEUE)
      .map(
        (call) => call[1] as { dedupeKey: string; category: string; body: string; title: string },
      );
  }

  async function episodeStamp(connectionId: string): Promise<string> {
    const [row] = await db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, connectionId));
    return row!.lastSyncErrorAt!.toISOString();
  }

  it("does NOT alert for an active connection", async () => {
    const { id: connectionId } = await seedCanvasConnection(db);
    await insertEligibleDevice();

    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    expect(alertPayloads()).toHaveLength(0);
  });

  it("does NOT alert a merely-disconnected connection", async () => {
    const { id: connectionId } = await seedCanvasConnection(db, { status: "disconnected" });
    await insertEligibleDevice();

    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    expect(alertPayloads()).toHaveLength(0);
  });

  it("alerts once the connection has entered invalid_token", async () => {
    const { id: connectionId } = await seedCanvasConnection(db);
    await insertEligibleDevice();
    await markInvalidToken(connectionId, NOW);

    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    const payloads = alertPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.category).toBe("alert");
    expect(payloads[0]!.dedupeKey).toBe(
      `canvas-invalid-token:${connectionId}:${await episodeStamp(connectionId)}`,
    );
  });

  it("is occurrence-scoped: A, retry A, recovery, B", async () => {
    // The contract ADR-058 exists to enforce -- the same shape mail's own
    // test pins. `notification_dispatch_log.dedupe_key` is a permanent
    // PRIMARY KEY with no TTL, so a key scoped to the connection id alone
    // fires once in the system's lifetime and is then permanently dead.
    const { id: connectionId } = await seedCanvasConnection(db);
    await insertEligibleDevice();

    // ---- occurrence A -----------------------------------------------------
    await markInvalidToken(connectionId, NOW);
    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);
    const keyA = alertPayloads()[0]!.dedupeKey;

    // ---- retry of A -------------------------------------------------------
    // A retried job (or a second `markConnectionInvalidToken` guarded by
    // `status = 'active'`, which matches nothing once already invalid_token)
    // must derive the SAME episode key.
    const later = new Date(NOW.getTime() + 15 * 60_000);
    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, later);
    const afterRetry = alertPayloads();
    expect(afterRetry).toHaveLength(2);
    expect(afterRetry[1]!.dedupeKey).toBe(keyA);

    // ---- recovery (the 10.1C reconnect path) -------------------------------
    await db
      .update(canvasConnections)
      .set({ status: "active", lastSyncError: null, lastSyncErrorAt: null })
      .where(eq(canvasConnections.id, connectionId));

    // ---- occurrence B -----------------------------------------------------
    const muchLater = new Date(NOW.getTime() + 6 * 3_600_000);
    await markInvalidToken(connectionId, muchLater);
    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, muchLater);
    const afterB = alertPayloads();
    expect(afterB).toHaveLength(3);
    const keyB = afterB[2]!.dedupeKey;
    expect(keyB).toBe(`canvas-invalid-token:${connectionId}:${await episodeStamp(connectionId)}`);
    // THE WHOLE POINT: a second, independent grant loss is notifiable.
    expect(keyB).not.toBe(keyA);
  });

  it("does not alert a revoked, disabled, or opted-out device", async () => {
    const { id: connectionId } = await seedCanvasConnection(db);
    await markInvalidToken(connectionId, NOW);
    await db.insert(devices).values([
      {
        name: "revoked",
        platform: "android",
        tokenHash: "h-r",
        notifyAlerts: true,
        notificationsEnabled: true,
        revokedAt: NOW,
      },
      {
        name: "disabled",
        platform: "android",
        tokenHash: "h-d",
        notifyAlerts: true,
        notificationsEnabled: false,
      },
      {
        name: "opted-out",
        platform: "android",
        tokenHash: "h-o",
        notifyAlerts: false,
        notificationsEnabled: true,
      },
    ]);

    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    expect(alertPayloads()).toHaveLength(0);
  });

  it("carries no base URL, no course/user metadata and no provider prose", async () => {
    // Mirrors ADR-068's own discipline (no institution name or identifier in
    // any Canvas-facing surface) and mail's identical rule under ADR-054/058.
    const { id: connectionId } = await seedCanvasConnection(db, {
      canvasBaseUrl: "https://secret-university.instructure.com",
      canvasUserName: "Secret Student",
    });
    await insertEligibleDevice();
    await markInvalidToken(connectionId, NOW);

    await enqueueCanvasInvalidTokenAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    const raw = JSON.stringify(boss.send.mock.calls[0]![1]);
    expect(raw).not.toContain("secret-university");
    expect(raw).not.toContain("Secret Student");
    // The failure code is operator vocabulary; the owner's question is "what
    // do I do", so not even the closed enum value is interpolated.
    expect(raw).not.toContain("auth_failed");
    expect(alertPayloads()[0]!.title).toBe("Canvas needs reconnecting");
    expect(alertPayloads()[0]!.body).toBe("Assignment sync has stopped. Reconnect it in Settings.");
  });

  it("is a no-op without a queue rather than throwing", async () => {
    const { id: connectionId } = await seedCanvasConnection(db);
    await markInvalidToken(connectionId, NOW);
    await expect(
      enqueueCanvasInvalidTokenAlert(db, null, connectionId, NOW),
    ).resolves.toBeUndefined();
  });

  it("is a no-op for an unknown connection id rather than throwing", async () => {
    await insertEligibleDevice();
    await expect(
      enqueueCanvasInvalidTokenAlert(
        db,
        boss as unknown as PgBoss,
        "00000000-0000-0000-0000-000000000000",
        NOW,
      ),
    ).resolves.toBeUndefined();
    expect(alertPayloads()).toHaveLength(0);
  });
});
