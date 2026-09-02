// Gmail failure alerting (Checkpoint 8.1, Lane C).
//
// Before this checkpoint there was NO Gmail alert producer at all: a Gmail grant
// could fail and the only evidence was a `status` column nobody was told about.
// These tests pin the whole contract -- what triggers, what does not, what the
// key looks like across an episode, and what the body is forbidden to carry.
import { devices, mailConnections, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { seedMailConnection } from "../test/mail-fixtures.js";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { enqueueMailNeedsReauthAlert } from "./alerts.js";
import { markMailConnectionNeedsReauth } from "./token.js";

const db: Db = buildTestDb();
const NOW = new Date("2026-09-02T12:00:00.000Z");

describe("mail needs-reauth alerting", () => {
  let boss: { send: ReturnType<typeof vi.fn> };

  beforeEach(async () => {
    await truncateTestTables(db);
    boss = { send: vi.fn() };
  });

  async function insertEligibleDevice(suffix = "1"): Promise<void> {
    await db.insert(devices).values({
      name: `Device ${suffix}`,
      platform: "android",
      tokenHash: `mail-alert-hash-${suffix}`,
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
      .from(mailConnections)
      .where(eq(mailConnections.id, connectionId));
    return row!.lastSyncErrorAt!.toISOString();
  }

  it("does NOT alert for an active connection", async () => {
    const { id: connectionId } = await seedMailConnection(db);
    await insertEligibleDevice();

    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    expect(alertPayloads()).toHaveLength(0);
  });

  it("alerts once the connection has transitioned to needs_reauth", async () => {
    const { id: connectionId } = await seedMailConnection(db);
    await insertEligibleDevice();
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", NOW);

    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    const payloads = alertPayloads();
    expect(payloads).toHaveLength(1);
    expect(payloads[0]!.category).toBe("alert");
    expect(payloads[0]!.dedupeKey).toBe(
      `mail-needs-reauth:${connectionId}:${await episodeStamp(connectionId)}`,
    );
  });

  it("is occurrence-scoped: A, retry A, recovery, B", async () => {
    // The contract ADR-057 finding #4 exists to enforce.
    // `notification_dispatch_log.dedupe_key` is a permanent PRIMARY KEY with no
    // TTL, so a key scoped to the connection id alone fires once in the
    // system's lifetime and is then permanently dead -- silently.
    const { id: connectionId } = await seedMailConnection(db);
    await insertEligibleDevice();

    // ---- occurrence A -----------------------------------------------------
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", NOW);
    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, NOW);
    const keyA = alertPayloads()[0]!.dedupeKey;

    // ---- retry of A -------------------------------------------------------
    // The transition UPDATE is `status = 'active'`-conditional, so re-running it
    // against an already-needs_reauth row matches NOTHING and does not re-stamp
    // `last_sync_error_at`. The derived key must therefore be byte-identical,
    // which is what makes the re-enqueue safe rather than spammy.
    const later = new Date(NOW.getTime() + 15 * 60_000);
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", later);
    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, later);
    const afterRetry = alertPayloads();
    expect(afterRetry).toHaveLength(2);
    expect(afterRetry[1]!.dedupeKey).toBe(keyA);

    // ---- recovery ---------------------------------------------------------
    await db
      .update(mailConnections)
      .set({ status: "active", lastSyncError: null, lastSyncErrorAt: null })
      .where(eq(mailConnections.id, connectionId));

    // ---- occurrence B -----------------------------------------------------
    const muchLater = new Date(NOW.getTime() + 6 * 3_600_000);
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", muchLater);
    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, muchLater);
    const afterB = alertPayloads();
    expect(afterB).toHaveLength(3);
    const keyB = afterB[2]!.dedupeKey;
    expect(keyB).toBe(`mail-needs-reauth:${connectionId}:${await episodeStamp(connectionId)}`);
    // THE WHOLE POINT: a second, independent grant loss is notifiable.
    expect(keyB).not.toBe(keyA);
  });

  it("does not alert a revoked, disabled, or opted-out device", async () => {
    const { id: connectionId } = await seedMailConnection(db);
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", NOW);
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

    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    expect(alertPayloads()).toHaveLength(0);
  });

  it("carries no address, no mailbox metadata and no provider prose", async () => {
    // ADR-054: no email subject, address or display name may appear in a push
    // body. This producer goes further and carries no mailbox identifier at all
    // -- the body is a fixed literal and `data` holds only the connection uuid.
    const { id: connectionId } = await seedMailConnection(db, {
      externalAccountId: "secret@example.com",
    });
    await insertEligibleDevice();
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", NOW);

    await enqueueMailNeedsReauthAlert(db, boss as unknown as PgBoss, connectionId, NOW);

    const raw = JSON.stringify(boss.send.mock.calls[0]![1]);
    expect(raw).not.toContain("secret@example.com");
    expect(raw).not.toContain("@");
    // The failure code is operator vocabulary; the user's question is "what do
    // I do", so not even the closed enum value is interpolated.
    expect(raw).not.toContain("auth_expired");
    expect(alertPayloads()[0]!.body).toBe("Mail sync has stopped. Reconnect it in Settings.");
  });

  it("is a no-op without a queue rather than throwing", async () => {
    const { id: connectionId } = await seedMailConnection(db);
    await markMailConnectionNeedsReauth(db, connectionId, "auth_expired", NOW);
    await expect(enqueueMailNeedsReauthAlert(db, null, connectionId, NOW)).resolves.toBeUndefined();
  });
});
