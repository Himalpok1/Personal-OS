import { inboxItems, tasks } from "@personal-os/db";
import type { InboxItem } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { CAPTURE_PARSE_QUEUE } from "../queue-names.js";
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

  // Checkpoint 9.3: inbox_items gained an archive axis (migration 0017).
  it("hides archived captures by default, in both items and total", async () => {
    await app.db.insert(inboxItems).values([
      {
        clientUuid: randomUUID(),
        rawText: "live",
        source: "web",
        capturedAt: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T00:00:00Z"),
        timezone: "America/Chicago",
        status: "parsed",
      },
      {
        clientUuid: randomUUID(),
        rawText: "archived",
        source: "web",
        capturedAt: new Date("2026-08-02T00:00:00Z"),
        createdAt: new Date("2026-08-02T00:00:00Z"),
        timezone: "America/Chicago",
        status: "parsed",
        archivedAt: new Date("2026-08-03T00:00:00Z"),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/inbox" });
    const body = res.json<Paginated<InboxItem>>();
    expect(body.total).toBe(1);
    expect(body.items.map((item) => item.raw_text)).toEqual(["live"]);
    expect(body.items[0]!.archived_at).toBeNull();

    // An explicit "false" must behave like the default (the pagination.ts
    // z.coerce.boolean hazard).
    const explicit = await app.inject({ method: "GET", url: "/inbox?include_archived=false" });
    expect(explicit.json<Paginated<InboxItem>>().total).toBe(1);
  });

  it("includes archived captures on request, each carrying its archived_at", async () => {
    await app.db.insert(inboxItems).values([
      {
        clientUuid: randomUUID(),
        rawText: "live",
        source: "web",
        capturedAt: new Date("2026-08-01T00:00:00Z"),
        createdAt: new Date("2026-08-01T00:00:00Z"),
        timezone: "America/Chicago",
        status: "failed",
      },
      {
        clientUuid: randomUUID(),
        rawText: "archived",
        source: "web",
        capturedAt: new Date("2026-08-02T00:00:00Z"),
        createdAt: new Date("2026-08-02T00:00:00Z"),
        timezone: "America/Chicago",
        status: "failed",
        archivedAt: new Date("2026-08-03T00:00:00Z"),
      },
    ]);

    const res = await app.inject({ method: "GET", url: "/inbox?include_archived=true" });
    const body = res.json<Paginated<InboxItem>>();
    expect(body.total).toBe(2);
    expect(body.items.map((item) => [item.raw_text, item.archived_at])).toEqual([
      ["archived", "2026-08-03T00:00:00.000Z"],
      ["live", null],
    ]);

    // Composes with the status filter rather than replacing it.
    const both = await app.inject({
      method: "GET",
      url: "/inbox?include_archived=true&status=failed",
    });
    expect(both.json<Paginated<InboxItem>>().total).toBe(2);
    const none = await app.inject({
      method: "GET",
      url: "/inbox?include_archived=true&status=pending",
    });
    expect(none.json<Paginated<InboxItem>>().total).toBe(0);
  });

  it("rejects a malformed include_archived rather than guessing", async () => {
    const res = await app.inject({ method: "GET", url: "/inbox?include_archived=yes" });
    expect(res.statusCode).toBe(400);
  });

  it("GET /inbox/:id still returns an archived capture, with archived_at set", async () => {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: randomUUID(),
        rawText: "archived",
        source: "web",
        capturedAt: new Date("2026-08-02T00:00:00Z"),
        timezone: "America/Chicago",
        status: "parsed",
        archivedAt: new Date("2026-08-03T00:00:00Z"),
      })
      .returning({ id: inboxItems.id });

    const res = await app.inject({ method: "GET", url: `/inbox/${row!.id}` });
    expect(res.statusCode).toBe(200);
    expect(res.json<InboxItem>().archived_at).toBe("2026-08-03T00:00:00.000Z");
  });
});

