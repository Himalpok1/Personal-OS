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

// Checkpoint 8.4. Two production confirms failed here silently: the route
// returned 202 for a stored `unclear` tool call, the enqueued job threw on all
// five attempts, and the item was left exactly as it was with the user told
// nothing. These pin the guard that makes 202 mean "a commit will be tried".
describe("POST /inbox/:id/confirm", () => {
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

  const UNCLEAR_REASON = "the capture is a single character with no verb";

  async function seedNeedsConfirm(parseResult: unknown): Promise<string> {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: randomUUID(),
        rawText: "x",
        source: "web",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        timezone: "America/Chicago",
        status: "needs_confirm",
        parseResult,
      })
      .returning({ id: inboxItems.id });
    return row!.id;
  }

  const unclearStored = {
    toolCall: { tool: "unclear", args: { reason: UNCLEAR_REASON } },
    confidenceFlags: ["modelUnclear"],
  };

  it("refuses an `unclear` parse result instead of enqueueing a job that cannot commit", async () => {
    const id = await seedNeedsConfirm(unclearStored);

    const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "parse_result_not_committable", tool: "unclear" });

    // The row is untouched -- refusing must not mutate state.
    const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
    expect(after.json<InboxItem>().status).toBe("needs_confirm");
    expect(after.json<InboxItem>().parse_result).toEqual(unclearStored);
  });

  it("never echoes the model's `unclear` reason, which is derived from capture text", async () => {
    const id = await seedNeedsConfirm(unclearStored);

    const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

    expect(res.body).not.toContain(UNCLEAR_REASON);
    expect(res.body).not.toContain("reason");
  });

  it("refuses a parse result no reader understands", async () => {
    // The shape the no-provider path writes -- readable JSON, but not a
    // tool call, so there is nothing to commit.
    const id = await seedNeedsConfirm({ error: "no provider configured" });

    const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "parse_result_unreadable" });
  });

  it("rejects a malformed corrected_tool_call at the boundary rather than in the worker", async () => {
    const id = await seedNeedsConfirm(unclearStored);

    const res = await app.inject({
      method: "POST",
      url: `/inbox/${id}/confirm`,
      // `corrected_tool_call` was `z.unknown()` before 8.4, so this was
      // accepted, written to the column, and only failed inside the job.
      payload: { corrected_tool_call: { tool: "create_task" } },
    });

    expect(res.statusCode).toBe(400);
    const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
    expect(after.json<InboxItem>().parse_result).toEqual(unclearStored);
  });

  it("stores a correction in the shape the worker actually reads", async () => {
    const id = await seedNeedsConfirm(unclearStored);
    const correction = { tool: "create_note", args: { title: "Groceries", body: "milk" } };

    await app.inject({
      method: "POST",
      url: `/inbox/${id}/confirm`,
      payload: { corrected_tool_call: correction },
    });

    // Previously the bare tool call was written here, so runConfirm -- which
    // reads `parse_result.toolCall` -- could not see it and threw.
    const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
    expect(after.json<InboxItem>().parse_result).toEqual({
      toolCall: correction,
      confidenceFlags: ["modelUnclear"],
    });
  });

  it("refuses a correction that is itself `unclear`, and writes nothing", async () => {
    const id = await seedNeedsConfirm(unclearStored);

    const res = await app.inject({
      method: "POST",
      url: `/inbox/${id}/confirm`,
      payload: { corrected_tool_call: { tool: "unclear", args: { reason: "still no idea" } } },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "parse_result_not_committable", tool: "unclear" });
    const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
    expect(after.json<InboxItem>().parse_result).toEqual(unclearStored);
  });

  it("still reports a non-needs_confirm row before inspecting its parse result", async () => {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: randomUUID(),
        rawText: "already handled",
        source: "web",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        timezone: "America/Chicago",
        status: "parsed",
        parseResult: unclearStored,
      })
      .returning({ id: inboxItems.id });

    const res = await app.inject({
      method: "POST",
      url: `/inbox/${row!.id}/confirm`,
      payload: {},
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "not_awaiting_confirmation", status: "parsed" });
  });

  it("404s an unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/inbox/${randomUUID()}/confirm`,
      payload: {},
    });
    expect(res.statusCode).toBe(404);
  });
});
