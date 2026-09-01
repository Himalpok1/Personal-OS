import type { Db } from "@personal-os/db";
import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { buildTestDb } from "../test/build-test-db.js";
import { HEALTH_SYNC_LOCK_NAMESPACE } from "../health/lock.js";
import { MAIL_SYNC_LOCK_NAMESPACE, withMailConnectionLock } from "./lock.js";

const db: Db = buildTestDb();

const CONNECTION = "11111111-2222-3333-4444-555555555555";
const OTHER = "66666666-7777-8888-9999-000000000000";

async function heldLockCount(): Promise<number> {
  const result = await db.execute(
    sql`select count(*)::int as n from pg_locks
        where locktype = 'advisory' and classid = ${MAIL_SYNC_LOCK_NAMESPACE}`,
  );
  return (result as unknown as { rows: { n: number }[] }).rows[0]!.n;
}

afterAll(async () => {
  await db.$client.end();
});

describe("withMailConnectionLock", () => {
  it("runs the callback and reports acquisition", async () => {
    const outcome = await withMailConnectionLock(db, CONNECTION, () => Promise.resolve("done"));
    expect(outcome).toEqual({ acquired: true, result: "done" });
  });

  it("releases the lock afterwards, so a second pass can take it", async () => {
    await withMailConnectionLock(db, CONNECTION, () => Promise.resolve(null));
    expect(await heldLockCount()).toBe(0);

    const second = await withMailConnectionLock(db, CONNECTION, () => Promise.resolve("again"));
    expect(second.acquired).toBe(true);
  });

  it("refuses a CONCURRENT pass for the same connection", async () => {
    // The property the whole module exists for. Two passes reading the same
    // historyId, each writing back the cursor it ended on, can leave the STALE
    // one last -- so the newer pass's progress is silently undone and the same
    // delta is replayed every tick.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withMailConnectionLock(db, CONNECTION, async () => {
      await held;
      return "first";
    });

    // Give the first acquire a turn to land before contending.
    await new Promise((resolve) => setTimeout(resolve, 50));
    const second = await withMailConnectionLock(db, CONNECTION, () => Promise.resolve("second"));

    expect(second).toEqual({ acquired: false });
    release();
    expect(await first).toEqual({ acquired: true, result: "first" });
  });

  it("does NOT block a different connection", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const first = withMailConnectionLock(db, CONNECTION, async () => {
      await held;
      return null;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const other = await withMailConnectionLock(db, OTHER, () => Promise.resolve("other"));
    expect(other).toEqual({ acquired: true, result: "other" });

    release();
    await first;
  });

  it("releases the lock when the callback THROWS", async () => {
    await expect(
      withMailConnectionLock(db, CONNECTION, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    // A lock leaked on the failure path is permanent and silent: every later
    // pass for this connection would skip forever with no error anywhere.
    expect(await heldLockCount()).toBe(0);
    expect((await withMailConnectionLock(db, CONNECTION, () => Promise.resolve(1))).acquired).toBe(
      true,
    );
  });

  it("uses a DIFFERENT namespace from the health lock", () => {
    // Not cosmetic. `hashtext` is 32-bit, so a mail connection uuid and a health
    // connection uuid can collide -- and sharing the namespace would let a
    // health pass block a mail pass, intermittently, with no way to tell from
    // either side. This is why the module is a near-copy rather than a call
    // into health/lock.ts.
    expect(MAIL_SYNC_LOCK_NAMESPACE).not.toBe(HEALTH_SYNC_LOCK_NAMESPACE);
    expect(MAIL_SYNC_LOCK_NAMESPACE).toBe(7001);
  });

  it("holds a lock in the mail namespace while the callback runs", async () => {
    // Proves the namespace constant reaches Postgres, rather than only being
    // asserted against itself above.
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const running = withMailConnectionLock(db, CONNECTION, async () => {
      expect(await heldLockCount()).toBe(1);
      await held;
      return null;
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    release();
    await running;
    expect(await heldLockCount()).toBe(0);
  });
});