// Checkpoint 9.3. An inbox row is the durable record of a capture and is never
// deleted, so before this the only way a handled capture left the Inbox screen
// and the Today attention counts was to sit there forever. Archive is a
// dedicated action route (ADR-039), idempotent, status-agnostic, and never
// touches the entity the capture committed.
describe("POST /inbox/:id/archive", () => {
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

  async function seed(
    values: Partial<typeof inboxItems.$inferInsert> & { status: string },
  ): Promise<string> {
    const [row] = await app.db
      .insert(inboxItems)
      .values({
        clientUuid: randomUUID(),
        rawText: "capture",
        source: "web",
        capturedAt: new Date("2026-09-01T00:00:00Z"),
        timezone: "America/Chicago",
        ...values,
      })
      .returning({ id: inboxItems.id });
    return row!.id;
  }

  it("archives a capture and returns its id and the stamped instant", async () => {
    const id = await seed({ status: "parsed" });
    const before = Date.now();

    const res = await app.inject({ method: "POST", url: `/inbox/${id}/archive` });

    expect(res.statusCode).toBe(200);
    const body = res.json<{ id: string; archived_at: string }>();
    expect(Object.keys(body).sort()).toEqual(["archived_at", "id"]);
    expect(body.id).toBe(id);
    const stamped = Date.parse(body.archived_at);
    expect(stamped).toBeGreaterThanOrEqual(before - 1000);
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000);

    const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
    expect(after.json<InboxItem>().archived_at).toBe(body.archived_at);
  });

  it("is idempotent -- a second call returns the FIRST call's archived_at, not a fresh one", async () => {
    const id = await seed({ status: "failed" });

    const first = await app.inject({ method: "POST", url: `/inbox/${id}/archive` });
    // Cross a millisecond boundary so a re-stamp would be observable.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await app.inject({ method: "POST", url: `/inbox/${id}/archive` });

    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual(first.json());
  });

  it("archives any status, and leaves the status itself untouched", async () => {
    for (const status of ["pending", "parsed", "needs_confirm", "confirmed", "failed"]) {
      const id = await seed({ status });
      const res = await app.inject({ method: "POST", url: `/inbox/${id}/archive` });
      expect(res.statusCode, status).toBe(200);
      const [row] = await app.db.select().from(inboxItems).where(eq(inboxItems.id, id));
      expect(row!.status, status).toBe(status);
      expect(row!.archivedAt, status).not.toBeNull();
    }
  });

  it("never touches the committed entity and never deletes the row", async () => {
    const [task] = await app.db
      .insert(tasks)
      .values({ title: "Call the insurer", timezone: "America/Chicago", status: "active" })
      .returning();
    const id = await seed({ status: "parsed", entityType: "task", entityId: task!.id });

    const res = await app.inject({ method: "POST", url: `/inbox/${id}/archive` });
    expect(res.statusCode).toBe(200);

    const [taskAfter] = await app.db.select().from(tasks).where(eq(tasks.id, task!.id));
    expect(taskAfter).toEqual(task);
    const [rowAfter] = await app.db.select().from(inboxItems).where(eq(inboxItems.id, id));
    expect(rowAfter).toBeDefined();
    expect(rowAfter!.entityType).toBe("task");
    expect(rowAfter!.entityId).toBe(task!.id);
    expect(rowAfter!.parseResult).toBeNull();
  });

  it("404s an unknown id", async () => {
    const res = await app.inject({ method: "POST", url: `/inbox/${randomUUID()}/archive` });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
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

  // Checkpoint 9.3 review: CreateTaskToolSchema leaves rrule and
  // recurrence_timezone as bare strings, so a stored `create_task` can carry
  // a rule the commit cannot materialize. Old code: 202, a job enqueued, and
  // -- for a due_date rule -- an orphan task row inserted on every retry.
  describe("a create_task whose recurrence cannot be materialized", () => {
    const RRULE_TEXT = "every monday";
    const storedBadRule = {
      toolCall: { tool: "create_task", args: { title: "Gym", rrule: RRULE_TEXT } },
      confidenceFlags: ["recurrenceInferred"],
    };

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it.each([
      ["free-text rrule", { title: "Gym", rrule: RRULE_TEXT }],
      ["unknown FREQ", { title: "Gym", rrule: "FREQ=WEEKLYY" }],
      ["INTERVAL=0", { title: "Gym", rrule: "FREQ=DAILY;INTERVAL=0" }],
      [
        "invalid recurrence_timezone",
        { title: "Gym", rrule: "FREQ=DAILY", recurrence_timezone: "Mars/Olympus_Mons" },
      ],
      [
        "BY* on completion_date",
        { title: "Gym", rrule: "FREQ=WEEKLY;BYDAY=MO", recurrence_anchor: "completion_date" },
      ],
    ])(
      "refuses the stored call (%s) with a token-only 409 and enqueues nothing",
      async (_label, args) => {
        const id = await seedNeedsConfirm({
          toolCall: { tool: "create_task", args },
          confidenceFlags: ["recurrenceInferred"],
        });
        const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

        const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: "parse_result_not_committable", tool: "create_task" });
        expect(send).not.toHaveBeenCalled();
        const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
        expect(after.json<InboxItem>().status).toBe("needs_confirm");
      },
    );

    it("never echoes the rule text, which is model output", async () => {
      const id = await seedNeedsConfirm(storedBadRule);
      const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });
      expect(res.body).not.toContain(RRULE_TEXT);
      expect(res.body).not.toContain("rrule");
    });

    it("judges the CORRECTION when one is supplied, and writes nothing on refusal", async () => {
      const id = await seedNeedsConfirm(unclearStored);
      vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: `/inbox/${id}/confirm`,
        payload: {
          corrected_tool_call: {
            tool: "create_task",
            args: { title: "Gym", rrule: "FREQ=WEEKLYY" },
          },
        },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "parse_result_not_committable", tool: "create_task" });
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().parse_result).toEqual(unclearStored);
    });

    it("accepts a correction that repairs the rule", async () => {
      const id = await seedNeedsConfirm(storedBadRule);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: `/inbox/${id}/confirm`,
        payload: {
          corrected_tool_call: {
            tool: "create_task",
            args: { title: "Gym", rrule: "FREQ=WEEKLY;BYDAY=MO" },
          },
        },
      });

      expect(res.statusCode).toBe(202);
      expect(send).toHaveBeenCalledTimes(1);
    });
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

  // Checkpoint 9.3 ("D4-min"): a `failed` row is confirmable. The dead-letter
  // handler preserves the stored tool call precisely so this route back
  // exists; before 9.3 the route refused it with not_awaiting_confirmation.
  describe("on a `failed` row", () => {
    const FAILURE = {
      reason: "retries_exhausted",
      mode: "confirm",
      failed_at: "2026-09-10T00:00:00.000Z",
    };
    const noteCall = { tool: "create_note", args: { title: "Groceries", body: "milk" } };

    async function seedFailed(parseResult: unknown): Promise<string> {
      const [row] = await app.db
        .insert(inboxItems)
        .values({
          clientUuid: randomUUID(),
          rawText: "x",
          source: "web",
          capturedAt: new Date("2026-09-01T00:00:00Z"),
          timezone: "America/Chicago",
          status: "failed",
          parseResult,
        })
        .returning({ id: inboxItems.id });
      return row!.id;
    }

    afterEach(() => {
      vi.restoreAllMocks();
    });

    it("confirms a preserved committable tool call: 202, status back to needs_confirm, marker dropped, job enqueued", async () => {
      const id = await seedFailed({
        toolCall: noteCall,
        confidenceFlags: ["modelUnclear"],
        failure: FAILURE,
      });
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ inbox_id: id, status: "confirming" });
      expect(send).toHaveBeenCalledTimes(1);
      expect(send.mock.calls[0]![0]).toBe(CAPTURE_PARSE_QUEUE);
      expect(send.mock.calls[0]![1]).toEqual({ inboxId: id, mode: "confirm" });

      // The worker's confirm path is keyed on `needs_confirm`, and the marker
      // described a terminal state the row has now left.
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().status).toBe("needs_confirm");
      expect(after.json<InboxItem>().parse_result).toEqual({
        toolCall: noteCall,
        confidenceFlags: ["modelUnclear"],
      });
    });

    it("confirms with a correction when the stored call was `unclear`", async () => {
      const id = await seedFailed({ ...unclearStored, failure: FAILURE });
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: `/inbox/${id}/confirm`,
        payload: { corrected_tool_call: noteCall },
      });

      expect(res.statusCode).toBe(202);
      expect(send).toHaveBeenCalledTimes(1);
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().status).toBe("needs_confirm");
      expect(after.json<InboxItem>().parse_result).toEqual({
        toolCall: noteCall,
        confidenceFlags: ["modelUnclear"],
      });
    });

    it("confirms with a correction when the row never had a tool call (auto-parse death)", async () => {
      const id = await seedFailed({ failure: { ...FAILURE, mode: "auto" } });
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({
        method: "POST",
        url: `/inbox/${id}/confirm`,
        payload: { corrected_tool_call: noteCall },
      });

      expect(res.statusCode).toBe(202);
      expect(send).toHaveBeenCalledTimes(1);
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().parse_result).toEqual({
        toolCall: noteCall,
        confidenceFlags: [],
      });
    });

    it("refuses an `unclear` stored call with no correction, writing nothing", async () => {
      const stored = { ...unclearStored, failure: FAILURE };
      const id = await seedFailed(stored);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "parse_result_not_committable", tool: "unclear" });
      expect(send).not.toHaveBeenCalled();
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().status).toBe("failed");
      expect(after.json<InboxItem>().parse_result).toEqual(stored);
    });

    it("refuses a marker-only row (no stored call) with no correction, writing nothing", async () => {
      const stored = { failure: { ...FAILURE, mode: "auto" } };
      const id = await seedFailed(stored);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);

      const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });

      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "parse_result_unreadable" });
      expect(send).not.toHaveBeenCalled();
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().status).toBe("failed");
      expect(after.json<InboxItem>().parse_result).toEqual(stored);
    });

    it("refuses the legacy no-provider {error} shape with no correction", async () => {
      const id = await seedFailed({ error: "no provider configured" });
      const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });
      expect(res.statusCode).toBe(409);
      expect(res.json()).toEqual({ error: "parse_result_unreadable" });
    });

    it("leaves the row EXACTLY as found when the job queue is unavailable", async () => {
      const stored = { toolCall: noteCall, confidenceFlags: [], failure: FAILURE };
      const id = await seedFailed(stored);
      const send = vi.spyOn(app.boss, "send").mockResolvedValue(null);
      const wasReady = app.bossReady;
      app.bossReady = false;
      try {
        const res = await app.inject({ method: "POST", url: `/inbox/${id}/confirm`, payload: {} });
        expect(res.statusCode).toBe(503);
        expect(res.json()).toEqual({ error: "job_queue_unavailable" });
      } finally {
        app.bossReady = wasReady;
      }

      expect(send).not.toHaveBeenCalled();
      const after = await app.inject({ method: "GET", url: `/inbox/${id}` });
      expect(after.json<InboxItem>().status).toBe("failed");
      expect(after.json<InboxItem>().parse_result).toEqual(stored);
    });

    it("still refuses parsed, confirmed and pending rows", async () => {
      for (const status of ["parsed", "confirmed", "pending"]) {
        const [row] = await app.db
          .insert(inboxItems)
          .values({
            clientUuid: randomUUID(),
            rawText: "x",
            source: "web",
            capturedAt: new Date("2026-09-01T00:00:00Z"),
            timezone: "America/Chicago",
            status,
            parseResult: { toolCall: noteCall, confidenceFlags: [] },
          })
          .returning({ id: inboxItems.id });
        const res = await app.inject({
          method: "POST",
          url: `/inbox/${row!.id}/confirm`,
          payload: {},
        });
        expect(res.statusCode, status).toBe(409);
        expect(res.json(), status).toEqual({ error: "not_awaiting_confirmation", status });
      }
    });
  });
});
