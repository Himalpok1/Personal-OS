import { setLogSink } from "@personal-os/core/logging/logger";
import { actionRequests, events, permissionGrants, tasks } from "@personal-os/db";
import {
  ACTION_REQUEST_TTL_HOURS,
  ActionListResponseSchema,
  ActionRequestItemSchema,
  ActionsSummarySchema,
  type ActionRequestItem,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { agentHeaders, pairTestDevice } from "../test/agents.test-support.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.8 (ADR-078) -- the action request lifecycle through the
// real routes, the real service and the real handlers: propose -> approve
// (executes) | cancel, the single-use claim, expiry, the permission gate,
// undo, idempotency and the audit row's contents.
//
// Since Checkpoint 10.9 (ADR-082) approve, cancel and the permission PATCH
// are DEVICE-bound: every call to them below carries a paired device's
// bearer (`deviceToken`, paired fresh in beforeEach); the assertions are
// otherwise the 10.8 ones, unchanged.

let deviceToken = "";

const TITLE = "Read chapter 4 of the biology textbook";

async function seedTask(
  app: FastifyInstance,
  overrides: Partial<typeof tasks.$inferInsert> = {},
): Promise<string> {
  const [row] = await app.db
    .insert(tasks)
    .values({ title: TITLE, status: "active", timezone: "America/Chicago", ...overrides })
    .returning({ id: tasks.id });
  return row!.id;
}

async function seedEvent(
  app: FastifyInstance,
  overrides: Partial<typeof events.$inferInsert> = {},
): Promise<string> {
  const [row] = await app.db
    .insert(events)
    .values({
      title: "Lab meeting",
      timezone: "America/Chicago",
      startsAt: new Date("2026-09-18T20:00:00-05:00"),
      endsAt: new Date("2026-09-18T21:00:00-05:00"),
      origin: "local",
      ...overrides,
    })
    .returning({ id: events.id });
  return row!.id;
}

function createTaskBody(overrides: Record<string, unknown> = {}) {
  return {
    action_id: "create_task",
    input: { title: TITLE, timezone: "America/Chicago" },
    source: "focus_now",
    reason: "Matches your Focus Now recommendation",
    ...overrides,
  };
}

async function propose(
  app: FastifyInstance,
  body: Record<string, unknown>,
  expectedStatus = 201,
): Promise<ActionRequestItem> {
  const response = await app.inject({ method: "POST", url: "/actions", payload: body });
  expect(response.statusCode, response.body).toBe(expectedStatus);
  return ActionRequestItemSchema.parse(response.json());
}

async function approve(app: FastifyInstance, id: string, expectedStatus = 200) {
  const response = await app.inject({
    method: "POST",
    url: `/actions/${id}/approve`,
    headers: agentHeaders(deviceToken),
  });
  expect(response.statusCode, response.body).toBe(expectedStatus);
  return response;
}

async function revoke(app: FastifyInstance, permission: string) {
  const response = await app.inject({
    method: "PATCH",
    url: `/permissions/${permission}`,
    headers: agentHeaders(deviceToken),
    payload: { granted: false },
  });
  expect(response.statusCode).toBe(200);
  return response.json<{ cancelled_pending: number }>();
}

describe("actions routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    deviceToken = await pairTestDevice(app);
  });

  // ---- propose ----------------------------------------------------------

  it("creates a pending request with principal app, a frozen input, a server summary and a 24h expiry", async () => {
    const item = await propose(app, createTaskBody());
    expect(item.status).toBe("pending");
    expect(item.principal).toBe("app");
    expect(item.action_id).toBe("create_task");
    expect(item.input).toEqual({ title: TITLE, timezone: "America/Chicago" });
    expect(item.input_summary).toContain(TITLE);
    expect(item.source).toBe("focus_now");
    expect(item.reason).toBe("Matches your Focus Now recommendation");
    expect(item.target_id).toBeNull();
    expect(item.approved_at).toBeNull();
    expect(item.finished_at).toBeNull();
    expect(item.reversed_by_request_id).toBeNull();
    const ttl = new Date(item.expires_at).getTime() - new Date(item.requested_at).getTime();
    expect(ttl).toBe(ACTION_REQUEST_TTL_HOURS * 60 * 60 * 1000);
  });

  it("strips control characters from the reason and never lets the client set principal or status", async () => {
    const item = await propose(app, createTaskBody({ reason: "line one\nline two\u0007" }));
    expect(item.reason).toBe("line one line two");
    const forged = await app.inject({
      method: "POST",
      url: "/actions",
      payload: createTaskBody({ principal: "agent" }),
    });
    expect(forged.statusCode).toBe(400);
    expect(forged.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("returns the existing request (200) for a repeated client_uuid -- never a second row", async () => {
    const clientUuid = crypto.randomUUID();
    const first = await propose(app, createTaskBody({ client_uuid: clientUuid }));
    const second = await propose(app, createTaskBody({ client_uuid: clientUuid }), 200);
    expect(second.id).toBe(first.id);
    const rows = await app.db.select({ id: actionRequests.id }).from(actionRequests);
    expect(rows).toHaveLength(1);
  });

  it("refuses a target action whose target does not exist, with a 400 issue and no row", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/actions",
      payload: {
        action_id: "complete_task",
        input: { task_id: crypto.randomUUID() },
        source: "manual",
      },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<{ error: string; issues: { path: string[] }[] }>();
    expect(body.error).toBe("validation_failed");
    expect(body.issues[0]?.path).toEqual(["task_id"]);
    expect(await app.db.select().from(actionRequests)).toHaveLength(0);
  });

  it("records the target on a target action at request time", async () => {
    const taskId = await seedTask(app);
    const item = await propose(app, {
      action_id: "complete_task",
      input: { task_id: taskId },
      source: "manual",
    });
    expect(item.target_type).toBe("task");
    expect(item.target_id).toBe(taskId);
    expect(item.input_summary).toContain(TITLE);
  });

  // ---- the permission gate ---------------------------------------------

  it("refuses to accept a request whose permission is revoked (403) and records nothing", async () => {
    await revoke(app, "tasks.write");
    const response = await app.inject({
      method: "POST",
      url: "/actions",
      payload: createTaskBody(),
    });
    expect(response.statusCode).toBe(403);
    expect(response.json<{ error: string; permission: string }>()).toEqual({
      error: "action_permission_denied",
      permission: "tasks.write",
    });
    expect(await app.db.select().from(actionRequests)).toHaveLength(0);
    // calendar.write is untouched: a calendar action is still accepted.
    await propose(app, {
      action_id: "create_calendar_event",
      input: {
        title: "Study block",
        starts_at: "2026-09-18T20:00:00-05:00",
        ends_at: "2026-09-18T21:00:00-05:00",
        timezone: "America/Chicago",
      },
      source: "focus_now",
    });
  });

  it("revoking a permission cancels every pending request that needs it, in the same call", async () => {
    const a = await propose(app, createTaskBody());
    const b = await propose(app, createTaskBody({ input: { title: "Another", timezone: "UTC" } }));
    const calendar = await propose(app, {
      action_id: "create_calendar_event",
      input: {
        title: "Study block",
        starts_at: "2026-09-18T20:00:00-05:00",
        ends_at: "2026-09-18T21:00:00-05:00",
        timezone: "America/Chicago",
      },
      source: "manual",
    });
    const result = await revoke(app, "tasks.write");
    expect(result.cancelled_pending).toBe(2);
    for (const id of [a.id, b.id]) {
      const row = (await app.db.select().from(actionRequests).where(eq(actionRequests.id, id)))[0]!;
      expect(row.status).toBe("cancelled");
      expect(row.finishedAt).not.toBeNull();
      expect(row.resultSummary).toBe("Cancelled: permission revoked");
    }
    const untouched = (
      await app.db.select().from(actionRequests).where(eq(actionRequests.id, calendar.id))
    )[0]!;
    expect(untouched.status).toBe("pending");
  });

  it("a revoke that lands between request and approval makes the approval FAIL with permission_revoked, not execute", async () => {
    const item = await propose(app, createTaskBody());
    await app.db.insert(permissionGrants).values({
      principal: "app",
      permission: "tasks.write",
      disclosureVersion: "2026-09-17",
      grantedAt: new Date(),
      revokedAt: new Date(),
    });
    // The row was not cancelled (the revoke went around the route), so the
    // claim succeeds -- and the executor's own re-check must still refuse.
    const response = await approve(app, item.id);
    const failed = ActionRequestItemSchema.parse(response.json());
    expect(failed.status).toBe("failed");
    expect(failed.error_class).toBe("permission_revoked");
    expect(await app.db.select().from(tasks)).toHaveLength(0);
  });

  // ---- approve: executes, single-use ------------------------------------

  it("approve executes the stored input inside the request and returns the completed row with its target", async () => {
    const item = await propose(app, createTaskBody());
    const response = await approve(app, item.id);
    const done = ActionRequestItemSchema.parse(response.json());
    expect(done.status).toBe("completed");
    expect(done.approved_at).not.toBeNull();
    expect(done.finished_at).not.toBeNull();
    expect(done.error_class).toBeNull();
    expect(done.target_type).toBe("task");
    expect(done.target_id).not.toBeNull();
    const [task] = await app.db.select().from(tasks).where(eq(tasks.id, done.target_id!));
    expect(task?.title).toBe(TITLE);
    expect(task?.status).toBe("active");
  });

  it("a second approval of the same request is a 409 no-op -- exactly one task exists", async () => {
    const item = await propose(app, createTaskBody());
    await approve(app, item.id);
    const replay = await approve(app, item.id, 409);
    expect(replay.json<{ error: string; status: string }>()).toEqual({
      error: "action_not_pending",
      status: "completed",
    });
    expect(await app.db.select().from(tasks)).toHaveLength(1);
  });

  it("approving a cancelled request is refused and writes nothing", async () => {
    const item = await propose(app, createTaskBody());
    const cancel = await app.inject({
      method: "POST",
      url: `/actions/${item.id}/cancel`,
      headers: agentHeaders(deviceToken),
    });
    expect(cancel.statusCode).toBe(200);
    expect(ActionRequestItemSchema.parse(cancel.json()).status).toBe("cancelled");
    const replay = await approve(app, item.id, 409);
    expect(replay.json<{ status: string }>().status).toBe("cancelled");
    expect(await app.db.select().from(tasks)).toHaveLength(0);
  });

  it("an expired request cannot be approved: it is flipped to expired and answered 409 action_expired", async () => {
    const item = await propose(app, createTaskBody());
    await app.db
      .update(actionRequests)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(actionRequests.id, item.id));
    // The list presents it as expired even before anything touches it.
    const listed = await app.inject({ method: "GET", url: "/actions?status=expired" });
    expect(ActionListResponseSchema.parse(listed.json()).items.map((i) => i.id)).toEqual([item.id]);
    const pending = await app.inject({ method: "GET", url: "/actions?status=pending" });
    expect(ActionListResponseSchema.parse(pending.json()).items).toEqual([]);

    const response = await approve(app, item.id, 409);
    expect(response.json<{ error: string }>().error).toBe("action_expired");
    const [row] = await app.db.select().from(actionRequests).where(eq(actionRequests.id, item.id));
    expect(row?.status).toBe("expired");
    expect(row?.finishedAt).not.toBeNull();
    expect(await app.db.select().from(tasks)).toHaveLength(0);
  });

  it("a target that vanished between request and approval fails the request with target_not_found and writes nothing", async () => {
    const taskId = await seedTask(app);
    const item = await propose(app, {
      action_id: "complete_task",
      input: { task_id: taskId },
      source: "manual",
    });
    await app.db.delete(tasks).where(eq(tasks.id, taskId));
    const response = await approve(app, item.id);
    const failed = ActionRequestItemSchema.parse(response.json());
    expect(failed.status).toBe("failed");
    expect(failed.error_class).toBe("target_not_found");
    expect(failed.finished_at).not.toBeNull();
  });

  it("approving an unknown id is a 404", async () => {
    const response = await approve(app, crypto.randomUUID(), 404);
    expect(response.json<ErrorBody>().error).toBe("action_not_found");
  });

  it("the stored input is what executes: editing the row's input changes the created task", async () => {
    const item = await propose(app, createTaskBody());
    await app.db
      .update(actionRequests)
      .set({ input: { title: "Edited in storage", timezone: "UTC" } })
      .where(eq(actionRequests.id, item.id));
    const done = ActionRequestItemSchema.parse((await approve(app, item.id)).json());
    const [task] = await app.db.select().from(tasks).where(eq(tasks.id, done.target_id!));
    expect(task?.title).toBe("Edited in storage");
  });

  it("a stored input that no longer parses fails with input_invalid rather than executing", async () => {
    const item = await propose(app, createTaskBody());
    await app.db
      .update(actionRequests)
      .set({ input: { title: "", timezone: "UTC" } })
      .where(eq(actionRequests.id, item.id));
    const failed = ActionRequestItemSchema.parse((await approve(app, item.id)).json());
    expect(failed.status).toBe("failed");
    expect(failed.error_class).toBe("input_invalid");
    expect(await app.db.select().from(tasks)).toHaveLength(0);
  });

  // ---- reversibility ------------------------------------------------------

  it("undo: a completed create_task is reversed by an approved archive_task, and the original reports reversed_by_request_id", async () => {
    const created = ActionRequestItemSchema.parse(
      (await approve(app, (await propose(app, createTaskBody())).id)).json(),
    );
    const undo = await propose(app, {
      action_id: "archive_task",
      input: { task_id: created.target_id },
      source: "manual",
      reason: `Undo: ${created.input_summary}`,
      reverses_request_id: created.id,
    });
    expect(undo.reverses_request_id).toBe(created.id);
    // Not undone until the reversal actually completes.
    let original = await app.inject({ method: "GET", url: `/actions/${created.id}` });
    expect(ActionRequestItemSchema.parse(original.json()).reversed_by_request_id).toBeNull();

    const done = ActionRequestItemSchema.parse((await approve(app, undo.id)).json());
    expect(done.status).toBe("completed");
    const [task] = await app.db.select().from(tasks).where(eq(tasks.id, created.target_id!));
    expect(task?.archivedAt).not.toBeNull();
    original = await app.inject({ method: "GET", url: `/actions/${created.id}` });
    expect(ActionRequestItemSchema.parse(original.json()).reversed_by_request_id).toBe(undo.id);
  });

  it("refuses an undo that names the wrong action, an unfinished request, or another target", async () => {
    const taskId = await seedTask(app);
    const pending = await propose(app, {
      action_id: "complete_task",
      input: { task_id: taskId },
      source: "manual",
    });
    const wrongAction = await app.inject({
      method: "POST",
      url: "/actions",
      payload: {
        action_id: "archive_task",
        input: { task_id: taskId },
        source: "manual",
        reverses_request_id: pending.id,
      },
    });
    expect(wrongAction.statusCode).toBe(400);
    expect(wrongAction.json<ErrorBody>().error).toBe("validation_failed");

    const completed = ActionRequestItemSchema.parse((await approve(app, pending.id)).json());
    const otherTask = await seedTask(app, { title: "Other" });
    const wrongTarget = await app.inject({
      method: "POST",
      url: "/actions",
      payload: {
        action_id: "reopen_task",
        input: { task_id: otherTask },
        source: "manual",
        reverses_request_id: completed.id,
      },
    });
    expect(wrongTarget.statusCode).toBe(400);
    expect(wrongTarget.json<{ issues: { path: string[] }[] }>().issues[0]?.path).toEqual([
      "reverses_request_id",
    ]);
  });

  // ---- calendar --------------------------------------------------------

  it("create_calendar_event creates a local, unlinked, timed event on approval", async () => {
    const item = await propose(app, {
      action_id: "create_calendar_event",
      input: {
        title: "Study: Biology",
        starts_at: "2026-09-18T20:00:00-05:00",
        ends_at: "2026-09-18T21:00:00-05:00",
        timezone: "America/Chicago",
      },
      source: "focus_now",
      source_ref: "canvas_assignment",
    });
    const done = ActionRequestItemSchema.parse((await approve(app, item.id)).json());
    expect(done.status).toBe("completed");
    expect(done.target_type).toBe("event");
    const [event] = await app.db.select().from(events).where(eq(events.id, done.target_id!));
    expect(event?.origin).toBe("local");
    expect(event?.startsAt?.toISOString()).toBe("2026-09-19T01:00:00.000Z");
    expect(event?.rrule).toBeNull();
  });

  it("archive_calendar_event refuses an external (synced) event at request time", async () => {
    const eventId = await seedEvent(app, { origin: "external" });
    const response = await app.inject({
      method: "POST",
      url: "/actions",
      payload: {
        action_id: "archive_calendar_event",
        input: { event_id: eventId },
        source: "manual",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  // ---- list / detail / summary ------------------------------------------

  it("lists newest first with an honest total, filters by status and action_id, and the summary counts pending", async () => {
    const first = await propose(app, createTaskBody());
    await approve(app, first.id);
    const second = await propose(app, createTaskBody({ input: { title: "B", timezone: "UTC" } }));
    const all = ActionListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/actions" })).json(),
    );
    expect(all.total).toBe(2);
    expect(all.items.map((i) => i.id)).toEqual([second.id, first.id]);
    const completed = ActionListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/actions?status=completed" })).json(),
    );
    expect(completed.items.map((i) => i.id)).toEqual([first.id]);
    const byAction = ActionListResponseSchema.parse(
      (await app.inject({ method: "GET", url: "/actions?action_id=reopen_task" })).json(),
    );
    expect(byAction.total).toBe(0);
    const summary = ActionsSummarySchema.parse(
      (await app.inject({ method: "GET", url: "/actions/summary" })).json(),
    );
    expect(summary).toEqual({
      pending_total: 1,
      completed_last_7_days: 1,
      permissions_granted: 2,
      permissions_total: 2,
    });
    const unknown = await app.inject({ method: "GET", url: `/actions/${crypto.randomUUID()}` });
    expect(unknown.statusCode).toBe(404);
  });
});

describe("action routes never log a title, a summary or a reason (ADR-078 §4)", () => {
  const chunks: string[] = [];
  const stream = new PassThrough();
  stream.on("data", (chunk: Buffer) => chunks.push(chunk.toString("utf8")));
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp({ logDestination: stream });
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    deviceToken = await pairTestDevice(app);
    chunks.length = 0;
  });

  it("carries only ids, action ids and classes across propose, approve, cancel and revoke", async () => {
    const coreRecords: Record<string, unknown>[] = [];
    const restore = setLogSink({
      write: (_level, record) => {
        coreRecords.push(record);
      },
    });
    try {
      const item = await propose(app, createTaskBody({ reason: "ZanzibarReason" }));
      await approve(app, item.id);
      const other = await propose(
        app,
        createTaskBody({ input: { title: "Zanzibar title", timezone: "UTC" } }),
      );
      await app.inject({
        method: "POST",
        url: `/actions/${other.id}/cancel`,
        headers: agentHeaders(deviceToken),
      });
      await propose(app, createTaskBody({ input: { title: "Zanzibar again", timezone: "UTC" } }));
      await revoke(app, "tasks.write");
      // Refusals go through the error path too.
      await app.inject({ method: "POST", url: "/actions", payload: createTaskBody() });
      await app.inject({
        method: "PATCH",
        url: "/permissions/tasks.write",
        headers: agentHeaders(deviceToken),
        payload: { granted: true },
      });
      // A Zod 400 (the body echoes issues, never the input) ...
      await app.inject({
        method: "POST",
        url: "/actions",
        payload: createTaskBody({ input: { title: "Zanzibar bad", timezone: "Not/AZone" } }),
      });
      // ... a prepare-time refusal (unknown target) ...
      await app.inject({
        method: "POST",
        url: "/actions",
        payload: {
          action_id: "complete_task",
          input: { task_id: crypto.randomUUID() },
          source: "manual",
        },
      });
      // ... and an execution failure: the target vanishes between request and approval.
      const taskId = await seedTask(app, { title: "Zanzibar target" });
      const doomed = await propose(app, {
        action_id: "complete_task",
        input: { task_id: taskId },
        source: "manual",
      });
      await app.db.delete(tasks).where(eq(tasks.id, taskId));
      const failed = ActionRequestItemSchema.parse((await approve(app, doomed.id)).json());
      expect(failed.status).toBe("failed");
    } finally {
      restore();
    }
    const joined = chunks.join("") + JSON.stringify(coreRecords);
    expect(joined).toContain("action.requested");
    expect(joined).toContain("action.completed");
    expect(joined).toContain("action.cancelled");
    expect(joined).toContain("permission.updated");
    expect(joined).toContain("action.failed");
    expect(joined).not.toContain("Zanzibar");
    expect(joined).not.toContain(TITLE);
  });
});
