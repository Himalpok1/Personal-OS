import { inboxItems } from "@personal-os/db";
import type { InboxItem } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { Paginated } from "../test/types.js";

describe("GET /inbox (list)", () => {
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

  it("lists captures, most recent first, and paginates", async () => {
    await app.db.insert(inboxItems).values([
      {
        clientUuid: randomUUID(),
        rawText: "first",
        source: "web",
        capturedAt: new Date("2026-08-01T00:00:00Z"),
        // Explicit, distinct createdAt values -- both rows defaulting to
        // now() in the same statement could tie, making the "most recent
        // first" ordering assertion below flaky.
        createdAt: new Date("2026-08-01T00:00:00Z"),
        timezone: "America/Chicago",
        status: "pending",
      },
      {
        clientUuid: randomUUID(),
        rawText: "second",
        source: "web",
        capturedAt: new Date("2026-08-02T00:00:00Z"),
        createdAt: new Date("2026-08-02T00:00:00Z"),
        timezone: "America/Chicago",
        status: "needs_confirm",
      },
    ]);

    const all = await app.inject({ method: "GET", url: "/inbox" });
    const allBody = all.json<Paginated<InboxItem>>();
    expect(allBody.total).toBe(2);
    expect(allBody.items[0]!.raw_text).toBe("second"); // most recent createdAt first

    const filtered = await app.inject({ method: "GET", url: "/inbox?status=needs_confirm" });
    const filteredBody = filtered.json<Paginated<InboxItem>>();
    expect(filteredBody.total).toBe(1);
    expect(filteredBody.items[0]!.raw_text).toBe("second");

    const paged = await app.inject({ method: "GET", url: "/inbox?limit=1&offset=1" });
    const pagedBody = paged.json<Paginated<InboxItem>>();
    expect(pagedBody.items).toHaveLength(1);
    expect(pagedBody.total).toBe(2);
  });
});
