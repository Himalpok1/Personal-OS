import { mailSyncRuns, type Db } from "@personal-os/db";
import { MailSyncFailureClassSchema } from "@personal-os/schema";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb, truncateTestTables } from "../test/build-test-db.js";
import { seedMailConnection, seedMailCursor } from "../test/mail-fixtures.js";
import { closeMailSyncRun, faultRunFields, openMailSyncRun } from "./run.js";

const db: Db = buildTestDb();

async function readRun(runId: string) {
  const [row] = await db.select().from(mailSyncRuns).where(eq(mailSyncRuns.id, runId));
  return row!;
}

beforeEach(async () => {
  await truncateTestTables(db);
});

afterAll(async () => {
  await truncateTestTables(db);
  await db.$client.end();
});

describe("openMailSyncRun", () => {
  it("opens the row as FAILED, so a pass that dies mid-flight does not read as success", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);

    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });

    const row = await readRun(runId);
    expect(row.status).toBe("failed");
    // A null finished_at is what distinguishes "died trying" from "never
    // attempted" -- the distinction you need at 3am.
    expect(row.finishedAt).toBeNull();
    expect(row.startedAt).not.toBeNull();
  });

  it("records the range when there is one and leaves it null when there is not", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);

    // An incremental pass has a CURSOR, not a range. Fabricating bounds for it
    // would be inventing precision.
    const incremental = await readRun(
      await openMailSyncRun(db, {
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "incremental",
      }),
    );
    expect(incremental.rangeStartAt).toBeNull();
    expect(incremental.rangeEndAt).toBeNull();

    const from = new Date("2026-09-01T00:00:00.000Z");
    const to = new Date("2026-09-02T00:00:00.000Z");
    const ranged = await readRun(
      await openMailSyncRun(db, {
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "backfill",
        rangeStartAt: from,
        rangeEndAt: to,
      }),
    );
    // timestamptz, not a civil date: Gmail supplies real instants, unlike the
    // Google Health API (ADR-048).
    expect(ranged.rangeStartAt?.toISOString()).toBe(from.toISOString());
    expect(ranged.rangeEndAt?.toISOString()).toBe(to.toISOString());
  });

  it("survives the cursor row being deleted, because cursor_id is ON DELETE SET NULL", async () => {
    // Deleting a cursor must not erase the evidence that syncs ran against it.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });

    // Raw SQL so the test exercises the DATABASE's own FK behaviour rather than
    // Drizzle's understanding of it.
    await db.execute(sql`delete from mail_sync_cursors where id = ${cursor.id}`);

    const row = await readRun(runId);
    expect(row.cursorId).toBeNull();
    expect(row.connectionId).toBe(connection.id);
  });
});

describe("closeMailSyncRun", () => {
  it("records counts and a terminal status", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });

    await closeMailSyncRun(db, runId, {
      status: "succeeded",
      requestCount: 7,
      pageCount: 2,
      rowsInserted: 3,
      rowsUpdated: 1,
      rowsUnchanged: 10,
      rowsTombstoned: 2,
      rowsRejected: 1,
    });

    const row = await readRun(runId);
    expect(row.status).toBe("succeeded");
    expect(row.requestCount).toBe(7);
    expect(row.pageCount).toBe(2);
    expect(row.rowsInserted).toBe(3);
    expect(row.rowsUpdated).toBe(1);
    expect(row.rowsUnchanged).toBe(10);
    expect(row.rowsTombstoned).toBe(2);
    expect(row.rowsRejected).toBe(1);
    expect(row.finishedAt).not.toBeNull();
    expect(row.failureClass).toBeNull();
    expect(row.errorMessage).toBeNull();
  });

  it("records cursor expiry as a dedicated flag, not as a string to pattern-match", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });

    await closeMailSyncRun(db, runId, {
      status: "failed",
      failureClass: "cursor_expired:list_history",
      httpStatus: 404,
      cursorExpired: true,
    });

    const row = await readRun(runId);
    expect(row.cursorExpired).toBe(true);
    expect(row.httpStatus).toBe(404);
    expect(row.failureClass).toBe("cursor_expired:list_history");
  });

  it("defaults cursorExpired to false rather than carrying it forward", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });
    await closeMailSyncRun(db, runId, { status: "succeeded" });
    expect((await readRun(runId)).cursorExpired).toBe(false);
  });
});

describe("the token rule", () => {
  it("REFUSES prose and collapses it to provider_error", async () => {
    // The rule this module exists to enforce. Gmail's INVALID_ARGUMENT prose
    // echoes the offending request back, and this column is durable.
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });

    await closeMailSyncRun(db, runId, {
      status: "failed",
      failureClass: "Unknown name \"startHistoryId\" at 'range': Cannot find field.",
    });

    const row = await readRun(runId);
    expect(row.failureClass).toBe("provider_error");
    expect(row.failureClass).not.toContain("startHistoryId");
    // error_message carries the SAME token, never a laxer second channel.
    expect(row.errorMessage).toBe("provider_error");
  });

  it("refuses a subject line dressed up as a failure class", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const runId = await openMailSyncRun(db, {
      connectionId: connection.id,
      cursorId: cursor.id,
      scopeKey: "mailbox",
      kind: "incremental",
    });
    await closeMailSyncRun(db, runId, {
      status: "failed",
      failureClass: "Your verification code is 483920",
    });
    const row = await readRun(runId);
    expect(row.failureClass).toBe("provider_error");
    expect(row.errorMessage).not.toContain("483920");
  });

  it("accepts every token shape the classifier can emit", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    const classes = [
      "cursor_expired:list_history",
      "provider_unavailable:503",
      "rate_limited:429",
      "invalid_request",
      "missing_scope",
      "not_found:get_message",
      "transport:timeout",
      "breaker_open",
      "pass_budget_exhausted",
    ];

    for (const failureClass of classes) {
      // Kept in step with the schema, so run.ts's private regex and
      // MailSyncFailureClassSchema cannot drift apart unnoticed.
      expect(() => MailSyncFailureClassSchema.parse(failureClass)).not.toThrow();

      const runId = await openMailSyncRun(db, {
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "incremental",
      });
      await closeMailSyncRun(db, runId, { status: "failed", failureClass });
      expect((await readRun(runId)).failureClass).toBe(failureClass);
    }
  });

  it("treats null and empty as absent rather than as a class", async () => {
    const connection = await seedMailConnection(db);
    const cursor = await seedMailCursor(db, connection.id);
    for (const failureClass of [null, "", undefined]) {
      const runId = await openMailSyncRun(db, {
        connectionId: connection.id,
        cursorId: cursor.id,
        scopeKey: "mailbox",
        kind: "incremental",
      });
      await closeMailSyncRun(db, runId, { status: "succeeded", failureClass });
      expect((await readRun(runId)).failureClass).toBeNull();
    }
  });
});

describe("faultRunFields", () => {
  it("projects only the three fields a run row may store from a fault", () => {
    expect(
      faultRunFields({
        code: "cursor_expired",
        failureClass: "cursor_expired:list_history",
        httpStatus: 404,
        retryable: false,
        cursorExpired: true,
        retryAfterSeconds: null,
      }),
    ).toEqual({
      failureClass: "cursor_expired:list_history",
      httpStatus: 404,
      cursorExpired: true,
    });
  });
});
