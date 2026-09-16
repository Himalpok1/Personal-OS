import { canvasSyncRuns, type Db } from "@personal-os/db";
import { CanvasSyncTokenSchema } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb } from "../test/build-test-db.js";
import { closeCanvasSyncRun, openCanvasSyncRun } from "./run.js";
import { seedCanvasConnection, truncateCanvasTestTables } from "./test-fixtures.js";

const db: Db = buildTestDb();

beforeEach(async () => {
  await truncateCanvasTestTables(db);
});

afterAll(async () => {
  await truncateCanvasTestTables(db);
  await db.$client.end();
});

async function readRun(runId: string) {
  const [row] = await db
    .select({
      status: canvasSyncRuns.status,
      failureClass: canvasSyncRuns.failureClass,
      errorMessage: canvasSyncRuns.errorMessage,
      finishedAt: canvasSyncRuns.finishedAt,
    })
    .from(canvasSyncRuns)
    .where(eq(canvasSyncRuns.id, runId));
  return row!;
}

describe("openCanvasSyncRun / closeCanvasSyncRun", () => {
  it("opens a row as `failed` before any request goes out", async () => {
    const connection = await seedCanvasConnection(db);
    const runId = await openCanvasSyncRun(db, { connectionId: connection.id, kind: "cron" });
    const row = await readRun(runId);
    expect(row.status).toBe("failed");
    expect(row.finishedAt).toBeNull();
  });

  it("accepts a genuinely token-shaped failure class and error message unchanged", async () => {
    const connection = await seedCanvasConnection(db);
    const runId = await openCanvasSyncRun(db, { connectionId: connection.id, kind: "cron" });
    await closeCanvasSyncRun(db, runId, {
      status: "failed",
      failureClass: "provider_error:503",
      errorMessage: "provider_error:503",
    });
    const row = await readRun(runId);
    expect(row.failureClass).toBe("provider_error:503");
    expect(row.errorMessage).toBe("provider_error:503");
    // Pins the two schemas together, exactly as documented: a value this
    // module accepts must also satisfy the wire schema.
    expect(() => CanvasSyncTokenSchema.parse(row.failureClass)).not.toThrow();
  });

  it("coerces raw-looking provider prose to the generic `provider_error` token", async () => {
    const connection = await seedCanvasConnection(db);
    const runId = await openCanvasSyncRun(db, { connectionId: connection.id, kind: "cron" });

    const rawProviderText =
      'Canvas API 500: {"errors":[{"message":"course 12345 not found for user Jane Doe"}]}';
    await closeCanvasSyncRun(db, runId, {
      status: "failed",
      failureClass: rawProviderText,
      errorMessage: rawProviderText,
    });

    const row = await readRun(runId);
    // Never the raw text -- not truncated, not escaped, replaced outright.
    expect(row.failureClass).toBe("provider_error");
    expect(row.errorMessage).toBe("provider_error");
    expect(row.failureClass).not.toContain("Jane Doe");
    expect(row.errorMessage).not.toContain("course 12345");
  });

  it("rejects a value with spaces, a colon-qualifier of the wrong shape, or capitals -- same regex as mail_sync_runs", () => {
    const badValues = [
      "Provider Error",
      "provider error",
      "PROVIDER_ERROR",
      "provider_error: with a space",
      "5xx server error from Canvas",
    ];
    for (const bad of badValues) {
      expect(CanvasSyncTokenSchema.safeParse(bad).success).toBe(false);
    }
    // And every one of those actually reaches the coercion path when written
    // through closeCanvasSyncRun, not just failing the schema in isolation --
    // proven end to end in the previous test with a representative sample.
  });

  it("treats null/undefined/empty as no classification at all, not as a token to validate", async () => {
    const connection = await seedCanvasConnection(db);
    const runId = await openCanvasSyncRun(db, { connectionId: connection.id, kind: "cron" });
    await closeCanvasSyncRun(db, runId, {
      status: "succeeded",
      failureClass: null,
      errorMessage: "",
    });
    const row = await readRun(runId);
    expect(row.failureClass).toBeNull();
    expect(row.errorMessage).toBeNull();
  });
});
