import { inboxItems } from "@personal-os/db";
import { SearchResponseSchema, type SearchResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const TZ = "America/Chicago";

// Checkpoint 9.3: inbox_items gained an archive axis (migration 0017). A
// dismissed capture is excluded from search UNCONDITIONALLY: unlike task/note
// results the inbox_item member carries no `archived` flag, so an included row
// would be indistinguishable from a live one. `include_archived` does not
// reach this entity (the 9.3 contract: "search excludes archived inbox items").
describe("GET /search -- archived inbox items", () => {
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

  async function search(params: Record<string, string>): Promise<SearchResponse> {
    const query = new URLSearchParams(params);
    const response = await app.inject({ method: "GET", url: `/search?${query.toString()}` });
    expect(response.statusCode).toBe(200);
    return SearchResponseSchema.parse(response.json());
  }

  async function seed(rawText: string, archivedAt: Date | null): Promise<string> {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        rawText,
        source: "web",
        capturedAt: new Date("2026-08-01T10:00:00Z"),
        timezone: TZ,
        status: "failed",
        archivedAt,
      })
      .returning({ id: inboxItems.id });
    return row!.id;
  }

  it("excludes an archived capture by default, from results AND the honest total", async () => {
    await seed("chase the quote", new Date("2026-09-10T00:00:00Z"));
    const live = await seed("chase the invoice", null);

    const body = await search({ q: "chase" });

    expect(body.counts.inbox_item).toEqual({ returned: 1, total: 1 });
    expect(body.results.map((result) => result.id)).toEqual([live]);
    expect(body.truncated).toBe(false);
  });

  it("an explicit include_archived=false behaves like the default", async () => {
    await seed("chase the quote", new Date("2026-09-10T00:00:00Z"));

    const body = await search({ q: "chase", include_archived: "false" });

    expect(body.counts.inbox_item).toEqual({ returned: 0, total: 0 });
  });

  it("does NOT resurrect a dismissed capture even with include_archived=true", async () => {
    await seed("chase the quote", new Date("2026-09-10T00:00:00Z"));
    const live = await seed("chase the invoice", null);

    const body = await search({ q: "chase", include_archived: "true" });

    expect(body.counts.inbox_item).toEqual({ returned: 1, total: 1 });
    expect(body.results.map((result) => result.id)).toEqual([live]);
  });
});
