import { occurrences, tasks } from "@personal-os/db";
import type { Project, Task } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody, Paginated } from "../test/types.js";

describe("tasks routes", () => {
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

  it("creates a task with status active, not inbox", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Write tests", timezone: "America/Chicago" },
    });
    expect(response.statusCode).toBe(201);
    const body = response.json<Task>();
    expect(body.status).toBe("active");
    expect(body.archived_at).toBeNull();
  });

  it("rejects status/archived_at on create with 400, not a silent strip", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "bad", timezone: "America/Chicago", status: "done" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  describe("recurrence on tasks", () => {
    it("creates a due-date task with recurrence and materializes 90-day occurrence window", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Daily due-date task",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.rrule).toBe("FREQ=DAILY;INTERVAL=1");
      expect(body.recurrence_anchor).toBe("due_date");
      expect(body.recurrence_timezone).toBe("America/Chicago");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      expect(occs.length).toBeGreaterThanOrEqual(89);
      expect(occs.every((o) => o.status === "scheduled" && !o.lazyGenerated)).toBe(true);
    });

    it("creates a completion-date task with recurrence and seeds a single lazy occurrence", async () => {
      const now = new Date();
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Completion-anchored task",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      expect(response.statusCode).toBe(201);
      const body = response.json<Task>();
      expect(body.rrule).toBe("FREQ=DAILY;INTERVAL=3");
      expect(body.recurrence_anchor).toBe("completion_date");

      const occs = await app.db.select().from(occurrences).where(eq(occurrences.parentId, body.id));
      expect(occs).toHaveLength(1);
      expect(occs[0]?.status).toBe("scheduled");
      expect(occs[0]?.lazyGenerated).toBe(true);
    });

    it("rejects mutual exclusivity of recurrence_until and recurrence_count with 400", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid recurrence",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_until: "2026-12-31T23:59:59.000Z",
          recurrence_count: 5,
        },
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });

    it("rejects completion_date task with recurrence_until, recurrence_count, or invalid rrule with 400", async () => {
      const untilResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid until",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_until: "2026-12-31T23:59:59.000Z",
        },
      });
      expect(untilResp.statusCode).toBe(400);

      const countResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid count",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=DAILY",
          recurrence_anchor: "completion_date",
          recurrence_count: 5,
        },
      });
      expect(countResp.statusCode).toBe(400);

      const complexRuleResp = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Invalid complex rrule",
          timezone: "America/Chicago",
          due_at: new Date().toISOString(),
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE",
          recurrence_anchor: "completion_date",
        },
      });
      expect(complexRuleResp.statusCode).toBe(400);
    });

    it("transitions due-date -> completion-date with overdue scheduled occurrence (verifying overdue row is deleted and single lazy row is created)", async () => {
      const pastDue = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000); // 5 days ago
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Due date to convert",
          timezone: "America/Chicago",
          due_at: pastDue.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add a done occurrence and a skipped occurrence in the past
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
        // Overdue scheduled occurrence
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
          status: "scheduled",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(patchResp.json<Task>().recurrence_anchor).toBe("completion_date");

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Overdue scheduled non-lazy row and all future scheduled non-lazy rows deleted
      const nonLazyScheduled = allOccs.filter((o) => !o.lazyGenerated && o.status === "scheduled");
      expect(nonLazyScheduled).toHaveLength(0);

      // Single lazy scheduled occurrence created
      const lazyScheduled = allOccs.filter((o) => o.lazyGenerated && o.status === "scheduled");
      expect(lazyScheduled).toHaveLength(1);

      // Done and skipped preserved
      const doneOccs = allOccs.filter((o) => o.status === "done");
      expect(doneOccs).toHaveLength(1);
      const skippedOccs = allOccs.filter((o) => o.status === "skipped");
      expect(skippedOccs).toHaveLength(1);
    });

    it("transitions completion-date -> due-date with overdue open lazy occurrence (verifying open lazy row is deleted and window is materialized)", async () => {
      const pastDue = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Completion date to convert",
          timezone: "America/Chicago",
          due_at: pastDue.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=3",
          recurrence_anchor: "completion_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add done & skipped rows
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: true,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 6 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: true,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
          due_at: new Date().toISOString(),
        },
      });
      expect(patchResp.statusCode).toBe(200);
      expect(patchResp.json<Task>().recurrence_anchor).toBe("due_date");

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Open lazy scheduled row deleted
      const lazyScheduled = allOccs.filter((o) => o.lazyGenerated && o.status === "scheduled");
      expect(lazyScheduled).toHaveLength(0);

      // 90-day window materialized
      const nonLazyScheduled = allOccs.filter((o) => !o.lazyGenerated && o.status === "scheduled");
      expect(nonLazyScheduled.length).toBeGreaterThanOrEqual(89);

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    it("clears recurrence with overdue scheduled occurrence (verifying overdue row is deleted and parent becomes non-recurring)", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Clear recurrence test",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      // Add overdue scheduled, done, and skipped rows
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 5 * 24 * 60 * 60 * 1000),
          status: "scheduled",
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: { rrule: null },
      });
      expect(patchResp.statusCode).toBe(200);
      const body = patchResp.json<Task>();
      expect(body.rrule).toBeNull();
      expect(body.recurrence_anchor).toBeNull();
      expect(body.recurrence_timezone).toBeNull();

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // ALL scheduled rows deleted (including overdue)
      expect(allOccs.filter((o) => o.status === "scheduled")).toHaveLength(0);

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });

    it("edits due-date task preserving overdue scheduled occurrence and completed/skipped occurrences", async () => {
      const now = new Date();
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: {
          title: "Due date edit preservation test",
          timezone: "America/Chicago",
          due_at: now.toISOString(),
          rrule: "FREQ=DAILY;INTERVAL=1",
          recurrence_anchor: "due_date",
        },
      });
      const taskId = created.json<Task>().id;

      const overdueInstant = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);
      await app.db.insert(occurrences).values([
        {
          parentType: "task",
          parentId: taskId,
          occursAt: overdueInstant,
          occursLocal: overdueInstant,
          status: "scheduled",
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          status: "done",
          completedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
          lazyGenerated: false,
        },
        {
          parentType: "task",
          parentId: taskId,
          occursAt: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          occursLocal: new Date(Date.now() - 8 * 24 * 60 * 60 * 1000),
          status: "skipped",
          lazyGenerated: false,
        },
      ]);

      const patchResp = await app.inject({
        method: "PATCH",
        url: `/tasks/${taskId}`,
        payload: {
          title: "Updated due date title",
          rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR",
        },
      });
      expect(patchResp.statusCode).toBe(200);

      const allOccs = await app.db
        .select()
        .from(occurrences)
        .where(eq(occurrences.parentId, taskId));

      // Overdue scheduled occurrence preserved
      const overdueOcc = allOccs.find(
        (o) => o.occursAt.getTime() === overdueInstant.getTime() && o.status === "scheduled",
      );
      expect(overdueOcc).toBeDefined();

      // Done and skipped preserved
      expect(allOccs.filter((o) => o.status === "done")).toHaveLength(1);
      expect(allOccs.filter((o) => o.status === "skipped")).toHaveLength(1);
    });
  });

  it("resolves an offset-less due_at against the supplied timezone", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: {
        title: "Chicago afternoon",
        timezone: "America/Chicago",
        due_at: "2026-08-20T15:00:00",
      },
    });
    expect(response.statusCode).toBe(201);
    // 3pm CDT (UTC-5) -> 20:00 UTC.
    expect(response.json<Task>().due_at).toBe("2026-08-20T20:00:00.000Z");
  });

  it("lists, filters by project_id and status, and paginates", async () => {
    const project = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "QA project" },
    });
    const projectId = project.json<Project>().id;

    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "In project", timezone: "America/Chicago", project_id: projectId },
    });
    await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "No project", timezone: "America/Chicago" },
    });

    const scoped = await app.inject({ method: "GET", url: `/tasks?project_id=${projectId}` });
    expect(scoped.json<Paginated<Task>>().total).toBe(1);

    const all = await app.inject({ method: "GET", url: "/tasks" });
    expect(all.json<Paginated<Task>>().total).toBe(2);
  });

  it("updates a task, resolving due_at against its own stored timezone", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Edit me", timezone: "America/Chicago" },
    });
    const id = created.json<Task>().id;

    const patched = await app.inject({
      method: "PATCH",
      url: `/tasks/${id}`,
      payload: { priority: 1, due_at: "2026-09-01T09:00:00" },
    });
    expect(patched.statusCode).toBe(200);
    const body = patched.json<Task>();
    expect(body.priority).toBe(1);
    expect(body.due_at).toBe("2026-09-01T14:00:00.000Z"); // 9am CDT -> 14:00 UTC
  });

  it("404s on PATCH/archive/activate/complete/drop for an unknown id", async () => {
    const unknownId = "00000000-0000-0000-0000-000000000000";
    for (const req of [
      { method: "PATCH" as const, url: `/tasks/${unknownId}`, payload: { title: "x" } },
      { method: "POST" as const, url: `/tasks/${unknownId}/archive` },
      { method: "POST" as const, url: `/tasks/${unknownId}/drop` },
    ]) {
      const response = await app.inject(req);
      expect(response.statusCode).toBe(404);
    }
  });

  describe("activate", () => {
    it("promotes inbox -> active", async () => {
      const [row] = await app.db
        .insert(tasks)
        .values({ title: "Captured", status: "inbox", timezone: "America/Chicago" })
        .returning();
      const response = await app.inject({ method: "POST", url: `/tasks/${row!.id}/activate` });
      expect(response.statusCode).toBe(200);
      expect(response.json<Task>().status).toBe("active");
    });

    it("409s from any non-inbox status", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Already active", timezone: "America/Chicago" },
      });
      const response = await app.inject({
        method: "POST",
        url: `/tasks/${created.json<Task>().id}/activate`,
      });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>().error).toBe("invalid_status_transition");
    });
  });

  describe("complete", () => {
    it("completes a non-recurring task directly", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Plain task", timezone: "America/Chicago" },
      });
      const response = await app.inject({
        method: "POST",
        url: `/tasks/${created.json<Task>().id}/complete`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json<Task>();
      expect(body.status).toBe("done");
      expect(body.completed_at).not.toBeNull();
    });

    it("409s a recurring task and returns its open occurrence id", async () => {
      const [task] = await app.db
        .insert(tasks)
        .values({
          title: "Recurring",
          status: "active",
          timezone: "America/Chicago",
          dueAt: new Date(),
          rrule: "FREQ=WEEKLY;INTERVAL=1",
          recurrenceTimezone: "America/Chicago",
          recurrenceAnchor: "due_date",
        })
        .returning();
      const [occurrence] = await app.db
        .insert(occurrences)
        .values({
          parentType: "task",
          parentId: task!.id,
          occursAt: new Date(),
          occursLocal: new Date(),
          status: "scheduled",
        })
        .returning();

      const response = await app.inject({ method: "POST", url: `/tasks/${task!.id}/complete` });
      expect(response.statusCode).toBe(409);
      const body = response.json<ErrorBody>();
      expect(body.error).toBe("recurring_task_use_occurrence");
      expect(body.occurrence_id).toBe(occurrence!.id);
    });
  });

  describe("drop", () => {
    it("drops any task regardless of recurrence, idempotently", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Drop me", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      const first = await app.inject({ method: "POST", url: `/tasks/${id}/drop` });
      const second = await app.inject({ method: "POST", url: `/tasks/${id}/drop` });
      expect(first.statusCode).toBe(200);
      expect(second.statusCode).toBe(200);
      expect(second.json<Task>().status).toBe("dropped");
    });
  });

  describe("archive", () => {
    it("is independent of task status and hides from default list views without deleting anything", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Archive me", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      await app.inject({ method: "POST", url: `/tasks/${id}/complete` });

      const archived = await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      expect(archived.statusCode).toBe(200);
      const archivedBody = archived.json<Task>();
      expect(archivedBody.status).toBe("done"); // status and archived_at are independent axes
      expect(archivedBody.archived_at).not.toBeNull();

      const defaultList = await app.inject({ method: "GET", url: "/tasks" });
      expect(defaultList.json<Paginated<Task>>().total).toBe(0);

      const includeArchived = await app.inject({
        method: "GET",
        url: "/tasks?include_archived=true",
      });
      expect(includeArchived.json<Paginated<Task>>().total).toBe(1);

      const directGet = await app.inject({ method: "GET", url: `/tasks/${id}` });
      expect(directGet.statusCode).toBe(200);

      const [row] = await app.db.select().from(tasks).where(eq(tasks.id, id));
      expect(row).toBeDefined(); // the row itself was never deleted
    });

    it("re-archiving an already-archived task is a no-op, not an error", async () => {
      const created = await app.inject({
        method: "POST",
        url: "/tasks",
        payload: { title: "Double archive", timezone: "America/Chicago" },
      });
      const id = created.json<Task>().id;
      await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      const second = await app.inject({ method: "POST", url: `/tasks/${id}/archive` });
      expect(second.statusCode).toBe(200);
    });
  });
});
