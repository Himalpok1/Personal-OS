import { inboxItems } from "@personal-os/db";
import { TodayResponseSchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";

// Checkpoint 9.3: inbox_items gained an archive axis (migration 0017).
// Archiving is how a handled capture stops demanding attention, so the three
// inbox counts and the attention list must all carry `archived_at IS NULL`.
// The response SHAPE is unchanged -- only what is counted narrows.
describe("GET /today -- archived inbox items", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  async function getToday() {
    const response = await app.inject({
      method: "GET",
      url: `/today?tz=${encodeURIComponent(TZ)}`,
    });
    expect(response.statusCode).toBe(200);
    return TodayResponseSchema.parse(response.json());
  }

  it("excludes archived rows from every one of the three counts", async () => {
    const now = new Date();
    const archivedAt = new Date("2026-09-10T00:00:00Z");
    await app.db.insert(inboxItems).values([
      // One live and one archived row per attention status.
      { rawText: "pending live", source: "web", capturedAt: now, timezone: TZ, status: "pending" },
      {
        rawText: "pending archived",
        source: "web",
        capturedAt: now,
        timezone: TZ,
        status: "pending",
        archivedAt,
      },
      {
        rawText: "needs_confirm live",
        source: "web",
        capturedAt: now,
        timezone: TZ,
        status: "needs_confirm",
      },
      {
        rawText: "needs_confirm archived",
        source: "web",
        capturedAt: now,
        timezone: TZ,
        status: "needs_confirm",
        archivedAt,
      },
      { rawText: "failed live", source: "web", capturedAt: now, timezone: TZ, status: "failed" },
      {
        rawText: "failed archived",
        source: "web",
        capturedAt: now,
        timezone: TZ,
        status: "failed",
        archivedAt,
      },
    ]);

    const body = await getToday();

    expect(body.inbox.pending_count).toBe(1);
    expect(body.inbox.needs_confirm_count).toBe(1);
    expect(body.inbox.failed_count).toBe(1);
    expect(body.summary.inbox_attention_total).toBe(3);
  });

  it("excludes archived rows from the attention list, keeping newest-first order", async () => {
    const now = new Date();
    await app.db.insert(inboxItems).values([
      {
        rawText: "archived newest",
        source: "web",
        capturedAt: now,
        timezone: TZ,
        status: "failed",
        archivedAt: new Date("2026-09-10T00:00:00Z"),
      },
      {
        rawText: "live newer",
        source: "web",
        capturedAt: new Date(now.getTime() - 1000),
        timezone: TZ,
        status: "needs_confirm",
      },
      {
        rawText: "live older",
        source: "web",
        capturedAt: new Date(now.getTime() - 2000),
        timezone: TZ,
        status: "failed",
      },
    ]);

    const body = await getToday();

    expect(body.inbox.items.map((item) => item.raw_text)).toEqual(["live newer", "live older"]);
    // Shape unchanged: no archive field was added to the Today item.
    expect(Object.keys(body.inbox.items[0]!).sort()).toEqual([
      "captured_at",
      "entity_type",
      "id",
      "raw_text",
      "status",
    ]);
  });

  it("reports an honest zero when every attention row is archived", async () => {
    const now = new Date();
    const archivedAt = new Date("2026-09-10T00:00:00Z");
    await app.db.insert(inboxItems).values([
      { rawText: "a", source: "web", capturedAt: now, timezone: TZ, status: "pending", archivedAt },
      { rawText: "b", source: "web", capturedAt: now, timezone: TZ, status: "failed", archivedAt },
    ]);

    const body = await getToday();

    expect(body.inbox).toEqual({
      pending_count: 0,
      needs_confirm_count: 0,
      failed_count: 0,
      items: [],
    });
    expect(body.summary.inbox_attention_total).toBe(0);
  });
});
