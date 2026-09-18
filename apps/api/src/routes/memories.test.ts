import { setLogSink } from "@personal-os/core/logging/logger";
import {
  canvasConnections,
  canvasCourses,
  memories,
  memorySettings,
  memorySuggestions,
  projects,
} from "@personal-os/db";
import {
  MEMORY_STATEMENT_MAX_CHARS,
  MemoryItemSchema,
  MemoryListResponseSchema,
  tooLongMessage,
  type MemoryItem,
  type MemoryListResponse,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { readFileSync } from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.7 (ADR-077) -- the memory CRUD routes.

interface ValidationIssue {
  code: string;
  path: (string | number)[];
  message: string;
}

async function clearMemoryTables(app: FastifyInstance): Promise<void> {
  // memories references memory_suggestions (set null) and canvas_courses
  // (set null); canvas_connections cascades to courses. truncateTestTables
  // already clears projects.
  await app.db.delete(memories);
  await app.db.delete(memorySuggestions);
  await app.db.delete(memorySettings);
  await app.db.delete(canvasConnections);
}

async function seedProject(app: FastifyInstance, name = "Thesis", archived = false) {
  const [row] = await app.db
    .insert(projects)
    .values({ name, archivedAt: archived ? new Date("2026-08-01T00:00:00Z") : null })
    .returning({ id: projects.id });
  return row!.id;
}

async function seedCourse(
  app: FastifyInstance,
  name = "Databases",
  courseCode: string | null = "CSE-3330",
) {
  const [connection] = await app.db
    .insert(canvasConnections)
    .values({
      canvasBaseUrl: `https://${crypto.randomUUID()}.instructure.com`,
      canvasUserId: 1,
      canvasUserName: "Test Student",
      status: "active",
    })
    .returning({ id: canvasConnections.id });
  const [course] = await app.db
    .insert(canvasCourses)
    .values({ connectionId: connection!.id, canvasCourseId: 1, name, courseCode })
    .returning({ id: canvasCourses.id });
  return course!.id;
}

async function createMemory(
  app: FastifyInstance,
  payload: Record<string, unknown> = {},
): Promise<MemoryItem> {
  const response = await app.inject({
    method: "POST",
    url: "/memories",
    payload: { kind: "preference", statement: "I work best in the evening", ...payload },
  });
  expect(response.statusCode).toBe(201);
  return MemoryItemSchema.parse(response.json());
}

describe("memories routes", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    await clearMemoryTables(app);
  });

  // ---- create ---------------------------------------------------------

  it("creates a memory with source=user, no provenance link, and null resolved links", async () => {
    const created = await createMemory(app, { note: "since Phase 2" });
    expect(created.kind).toBe("preference");
    expect(created.statement).toBe("I work best in the evening");
    expect(created.note).toBe("since Phase 2");
    expect(created.source).toBe("user");
    expect(created.suggestion_id).toBeNull();
    expect(created.project_id).toBeNull();
    expect(created.canvas_course_id).toBeNull();
    expect(created.project).toBeNull();
    expect(created.course).toBeNull();
    expect(created.updated_at).toBe(created.created_at);
  });

  it("trims the statement and stores a missing note as null", async () => {
    const created = await createMemory(app, { statement: "  spaced out  " });
    expect(created.statement).toBe("spaced out");
    expect(created.note).toBeNull();
  });

  it("resolves the linked project's and course's display names on create", async () => {
    const projectId = await seedProject(app, "Thesis");
    const courseId = await seedCourse(app, "Databases", "CSE-3330");
    const created = await createMemory(app, {
      kind: "goal",
      project_id: projectId,
      canvas_course_id: courseId,
    });
    expect(created.project).toEqual({ id: projectId, name: "Thesis" });
    expect(created.course).toEqual({ id: courseId, name: "Databases", course_code: "CSE-3330" });
  });

  it("still resolves an ARCHIVED project -- the memory keeps its context", async () => {
    const projectId = await seedProject(app, "Old thesis", true);
    const created = await createMemory(app, { project_id: projectId });
    expect(created.project).toEqual({ id: projectId, name: "Old thesis" });
  });

  it("REJECTS a client-supplied source (strict body) -- provenance is server-assigned", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "fact", statement: "x", source: "suggestion" },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json<ErrorBody>().error).toBe("validation_failed");
  });

  it("REJECTS a client-supplied suggestion_id on create", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "fact", statement: "x", suggestion_id: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(400);
  });

  it("REJECTS an over-long statement with the bound's own message, never truncating", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "fact", statement: "x".repeat(MEMORY_STATEMENT_MAX_CHARS + 1) },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody & { issues: ValidationIssue[] }>();
    expect(body.error).toBe("validation_failed");
    expect(body.issues.map((issue) => issue.message)).toContain(
      tooLongMessage("statement", MEMORY_STATEMENT_MAX_CHARS),
    );
    expect(await app.db.select({ id: memories.id }).from(memories)).toHaveLength(0);
  });

  it("REJECTS an unknown project_id with a 400 issue on that field, before writing", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "goal", statement: "x", project_id: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody & { issues: ValidationIssue[] }>();
    expect(body.error).toBe("validation_failed");
    expect(body.issues[0]!.path).toEqual(["project_id"]);
    expect(await app.db.select({ id: memories.id }).from(memories)).toHaveLength(0);
  });

  it("REJECTS an unknown canvas_course_id with a 400 issue on that field", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/memories",
      payload: { kind: "goal", statement: "x", canvas_course_id: crypto.randomUUID() },
    });
    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody & { issues: ValidationIssue[] }>();
    expect(body.issues[0]!.path).toEqual(["canvas_course_id"]);
  });

  it("REJECTS an empty statement and an unknown kind", async () => {
    for (const payload of [
      { kind: "fact", statement: "   " },
      { kind: "habit", statement: "x" },
    ]) {
      const response = await app.inject({ method: "POST", url: "/memories", payload });
      expect(response.statusCode).toBe(400);
    }
  });

  // ---- list / get -----------------------------------------------------

  it("lists newest-edited first with an honest total and pagination", async () => {
    const a = await createMemory(app, { statement: "a" });
    const b = await createMemory(app, { statement: "b" });
    const c = await createMemory(app, { statement: "c" });
    // Editing `a` makes it the most recently updated.
    await app.inject({ method: "PATCH", url: `/memories/${a.id}`, payload: { note: "edited" } });

    const list = await app.inject({ method: "GET", url: "/memories" });
    expect(list.statusCode).toBe(200);
    const body = MemoryListResponseSchema.parse(list.json());
    expect(body.total).toBe(3);
    expect(body.items.map((item) => item.id)).toEqual([a.id, c.id, b.id]);

    const page = await app.inject({ method: "GET", url: "/memories?limit=1&offset=1" });
    const pageBody = page.json<MemoryListResponse>();
    expect(pageBody.items.map((item) => item.id)).toEqual([c.id]);
    expect(pageBody).toMatchObject({ limit: 1, offset: 1, total: 3 });
  });

  it("filters by kind, project_id and canvas_course_id", async () => {
    const projectId = await seedProject(app);
    const courseId = await seedCourse(app);
    const goal = await createMemory(app, { kind: "goal", project_id: projectId });
    const fact = await createMemory(app, { kind: "fact", canvas_course_id: courseId });
    await createMemory(app, { kind: "preference" });

    const byKind = (
      await app.inject({ method: "GET", url: "/memories?kind=goal" })
    ).json<MemoryListResponse>();
    expect(byKind.items.map((item) => item.id)).toEqual([goal.id]);
    expect(byKind.total).toBe(1);

    const byProject = (
      await app.inject({ method: "GET", url: `/memories?project_id=${projectId}` })
    ).json<MemoryListResponse>();
    expect(byProject.items.map((item) => item.id)).toEqual([goal.id]);

    const byCourse = (
      await app.inject({ method: "GET", url: `/memories?canvas_course_id=${courseId}` })
    ).json<MemoryListResponse>();
    expect(byCourse.items.map((item) => item.id)).toEqual([fact.id]);
    expect(byCourse.items[0]!.course?.name).toBe("Databases");
  });

  it("rejects a malformed list query", async () => {
    const response = await app.inject({ method: "GET", url: "/memories?kind=habit" });
    expect(response.statusCode).toBe(400);
  });

  it("gets one memory, 404s an unknown id, and 400s a malformed id", async () => {
    const created = await createMemory(app);
    const found = await app.inject({ method: "GET", url: `/memories/${created.id}` });
    expect(found.statusCode).toBe(200);
    expect(MemoryItemSchema.parse(found.json())).toEqual(created);

    const missing = await app.inject({ method: "GET", url: `/memories/${crypto.randomUUID()}` });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorBody>()).toEqual({ error: "memory_not_found" });

    const malformed = await app.inject({ method: "GET", url: "/memories/not-a-uuid" });
    expect(malformed.statusCode).toBe(400);
  });

  // ---- update ---------------------------------------------------------

  it("patches kind, statement, note and links, bumping updated_at", async () => {
    const projectId = await seedProject(app, "Thesis");
    const created = await createMemory(app);
    await new Promise((resolve) => setTimeout(resolve, 5));

    const patched = await app.inject({
      method: "PATCH",
      url: `/memories/${created.id}`,
      payload: { kind: "goal", statement: "Defend by May", note: "n", project_id: projectId },
    });
    expect(patched.statusCode).toBe(200);
    const body = MemoryItemSchema.parse(patched.json());
    expect(body).toMatchObject({
      kind: "goal",
      statement: "Defend by May",
      note: "n",
      project_id: projectId,
      project: { id: projectId, name: "Thesis" },
      source: "user",
    });
    expect(Date.parse(body.updated_at)).toBeGreaterThan(Date.parse(created.updated_at));
    expect(body.created_at).toBe(created.created_at);

    const cleared = await app.inject({
      method: "PATCH",
      url: `/memories/${created.id}`,
      payload: { note: null, project_id: null },
    });
    const clearedBody = MemoryItemSchema.parse(cleared.json());
    expect(clearedBody.note).toBeNull();
    expect(clearedBody.project_id).toBeNull();
    expect(clearedBody.project).toBeNull();
  });

  it("can NEVER change source or suggestion_id -- provenance is immutable", async () => {
    const projectId = await seedProject(app);
    const [suggestion] = await app.db
      .insert(memorySuggestions)
      .values({
        suggestionKey: `project_goal:${projectId}`,
        suggestionKind: "project_goal",
        projectId,
        status: "accepted",
      })
      .returning({ id: memorySuggestions.id });
    const [row] = await app.db
      .insert(memories)
      .values({
        kind: "goal",
        statement: "Defend by May",
        source: "suggestion",
        suggestionId: suggestion!.id,
        projectId,
      })
      .returning({ id: memories.id });

    for (const payload of [
      { source: "user" },
      { suggestion_id: null },
      { statement: "edited", source: "user" },
    ]) {
      const response = await app.inject({ method: "PATCH", url: `/memories/${row!.id}`, payload });
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    }

    const edited = await app.inject({
      method: "PATCH",
      url: `/memories/${row!.id}`,
      payload: { statement: "Defend by June" },
    });
    expect(edited.statusCode).toBe(200);
    const body = MemoryItemSchema.parse(edited.json());
    expect(body.source).toBe("suggestion");
    expect(body.suggestion_id).toBe(suggestion!.id);
    expect(body.statement).toBe("Defend by June");
  });

  it("rejects an empty patch, an over-long patch, an unknown link, and 404s an unknown id", async () => {
    const created = await createMemory(app);
    expect(
      (await app.inject({ method: "PATCH", url: `/memories/${created.id}`, payload: {} }))
        .statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          method: "PATCH",
          url: `/memories/${created.id}`,
          payload: { statement: "x".repeat(MEMORY_STATEMENT_MAX_CHARS + 1) },
        })
      ).statusCode,
    ).toBe(400);
    const badLink = await app.inject({
      method: "PATCH",
      url: `/memories/${created.id}`,
      payload: { canvas_course_id: crypto.randomUUID() },
    });
    expect(badLink.statusCode).toBe(400);
    expect(badLink.json<ErrorBody & { issues: ValidationIssue[] }>().issues[0]!.path).toEqual([
      "canvas_course_id",
    ]);
    const missing = await app.inject({
      method: "PATCH",
      url: `/memories/${crypto.randomUUID()}`,
      payload: { note: "x" },
    });
    expect(missing.statusCode).toBe(404);
    expect(missing.json<ErrorBody>()).toEqual({ error: "memory_not_found" });
  });

  // ---- delete ---------------------------------------------------------

  it("deletes a memory for real: 204, then 404, then gone from the table", async () => {
    const created = await createMemory(app);
    const deleted = await app.inject({ method: "DELETE", url: `/memories/${created.id}` });
    expect(deleted.statusCode).toBe(204);
    expect(deleted.body).toBe("");

    const again = await app.inject({ method: "DELETE", url: `/memories/${created.id}` });
    expect(again.statusCode).toBe(404);
    expect(again.json<ErrorBody>()).toEqual({ error: "memory_not_found" });
    expect(await app.db.select({ id: memories.id }).from(memories)).toHaveLength(0);
  });

  it("deletes every memory with the literal confirmation and reports the count", async () => {
    await createMemory(app, { statement: "a" });
    await createMemory(app, { statement: "b" });
    const response = await app.inject({
      method: "POST",
      url: "/memories/delete-all",
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: 2 });
    expect(
      (await app.inject({ method: "GET", url: "/memories" })).json<MemoryListResponse>().total,
    ).toBe(0);
  });

  it("refuses delete-all without the literal true, and writes nothing", async () => {
    await createMemory(app);
    for (const payload of [
      { confirm: false },
      {},
      { confirm: "true" },
      { confirm: true, extra: 1 },
    ]) {
      const response = await app.inject({ method: "POST", url: "/memories/delete-all", payload });
      expect(response.statusCode).toBe(400);
    }
    expect(await app.db.select({ id: memories.id }).from(memories)).toHaveLength(1);
  });

  it("routes /memories/delete-all to the bulk delete, never to /memories/:id", async () => {
    // With no rows at all, a request captured as `:id = "delete-all"` would
    // fail the uuid params check (400); the static route answers 200 {deleted:0}.
    const response = await app.inject({
      method: "POST",
      url: "/memories/delete-all",
      payload: { confirm: true },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deleted: 0 });
  });

  // ---- structural pins ------------------------------------------------

  it("the retention sweep names no memory table -- nothing ever auto-deletes a memory (ADR-077 §2)", () => {
    const retention = readFileSync(
      path.resolve(import.meta.dirname, "../../../worker/src/jobs/retention-cleanup.ts"),
      "utf8",
    );
    expect(retention.length).toBeGreaterThan(1000);
    expect(/memor/i.test(retention)).toBe(false);
  });
});

