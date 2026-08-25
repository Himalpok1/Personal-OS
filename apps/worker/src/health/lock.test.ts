import { healthConnections, type Db } from "@personal-os/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { withConnectionLock } from "./lock.js";

const db: Db = buildTestDb();

async function insertConnection(healthUserId: string): Promise<string> {
  const [row] = await db
    .insert(healthConnections)
    .values({ provider: "google", healthUserId, status: "active" })
    .returning({ id: healthConnections.id });
  return row!.id;
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("withConnectionLock", () => {
  beforeEach(async () => {
    await truncateTestTables(db);
  });

  it("runs the body and reports acquisition", async () => {
    const id = await insertConnection("lock-user-1");
    const outcome = await withConnectionLock(db, id, () => Promise.resolve("done"));
    expect(outcome).toEqual({ acquired: true, result: "done" });
  });

  it("refuses a second concurrent pass for the same connection", async () => {
    const id = await insertConnection("lock-user-2");
    const gate = deferred();

    const first = withConnectionLock(db, id, async () => {
      await gate.promise;
      return "first";
    });

    // Give the first acquire a chance to land before the second attempt.
    await new Promise((r) => setTimeout(r, 25));
    const second = await withConnectionLock(db, id, () => Promise.resolve("second"));
    expect(second.acquired).toBe(false);

    gate.resolve();
    expect(await first).toEqual({ acquired: true, result: "first" });
  });

  it("lets a DIFFERENT connection proceed while one is held", async () => {
    const a = await insertConnection("lock-user-3a");
    const b = await insertConnection("lock-user-3b");
    const gate = deferred();

    const held = withConnectionLock(db, a, async () => {
      await gate.promise;
      return "a";
    });
    await new Promise((r) => setTimeout(r, 25));

    // The namespace is shared but the key is hashtext(connection id), so two
    // connections are independent. If this ever fails, the lock has become a
    // global mutex and every user's sync serializes behind every other's.
    const other = await withConnectionLock(db, b, () => Promise.resolve("b"));
    expect(other).toEqual({ acquired: true, result: "b" });

    gate.resolve();
    await held;
  });

  it("releases the lock when the body throws", async () => {
    const id = await insertConnection("lock-user-4");
    await expect(
      withConnectionLock(db, id, () => Promise.reject(new Error("boom"))),
    ).rejects.toThrow("boom");

    // The whole point of the finally block: a thrown pass must not leave the
    // connection permanently un-syncable.
    const after = await withConnectionLock(db, id, () => Promise.resolve("ok"));
    expect(after).toEqual({ acquired: true, result: "ok" });
  });

  it("releases the lock after a successful pass, so the next pass acquires", async () => {
    const id = await insertConnection("lock-user-5");
    for (let i = 0; i < 3; i += 1) {
      const outcome = await withConnectionLock(db, id, () => Promise.resolve(i));
      expect(outcome).toEqual({ acquired: true, result: i });
    }
  });
});
