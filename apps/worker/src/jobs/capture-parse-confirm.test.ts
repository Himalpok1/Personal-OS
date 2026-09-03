import { inboxItems, notes, tasks, type Db } from "@personal-os/db";
import { eq } from "drizzle-orm";
import type { Job, PgBoss } from "pg-boss";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { setLogSink } from "../logger.js";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { createCaptureParseHandler, type CaptureParseJobData } from "./capture-parse.js";

/**
 * Checkpoint 8.4 — the confirm path.
 *
 * Two production confirms enqueued jobs that threw on every one of their five
 * attempts and left both items untouched, with nothing logged and nothing
 * shown. The cause was a stored `unclear` tool call, which commitParsedEntity
 * throws on unconditionally. These pin the behaviour that replaced it.
 */
function confirmJob(inboxId: string): Job<CaptureParseJobData> {
  return {
    id: "confirm-job",
    name: "capture.parse",
    data: { inboxId, mode: "confirm" },
  } as Job<CaptureParseJobData>;
}

function captureLogs(): { records: Record<string, unknown>[]; restore: () => void } {
  const records: Record<string, unknown>[] = [];
  const restore = setLogSink({ write: (_level, record) => records.push(record) });
  return { records, restore };
}

describe("capture.parse confirm mode", () => {
  let db: Db;
  let boss: PgBoss;

  beforeEach(async () => {
    db = buildTestDb();
    await truncateTestTables(db);
    boss = { send: vi.fn().mockResolvedValue("push-job") } as unknown as PgBoss;
  });

  async function seed(parseResult: unknown, status = "needs_confirm"): Promise<string> {
    const [row] = await db
      .insert(inboxItems)
      .values({
        rawText: "x",
        source: "web",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        timezone: "America/Chicago",
        status,
        parseResult,
      })
      .returning({ id: inboxItems.id });
    return row!.id;
  }

  const unclearStored = {
    toolCall: { tool: "unclear", args: { reason: "no verb and one character" } },
    confidenceFlags: ["modelUnclear"],
  };

  it("does not throw on an `unclear` parse result, so pg-boss cannot burn five retries on it", async () => {
    const id = await seed(unclearStored);
    const { records, restore } = captureLogs();

    // Before 8.4 this rejected with AiJobError every single time.
    await expect(createCaptureParseHandler(db, boss)([confirmJob(id)])).resolves.toBeUndefined();
    restore();

    expect(records).toContainEqual(
      expect.objectContaining({
        event: "capture.parse.confirm_refused",
        mode: "confirm",
        reason: "not_committable",
      }),
    );
  });

  it("creates no entity and leaves the row honestly at needs_confirm when it refuses", async () => {
    const id = await seed(unclearStored);
    const { restore } = captureLogs();
    await createCaptureParseHandler(db, boss)([confirmJob(id)]);
    restore();

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(notes)).toHaveLength(0);
    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
    expect(row!.status).toBe("needs_confirm");
    expect(row!.entityId).toBeNull();
  });

  it("refuses an unreadable parse result rather than throwing", async () => {
    const id = await seed({ error: "no provider configured" });
    const { records, restore } = captureLogs();

    await expect(createCaptureParseHandler(db, boss)([confirmJob(id)])).resolves.toBeUndefined();
    restore();

    expect(records).toContainEqual(
      expect.objectContaining({ event: "capture.parse.confirm_refused", reason: "unreadable" }),
    );
  });

  it("commits a committable stored tool call exactly once", async () => {
    const id = await seed({
      toolCall: { tool: "create_note", args: { title: "Groceries", body: "milk" } },
      confidenceFlags: [],
    });

    await createCaptureParseHandler(db, boss)([confirmJob(id)]);

    const created = await db.select().from(notes);
    expect(created).toHaveLength(1);
    const [row] = await db.select().from(inboxItems).where(eq(inboxItems.id, id));
    expect(row!.status).toBe("confirmed");
    expect(row!.entityType).toBe("note");
    expect(row!.entityId).toBe(created[0]!.id);
  });

  it("is idempotent: a duplicate delivery commits no second entity", async () => {
    const id = await seed({
      toolCall: { tool: "create_note", args: { title: "Groceries", body: "milk" } },
      confidenceFlags: [],
    });
    const handler = createCaptureParseHandler(db, boss);

    await handler([confirmJob(id)]);
    // pg-boss can deliver the same job twice under crash conditions.
    await handler([confirmJob(id)]);
    await handler([confirmJob(id)]);

    expect(await db.select().from(notes)).toHaveLength(1);
  });

  it("refusing is also idempotent and never accumulates entities", async () => {
    const id = await seed(unclearStored);
    const handler = createCaptureParseHandler(db, boss);
    const { restore } = captureLogs();

    await handler([confirmJob(id)]);
    await handler([confirmJob(id)]);
    restore();

    expect(await db.select().from(tasks)).toHaveLength(0);
    expect(await db.select().from(notes)).toHaveLength(0);
  });

  it("classifies a genuine failure by stage and rethrows it, leaking no message", async () => {
    // A committable call whose commit cannot succeed: `create_task` with a
    // completion-anchored BYDAY rule, which validateCompletionAnchoredRule
    // rejects. Stands in for any real transient/permanent commit failure.
    const id = await seed({
      toolCall: {
        tool: "create_task",
        args: {
          title: "Water the plants",
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
          recurrence_anchor: "completion_date",
        },
      },
      confidenceFlags: [],
    });
    const { records, restore } = captureLogs();

    await expect(createCaptureParseHandler(db, boss)([confirmJob(id)])).rejects.toThrow();
    restore();

    const failure = records.find((r) => r["event"] === "capture.parse.failed");
    expect(failure).toMatchObject({ stage: "confirm_commit", mode: "confirm" });
    // errorToken emits a SQLSTATE or a class name -- never a message, and
    // never the capture text or a provider response body.
    expect(String(failure!["error"])).toMatch(/^[A-Za-z][A-Za-z0-9_]{0,63}$/);
    expect(JSON.stringify(records)).not.toContain("BYDAY");
  });

  it("skips a row that is no longer awaiting confirmation", async () => {
    const id = await seed(unclearStored, "confirmed");
    const { records, restore } = captureLogs();

    await expect(createCaptureParseHandler(db, boss)([confirmJob(id)])).resolves.toBeUndefined();
    restore();

    expect(records).toHaveLength(0);
  });
});
