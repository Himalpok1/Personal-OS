import { inboxItems, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job } from "pg-boss";
import { beforeEach, describe, expect, it } from "vitest";
import { readStoredParseFailure, readStoredParseResult } from "@personal-os/schema";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { createCaptureParseDeadLetterHandler, type CaptureParseJobData } from "./capture-parse.js";

/**
 * Checkpoint 8.6A — capture.parse gains a dead-letter queue.
 *
 * Before this, retry exhaustion left the inbox row in `pending` or
 * `needs_confirm` forever and the only record lived in pg-boss's `job.output`,
 * which self-deletes after 7 days. These pin the durable terminal state that
 * replaced it.
 */
function deadJob(inboxId: string, mode?: "confirm"): Job<CaptureParseJobData> {
  return {
    id: "dead-job",
    name: "capture.parse.dead",
    data: mode ? { inboxId, mode } : { inboxId },
  } as Job<CaptureParseJobData>;
}

const TOOL_CALL = {
  tool: "create_note" as const,
  args: { title: "t", body: "b" },
};

async function readRow(db: Db, id: string): Promise<typeof inboxItems.$inferSelect> {
  const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
  if (!row) throw new Error(`inbox_items ${id} disappeared during the test`);
  return row;
}

async function insertRow(db: Db, status: string, parseResult: unknown): Promise<string> {
  const [row] = await db
    .insert(inboxItems)
    .values({
      clientUuid: crypto.randomUUID(),
      rawText: "x",
      source: "web",
      capturedAt: new Date(),
      timezone: "America/Chicago",
      status,
      parseResult,
    } as typeof inboxItems.$inferInsert)
    .returning();
  if (!row) throw new Error("insert returned no row");
  return row.id;
}

describe("capture.parse dead-letter handler", () => {
  let db: Db;
  let restore: () => void;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    restore = setLogSink({ write: () => {} });
    return () => restore();
  });

  it("finalizes a pending row as failed with a durable failure record", async () => {
    const id = await insertRow(db, "pending", null);
    await createCaptureParseDeadLetterHandler(db)([deadJob(id)]);

    const row = await readRow(db, id);
    expect(row.status).toBe("failed");
    const failure = readStoredParseFailure(row.parseResult);
    expect(failure?.reason).toBe("retries_exhausted");
    expect(failure?.mode).toBe("auto");
    expect(typeof failure?.failed_at).toBe("string");
  });

  // The stored tool call is the owner's only route back via ADR-060's
  // corrected_tool_call escape hatch. Destroying it would take that away.
  it("PRESERVES a needs_confirm row's stored tool call while marking it failed", async () => {
    const id = await insertRow(db, "needs_confirm", {
      toolCall: TOOL_CALL,
      confidenceFlags: ["modelUnclear"],
    });
    await createCaptureParseDeadLetterHandler(db)([deadJob(id, "confirm")]);

    const row = await readRow(db, id);
    expect(row.status).toBe("failed");
    const stored = readStoredParseResult(row.parseResult);
    expect(stored?.toolCall).toEqual(TOOL_CALL);
    expect(stored?.confidenceFlags).toEqual(["modelUnclear"]);
    expect(readStoredParseFailure(row.parseResult)?.mode).toBe("confirm");
  });

  // Idempotency is keyed on the row's CURRENT status, not the job payload: a
  // redelivered dead-letter job must never clobber a good outcome.
  it.each(["confirmed", "parsed", "failed"])(
    "is a no-op against an already-terminal %s row",
    async (status) => {
      const id = await insertRow(db, status, { toolCall: TOOL_CALL, confidenceFlags: [] });
      await createCaptureParseDeadLetterHandler(db)([deadJob(id)]);

      const row = await readRow(db, id);
      expect(row.status).toBe(status);
      expect(readStoredParseFailure(row.parseResult)).toBeNull();
    },
  );

  it("is idempotent across a duplicate delivery", async () => {
    const id = await insertRow(db, "pending", null);
    const handler = createCaptureParseDeadLetterHandler(db);
    await handler([deadJob(id)]);
    const first = await readRow(db, id);
    await handler([deadJob(id)]);
    const second = await readRow(db, id);

    expect(second.status).toBe("failed");
    expect(readStoredParseFailure(second.parseResult)?.failed_at).toBe(
      readStoredParseFailure(first.parseResult)?.failed_at,
    );
  });

  it("does not throw when the row no longer exists", async () => {
    await expect(
      createCaptureParseDeadLetterHandler(db)([deadJob(crypto.randomUUID())]),
    ).resolves.toBeUndefined();
  });

  // The failure record is persisted, so it must be structurally incapable of
  // carrying provider prose or the user's capture text.
  it("stores only the closed failure vocabulary", async () => {
    const id = await insertRow(db, "pending", null);
    await createCaptureParseDeadLetterHandler(db)([deadJob(id)]);
    const row = await readRow(db, id);
    const failure = (row.parseResult as { failure: Record<string, unknown> }).failure;
    expect(Object.keys(failure).sort()).toEqual(["failed_at", "mode", "reason"]);
  });
});
