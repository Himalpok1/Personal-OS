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

  it("rejects rrule/status/archived_at on create with 400, not a silent strip", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "bad", timezone: "America/Chicago", rrule: "FREQ=DAILY" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
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
