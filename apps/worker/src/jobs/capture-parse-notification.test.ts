import { inboxItems, type Db } from "@personal-os/db";
import type { Job, PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOTIFICATIONS_DISPATCH_QUEUE } from "../queue-names.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { createCaptureParseHandler, type CaptureParseJobData } from "./capture-parse.js";

function fakeJob(inboxId: string): Job<CaptureParseJobData> {
  return {
    id: "capture-job",
    name: "capture.parse",
    data: { inboxId },
  } as Job<CaptureParseJobData>;
}

describe("capture.parse confirmation notification recovery", () => {
  let db: Db;
  let send: ReturnType<typeof vi.fn>;
  let boss: PgBoss;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    send = vi.fn().mockResolvedValue("push-job");
    boss = { send } as unknown as PgBoss;
  });

  it("enqueues from durable needs_confirm state without re-running the parser", async () => {
    const [row] = await db
      .insert(inboxItems)
      .values({
        rawText: "Call mom tomorrow",
        source: "web",
        capturedAt: new Date(),
        timezone: "America/Chicago",
        status: "needs_confirm",
      })
      .returning({ id: inboxItems.id });

    await createCaptureParseHandler(db, boss)([fakeJob(row!.id)]);

    expect(send).toHaveBeenCalledWith(
      NOTIFICATIONS_DISPATCH_QUEUE,
      expect.objectContaining({
        category: "confirmation",
        dedupeKey: `confirmation:${row!.id}`,
        data: { inboxId: row!.id },
      }),
      { singletonKey: `confirmation:${row!.id}` },
    );
  });

  it("rethrows an enqueue failure so pg-boss can retry from needs_confirm state", async () => {
    const [row] = await db
      .insert(inboxItems)
      .values({
        rawText: "Review this",
        source: "web",
        capturedAt: new Date(),
        timezone: "America/Chicago",
        status: "needs_confirm",
      })
      .returning({ id: inboxItems.id });
    send.mockRejectedValue(new Error("queue unavailable"));

    await expect(createCaptureParseHandler(db, boss)([fakeJob(row!.id)])).rejects.toThrow(
      /queue unavailable/,
    );
  });
});
