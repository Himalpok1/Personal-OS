import { encryptSecret } from "@personal-os/ai-providers";
import { calendarConnections, eventExternalLinks, events, type Db } from "@personal-os/db";
import { sql } from "drizzle-orm";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { PgBoss } from "pg-boss";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { setLogSink } from "../logger.js";
import { CALENDAR_PUSH_EVENT_QUEUE } from "../queue-names.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { REDRIVE_STALE_AFTER_MS, redrivePendingCalendarPushes } from "./calendar-push-redrive.js";

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

async function insertLink(
  db: Db,
  connectionId: string,
  syncStatus: string,
  ageMs: number,
): Promise<string> {
  const [eventRow] = await db
    .insert(events)
    .values({
      title: `Event ${Math.random()}`,
      timezone: "UTC",
      origin: "local",
      startsAt: new Date(),
      endsAt: new Date(),
    })
    .returning({ id: events.id });
  await db.insert(eventExternalLinks).values({
    eventId: eventRow!.id,
    connectionId,
    googleCalendarId: "primary",
    syncStatus,
    updatedAt: new Date(Date.now() - ageMs),
  });
  return eventRow!.id;
}

describe("redrivePendingCalendarPushes", () => {
  let db: Db;
  let boss: { send: ReturnType<typeof vi.fn> };
  let sink: Record<string, unknown>[];
  let restore: () => void;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    boss = { send: vi.fn().mockResolvedValue("job-id") };
    sink = [];
    restore = setLogSink({ write: (_level, record) => sink.push(record) });
  });

  afterEach(() => restore());

  it("re-enqueues only links that have been pending_push for longer than the stale window, keyed on the event id", async () => {
    const connectionId = await insertConnection(db);
    const stale = await insertLink(db, connectionId, "pending_push", REDRIVE_STALE_AFTER_MS + 1000);
    await insertLink(db, connectionId, "pending_push", 10_000); // fresh: probably mid-retry
    await insertLink(db, connectionId, "synced", REDRIVE_STALE_AFTER_MS + 1000);
    await insertLink(db, connectionId, "error", REDRIVE_STALE_AFTER_MS + 1000);
    await insertLink(db, connectionId, "conflict", REDRIVE_STALE_AFTER_MS + 1000);

    const result = await redrivePendingCalendarPushes(db, boss as unknown as PgBoss);

    expect(result).toEqual({ scanned: 1, sent: 1, failed: 0 });
    expect(boss.send).toHaveBeenCalledTimes(1);
    expect(boss.send).toHaveBeenCalledWith(
      CALENDAR_PUSH_EVENT_QUEUE,
      { eventId: stale },
      { singletonKey: stale },
    );
    // Never singletonSeconds (contract §8).
    const options = boss.send.mock.calls[0]![2] as Record<string, unknown>;
    expect(options).not.toHaveProperty("singletonSeconds");
  });

  it("is idempotent: the row is left pending_push, so a second sweep re-sends; a duplicate push is harmless because the push handler is idempotent", async () => {
    const connectionId = await insertConnection(db);
    const stale = await insertLink(db, connectionId, "pending_push", REDRIVE_STALE_AFTER_MS + 1000);
    await redrivePendingCalendarPushes(db, boss as unknown as PgBoss);
    // pg-boss returns null when a send is dropped (a policy that dedupes on
    // singletonKey would do this; the push queue's `standard` policy does
    // not -- see MINOR-7 in calendar-push-redrive.ts). The sweep counts it
    // honestly either way.
    boss.send.mockResolvedValueOnce(null);
    const second = await redrivePendingCalendarPushes(db, boss as unknown as PgBoss);
    expect(second).toEqual({ scanned: 1, sent: 0, failed: 0 });
    expect(boss.send).toHaveBeenLastCalledWith(
      CALENDAR_PUSH_EVENT_QUEUE,
      { eventId: stale },
      { singletonKey: stale },
    );
  });

  it("a failing send is counted, logged as a token, and does not stop the sweep", async () => {
    const connectionId = await insertConnection(db);
    await insertLink(db, connectionId, "pending_push", REDRIVE_STALE_AFTER_MS + 1000);
    await insertLink(db, connectionId, "pending_push", REDRIVE_STALE_AFTER_MS + 2000);
    boss.send.mockRejectedValueOnce(new Error("connection refused: secret-host"));

    const result = await redrivePendingCalendarPushes(db, boss as unknown as PgBoss);
    expect(result).toEqual({ scanned: 2, sent: 1, failed: 1 });
    const text = JSON.stringify(sink);
    expect(text).not.toContain("secret-host");
    expect(sink.some((r) => r["event"] === "calendar.push_redrive.send_failed")).toBe(true);
    expect(sink.find((r) => r["event"] === "calendar.push_redrive.completed")).toMatchObject({
      scanned: 2,
      sent: 1,
      failed: 1,
    });
  });

  it("logs counts only and nothing else, even on an empty sweep", async () => {
    const result = await redrivePendingCalendarPushes(db, boss as unknown as PgBoss);
    expect(result).toEqual({ scanned: 0, sent: 0, failed: 0 });
    expect(boss.send).not.toHaveBeenCalled();
    const line = sink.find((r) => r["event"] === "calendar.push_redrive.completed");
    expect(Object.keys(line ?? {}).sort()).toEqual(
      ["event", "failed", "level", "scanned", "sent", "staleAfterMs", "ts"].sort(),
    );
  });

  it("honours an injected `now` (the cutoff is derived from it, not from the wall clock)", async () => {
    const connectionId = await insertConnection(db);
    await insertLink(db, connectionId, "pending_push", 60_000);
    const future = new Date(Date.now() + REDRIVE_STALE_AFTER_MS);
    const result = await redrivePendingCalendarPushes(db, boss as unknown as PgBoss, future);
    expect(result.scanned).toBe(1);
    // Sanity: the row really is younger than the window by the real clock.
    const [row] = (
      await db.execute(
        sql`select count(*)::int as n from event_external_links where updated_at < now() - interval '5 minutes'`,
      )
    ).rows as { n: number }[];
    expect(row?.n).toBe(0);
  });

  it("the refresh-cron handler in index.ts runs the redrive AND the access-role refresh inside the calendar containment wrapper (fixer review, MINOR-5)", () => {
    const source = readFileSync(path.resolve(import.meta.dirname, "../index.ts"), "utf8");
    const start = source.indexOf("boss.work(\n    CALENDAR_REFRESH_CRON_QUEUE");
    expect(start).toBeGreaterThan(-1);
    const block = source.slice(
      start,
      source.indexOf("boss.schedule(CALENDAR_REFRESH_CRON_QUEUE", start),
    );
    const code = block
      .split("\n")
      .filter((line) => !line.trim().startsWith("//"))
      .join("\n");
    expect(code).toContain("withCalendarJobErrorContainment(CALENDAR_REFRESH_CRON_QUEUE");
    expect(code).toContain("redrivePendingCalendarPushes(db, boss)");
    expect(code).toContain("refreshCalendarAccessRoles(db, googleCalendarClient, boss)");
  });
});