describe("memory routes never log a statement (ADR-077 §6)", () => {
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
    await clearMemoryTables(app);
    chunks.length = 0;
  });

  it("carries no memory text in the request log or the core logger across the whole CRUD cycle", async () => {
    const coreRecords: Record<string, unknown>[] = [];
    const restore = setLogSink({
      write: (_level, record) => {
        coreRecords.push(record);
      },
    });
    let id: string;
    try {
      const created = await createMemory(app, {
        statement: "Zanzibar widget",
        note: "Zanzibar note",
      });
      id = created.id;
      await app.inject({ method: "GET", url: "/memories" });
      await app.inject({ method: "GET", url: `/memories/${id}` });
      await app.inject({
        method: "PATCH",
        url: `/memories/${id}`,
        payload: { statement: "Zanzibar edited" },
      });
      // A validation failure and an unknown-link failure both go through the
      // error path; neither may echo the statement into a log line.
      await app.inject({
        method: "POST",
        url: "/memories",
        payload: { kind: "fact", statement: "Zanzibar " + "x".repeat(MEMORY_STATEMENT_MAX_CHARS) },
      });
      await app.inject({
        method: "POST",
        url: "/memories",
        payload: { kind: "fact", statement: "Zanzibar linked", project_id: crypto.randomUUID() },
      });
      await app.inject({ method: "DELETE", url: `/memories/${id}` });
    } finally {
      restore();
    }
    await new Promise((resolve) => setImmediate(resolve));
    const logs = chunks.join("");
    expect(logs).toContain("request completed");
    expect(logs.toLowerCase()).not.toContain("zanzibar");
    expect(JSON.stringify(coreRecords).toLowerCase()).not.toContain("zanzibar");
  });

  it("carries no memory text when the INSERT itself fails at the database (a DrizzleQueryError quotes its params)", async () => {
    // The 10.7 adversarial review reproduced drizzle-orm wrapping a failed
    // statement as `Failed query: <sql>\nparams: <bound values>` under the
    // plain name "Error", which the generic 500 path logs. Simulate the
    // transient failure at the driver boundary -- the exact error class the
    // ORM would throw -- and prove the statement never reaches the stream.
    const { DrizzleQueryError } = await import("drizzle-orm/errors");
    const originalInsert = app.db.insert.bind(app.db);
    const insertSpy = vi.spyOn(app.db, "insert").mockImplementation((table: unknown) => {
      const builder = originalInsert(table as never);
      const originalValues = builder.values.bind(builder);
      builder.values = (rows: unknown) => {
        const chain = originalValues(rows as never);
        chain.returning = () => {
          throw new DrizzleQueryError(
            'insert into "memories" ("kind", "statement") values ($1, $2) returning *',
            ["fact", "Zanzibar failing insert"],
            Object.assign(new Error("connection terminated unexpectedly"), { code: "57P01" }),
          );
        };
        return chain;
      };
      return builder;
    });
    try {
      const res = await app.inject({
        method: "POST",
        url: "/memories",
        payload: { kind: "fact", statement: "Zanzibar failing insert" },
      });
      expect(res.statusCode).toBe(500);
      expect(res.body.toLowerCase()).not.toContain("zanzibar");
    } finally {
      insertSpy.mockRestore();
    }
    await new Promise((resolve) => setImmediate(resolve));
    const logs = chunks.join("");
    expect(logs).toContain("DrizzleQueryError");
    expect(logs).toContain("57P01");
    expect(logs.toLowerCase()).not.toContain("zanzibar");
    expect(logs).not.toContain("insert into");
  });
});
