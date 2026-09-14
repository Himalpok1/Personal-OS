import {
  ENTITY_TITLE_MAX_CHARS,
  PROJECT_GOAL_MAX_CHARS,
  tooLongMessage,
  type Project,
  type Task,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

const ACTIONS = ["pause", "resume", "complete", "reopen", "archive", "unarchive"] as const;

async function createProject(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<Project> {
  const response = await app.inject({
    method: "POST",
    url: "/projects",
    payload: { name: "P", ...payload },
  });
  expect(response.statusCode).toBe(201);
  return response.json<Project>();
}

async function getProject(app: FastifyInstance, id: string): Promise<Project> {
  const response = await app.inject({ method: "GET", url: `/projects/${id}` });
  expect(response.statusCode).toBe(200);
  return response.json<Project>();
}

describe("projects routes", () => {
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

  it("creates, lists (plain array, no pagination envelope), and updates a project", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/projects",
      payload: {
        name: "Personal OS",
        color: "#336699",
        goal: "Ship Phase 5",
        target_date: "2026-09-30",
      },
    });
    expect(created.statusCode).toBe(201);
    const createdBody = created.json<Project>();
    expect(createdBody.goal).toBe("Ship Phase 5");
    expect(createdBody.target_date).toBe("2026-09-30");
    // Lifecycle fields start empty -- transitions belong to Checkpoint 5.2.
    expect(createdBody.completed_at).toBeNull();
    expect(createdBody.updated_at).toBe(createdBody.created_at);
    const id = createdBody.id;

    const list = await app.inject({ method: "GET", url: "/projects" });
    const projects = list.json<Project[]>();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects).toHaveLength(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/projects/${id}`,
      payload: { name: "Renamed", goal: null, target_date: "2026-10-15" },
    });
    expect(patched.statusCode).toBe(200);
    const patchedBody = patched.json<Project>();
    expect(patchedBody.name).toBe("Renamed");
    expect(patchedBody.goal).toBeNull();
    expect(patchedBody.target_date).toBe("2026-10-15");
    expect(Date.parse(patchedBody.updated_at)).toBeGreaterThan(Date.parse(createdBody.updated_at));
  });

  it("rejects a status field on create/update -- projects.status stays unexposed in Phase 2", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "bad", status: "archived" },
    });
    expect(response.statusCode).toBe(400);
  });

  it("archiving a project does not orphan or archive its tasks/notes", async () => {
    const project = await app.inject({
      method: "POST",
      url: "/projects",
      payload: { name: "Owner project" },
    });
    const projectId = project.json<Project>().id;

    const task = await app.inject({
      method: "POST",
      url: "/tasks",
      payload: { title: "Scoped task", timezone: "America/Chicago", project_id: projectId },
    });
    const taskId = task.json<Task>().id;

    const archived = await app.inject({ method: "POST", url: `/projects/${projectId}/archive` });
    expect(archived.statusCode).toBe(200);
    expect(archived.json<Project>().archived_at).not.toBeNull();

    const defaultList = await app.inject({ method: "GET", url: "/projects" });
    expect(defaultList.json<Project[]>()).toHaveLength(0);

    const taskAfter = await app.inject({ method: "GET", url: `/tasks/${taskId}` });
    const taskAfterBody = taskAfter.json<Task>();
    expect(taskAfterBody.project_id).toBe(projectId); // never set to null -- nothing was deleted
    expect(taskAfterBody.archived_at).toBeNull(); // archiving a project doesn't archive its tasks
  });

  describe("PATCH tightening", () => {
    it.each([
      ["status", { name: "x", status: "paused" }],
      ["archived_at", { name: "x", archived_at: "2026-01-01T00:00:00.000Z" }],
      ["completed_at", { name: "x", completed_at: "2026-01-01T00:00:00.000Z" }],
      ["unknown field", { name: "x", bogus_field: 1 }],
    ])("rejects %s with 400 (strict schema)", async (_label, payload) => {
      const project = await createProject(app);
      const response = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(response.json<{ error: string }>().error).toBe("validation_failed");
    });

    it("rejects an empty body with 400 (at least one field required)", async () => {
      const project = await createProject(app);
      const before = await getProject(app, project.id);
      const response = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: {},
      });
      expect(response.statusCode).toBe(400);
      // A rejected patch must not have bumped anything.
      const after = await getProject(app, project.id);
      expect(after.updated_at).toBe(before.updated_at);
    });

    it("accepts name/color/goal/target_date and strictly advances updated_at across two PATCHes", async () => {
      const project = await createProject(app);

      const first = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: { color: "#112233", goal: null, target_date: null },
      });
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<Project>();
      expect(firstBody.color).toBe("#112233");
      expect(firstBody.goal).toBeNull();
      expect(firstBody.target_date).toBeNull();
      expect(Date.parse(firstBody.updated_at)).toBeGreaterThan(Date.parse(project.updated_at));

      const second = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: { name: "Renamed again" },
      });
      expect(second.statusCode).toBe(200);
      const secondBody = second.json<Project>();
      expect(secondBody.name).toBe("Renamed again");
      // Strictly advances, never equal -- even across rapid successive calls.
      expect(Date.parse(secondBody.updated_at)).toBeGreaterThan(Date.parse(firstBody.updated_at));
    });
  });

  describe("static route precedence", () => {
    it("GET /projects/summaries resolves the static handler, never :id", async () => {
      await createProject(app, { name: "Anything" });
      const response = await app.inject({ method: "GET", url: "/projects/summaries" });
      expect(response.statusCode).toBe(200);
      const body = response.json<{ items: unknown[] }>();
      // The parametric :id route would have tried a uuid lookup for
      // "summaries" (500ing on the cast) or returned a bare object; the
      // summaries envelope proves the static route won.
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.items).toHaveLength(1);
    });
  });

  describe("lifecycle actions", () => {
    it("404s every action for an unknown id", async () => {
      for (const action of ACTIONS) {
        const response = await app.inject({
          method: "POST",
          url: `/projects/00000000-0000-4000-8000-000000000000/${action}`,
        });
        expect(response.statusCode, `POST .../${action}`).toBe(404);
        expect(response.json<{ error: string }>().error).toBe("not_found");
      }
    });

    it("pause/resume round-trips and is idempotent without bumping updated_at", async () => {
      const created = await createProject(app);

      const paused = await app.inject({ method: "POST", url: `/projects/${created.id}/pause` });
      expect(paused.statusCode).toBe(200);
      const pausedBody = paused.json<Project>();
      expect(pausedBody.status).toBe("paused");
      expect(Date.parse(pausedBody.updated_at)).toBeGreaterThan(Date.parse(created.updated_at));

      const repaused = await app.inject({ method: "POST", url: `/projects/${created.id}/pause` });
      expect(repaused.statusCode).toBe(200);
      expect(repaused.json<Project>()).toEqual(pausedBody); // exact no-op

      const resumed = await app.inject({ method: "POST", url: `/projects/${created.id}/resume` });
      expect(resumed.statusCode).toBe(200);
      const resumedBody = resumed.json<Project>();
      expect(resumedBody.status).toBe("active");
      expect(Date.parse(resumedBody.updated_at)).toBeGreaterThan(Date.parse(pausedBody.updated_at));

      const reresumed = await app.inject({ method: "POST", url: `/projects/${created.id}/resume` });
      expect(reresumed.statusCode).toBe(200);
      expect(reresumed.json<Project>()).toEqual(resumedBody); // exact no-op
    });

    it.each(["pause", "resume"] as const)(
      "rejects %s on a completed project with 409 invalid_status_transition",
      async (action) => {
        const created = await createProject(app);
        await app.inject({ method: "POST", url: `/projects/${created.id}/complete` });
        const completedBefore = await getProject(app, created.id);

        const response = await app.inject({
          method: "POST",
          url: `/projects/${created.id}/${action}`,
        });
        expect(response.statusCode).toBe(409);
        expect(response.json<{ error: string; status: string }>()).toEqual({
          error: "invalid_status_transition",
          status: "completed",
        });

        const after = await getProject(app, created.id);
        expect(after).toEqual(completedBefore); // rejected transition mutates nothing
      },
    );

    it("complete stamps completed_at exactly once from active and preserves it idempotently", async () => {
      const created = await createProject(app);

      const completed = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/complete`,
      });
      expect(completed.statusCode).toBe(200);
      const completedBody = completed.json<Project>();
      expect(completedBody.status).toBe("completed");
      expect(completedBody.completed_at).not.toBeNull();
      expect(Date.parse(completedBody.updated_at)).toBeGreaterThan(Date.parse(created.updated_at));

      const recompleted = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/complete`,
      });
      expect(recompleted.statusCode).toBe(200);
      const recompletedBody = recompleted.json<Project>();
      expect(recompletedBody.completed_at).toBe(completedBody.completed_at); // original preserved
      expect(recompletedBody.updated_at).toBe(completedBody.updated_at); // no-op did not bump
    });

    it("completes directly from paused too", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/pause` });
      const completed = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/complete`,
      });
      expect(completed.statusCode).toBe(200);
      const body = completed.json<Project>();
      expect(body.status).toBe("completed");
      expect(body.completed_at).not.toBeNull();
    });

    it("reopen clears completed_at exactly once and is idempotent on active", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/complete` });
      const completedBefore = await getProject(app, created.id);

      const reopened = await app.inject({ method: "POST", url: `/projects/${created.id}/reopen` });
      expect(reopened.statusCode).toBe(200);
      const reopenedBody = reopened.json<Project>();
      expect(reopenedBody.status).toBe("active");
      expect(reopenedBody.completed_at).toBeNull();
      expect(Date.parse(reopenedBody.updated_at)).toBeGreaterThan(
        Date.parse(completedBefore.updated_at),
      );

      const rereopened = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/reopen`,
      });
      expect(rereopened.statusCode).toBe(200);
      expect(rereopened.json<Project>()).toEqual(reopenedBody); // exact no-op
    });

    it("rejects reopen on a paused project with 409 invalid_status_transition", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/pause` });
      const pausedBefore = await getProject(app, created.id);

      const response = await app.inject({ method: "POST", url: `/projects/${created.id}/reopen` });
      expect(response.statusCode).toBe(409);
      expect(response.json<{ error: string; status: string }>()).toEqual({
        error: "invalid_status_transition",
        status: "paused",
      });
      expect(await getProject(app, created.id)).toEqual(pausedBefore);
    });

    it("archive stamps once preserving status/completed_at; re-archive keeps the original timestamp", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/complete` });
      const completed = await getProject(app, created.id);
      expect(completed.completed_at).not.toBeNull();

      const archived = await app.inject({ method: "POST", url: `/projects/${created.id}/archive` });
      expect(archived.statusCode).toBe(200);
      const archivedBody = archived.json<Project>();
      expect(archivedBody.archived_at).not.toBeNull();
      expect(archivedBody.status).toBe("completed"); // lifecycle axis untouched
      expect(archivedBody.completed_at).toBe(completed.completed_at);
      expect(Date.parse(archivedBody.updated_at)).toBeGreaterThan(Date.parse(completed.updated_at));

      const rearchived = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/archive`,
      });
      expect(rearchived.statusCode).toBe(200);
      const rearchivedBody = rearchived.json<Project>();
      expect(rearchivedBody.archived_at).toBe(archivedBody.archived_at); // original timestamp preserved
      expect(rearchivedBody.updated_at).toBe(archivedBody.updated_at); // no bump on re-archive

      const defaultList = await app.inject({ method: "GET", url: "/projects" });
      expect(defaultList.json<Project[]>()).toHaveLength(0);
      const fullList = await app.inject({
        method: "GET",
        url: "/projects?include_archived=true",
      });
      expect(fullList.json<Project[]>()).toHaveLength(1);
    });

    it("unarchive clears archived_at restoring the exact underlying status, idempotently", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/pause` });
      await app.inject({ method: "POST", url: `/projects/${created.id}/archive` });
      const archived = await getProject(app, created.id);

      const unarchived = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/unarchive`,
      });
      expect(unarchived.statusCode).toBe(200);
      const unarchivedBody = unarchived.json<Project>();
      expect(unarchivedBody.archived_at).toBeNull();
      expect(unarchivedBody.status).toBe("paused"); // never forced back to active
      expect(Date.parse(unarchivedBody.updated_at)).toBeGreaterThan(
        Date.parse(archived.updated_at),
      );

      const reunarchived = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/unarchive`,
      });
      expect(reunarchived.statusCode).toBe(200);
      expect(reunarchived.json<Project>()).toEqual(unarchivedBody); // exact no-op
    });

    it("unarchive of a completed+archived project preserves completed_at", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/complete` });
      await app.inject({ method: "POST", url: `/projects/${created.id}/archive` });

      const unarchived = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/unarchive`,
      });
      expect(unarchived.statusCode).toBe(200);
      const body = unarchived.json<Project>();
      expect(body.status).toBe("completed");
      expect(body.completed_at).not.toBeNull();
      expect(body.archived_at).toBeNull();
    });

    it("unarchive of a non-archived project is a no-op without bumping updated_at", async () => {
      const created = await createProject(app);
      const response = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/unarchive`,
      });
      expect(response.statusCode).toBe(200);
      expect(response.json<Project>()).toEqual(created); // exact no-op
    });

    it("lifecycle actions work regardless of archive state (separate axes)", async () => {
      const created = await createProject(app);
      await app.inject({ method: "POST", url: `/projects/${created.id}/archive` });

      const completed = await app.inject({
        method: "POST",
        url: `/projects/${created.id}/complete`,
      });
      expect(completed.statusCode).toBe(200);
      const completedBody = completed.json<Project>();
      expect(completedBody.status).toBe("completed");
      expect(completedBody.archived_at).not.toBeNull(); // still archived
      expect(completedBody.completed_at).not.toBeNull();
    });
  });

  // Checkpoint 9.6 (ADR-065): user-typed text over a bound is REFUSED with
  // the field path -- never truncated -- and exactly-at-bound is accepted.
  describe("content bounds", () => {
    // The issue shape Zod emits; only the pieces these tests key on.
    type Issue = { path: (string | number)[]; message: string };

    it("refuses a name over ENTITY_TITLE_MAX_CHARS with 400 naming the field", async () => {
      const response = await app.inject({
        method: "POST",
        url: "/projects",
        payload: { name: "n".repeat(ENTITY_TITLE_MAX_CHARS + 1) },
      });
      expect(response.statusCode).toBe(400);
      const body = response.json<ErrorBody>();
      expect(body.error).toBe("validation_failed");
      expect((body.issues as Issue[])[0]?.path).toEqual(["name"]);
      expect((body.issues as Issue[])[0]?.message).toBe(
        tooLongMessage("name", ENTITY_TITLE_MAX_CHARS),
      );
    });

    it("refuses a goal over PROJECT_GOAL_MAX_CHARS on PATCH, leaving the row untouched", async () => {
      const project = await createProject(app, { goal: "ship" });
      const response = await app.inject({
        method: "PATCH",
        url: `/projects/${project.id}`,
        payload: { goal: "g".repeat(PROJECT_GOAL_MAX_CHARS + 1) },
      });
      expect(response.statusCode).toBe(400);
      expect((response.json<ErrorBody>().issues as Issue[])[0]?.path).toEqual(["goal"]);
      const after = await app.inject({ method: "GET", url: `/projects/${project.id}` });
      expect(after.json<Project>().goal).toBe("ship");
    });

    it("accepts a name and goal exactly at their bounds, byte-identical", async () => {
      const name = "e".repeat(ENTITY_TITLE_MAX_CHARS);
      const goal = "g".repeat(PROJECT_GOAL_MAX_CHARS);
      const project = await createProject(app, { name, goal });
      expect(project.name).toBe(name);
      expect(project.goal).toBe(goal);
    });
  });
});
