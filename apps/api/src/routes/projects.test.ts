import type { Project, Task } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

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
      payload: { name: "Personal OS", color: "#336699" },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<Project>().id;

    const list = await app.inject({ method: "GET", url: "/projects" });
    const projects = list.json<Project[]>();
    expect(Array.isArray(projects)).toBe(true);
    expect(projects).toHaveLength(1);

    const patched = await app.inject({
      method: "PATCH",
      url: `/projects/${id}`,
      payload: { name: "Renamed" },
    });
    expect(patched.json<Project>().name).toBe("Renamed");
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
});
