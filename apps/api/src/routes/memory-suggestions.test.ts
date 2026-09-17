import {
  canvasConnections,
  memories,
  memorySettings,
  memorySuggestions,
  projects,
} from "@personal-os/db";
import {
  MEMORY_STATEMENT_MAX_CHARS,
  MEMORY_SUGGESTION_NOT_NOW_DAYS,
  MemoryItemSchema,
  MemorySuggestionDecideResponseSchema,
  MemorySuggestionsResponseSchema,
  PROJECT_GOAL_MAX_CHARS,
  memorySuggestionKey,
  type MemoryListResponse,
  type MemorySuggestion,
  type MemorySuggestionDecideResponse,
} from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MEMORY_SUGGESTIONS_MAX, listPendingMemorySuggestions } from "../read-models/memories.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

// Checkpoint 10.7 (ADR-077 §4) -- suggestions are computed, never stored;
// only the owner's answer persists.

const DAY_MS = 24 * 60 * 60 * 1000;

describe("memory suggestions", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    await app.db.delete(memories);
    await app.db.delete(memorySuggestions);
    await app.db.delete(memorySettings);
    await app.db.delete(canvasConnections);
  });

  async function seedProject(overrides: Partial<typeof projects.$inferInsert> = {}) {
    const [row] = await app.db
      .insert(projects)
      .values({ name: "Thesis", goal: "Defend by May", ...overrides })
      .returning({ id: projects.id });
    return row!.id;
  }

  async function list(): Promise<MemorySuggestion[]> {
    const response = await app.inject({ method: "GET", url: "/memory-suggestions" });
    expect(response.statusCode).toBe(200);
    return MemorySuggestionsResponseSchema.parse(response.json()).items;
  }

  function decide(key: string, payload: Record<string, unknown>) {
    return app.inject({
      method: "POST",
      url: `/memory-suggestions/${encodeURIComponent(key)}/decide`,
      payload,
    });
  }

  async function setEnabled(enabled: boolean): Promise<void> {
    const response = await app.inject({
      method: "PATCH",
      url: "/memory-settings",
      payload: { enabled },
    });
    expect(response.statusCode).toBe(200);
  }

  // ---- computation ----------------------------------------------------

  it("offers a project with a goal and no goal memory, citing the row it came from", async () => {
    const projectId = await seedProject();
    const items = await list();
    expect(items).toEqual([
      {
        key: memorySuggestionKey("project_goal", projectId),
        kind: "project_goal",
        memory_kind: "goal",
        statement: "Defend by May",
        evidence: "From the goal you set on Thesis",
        project: { id: projectId, name: "Thesis" },
      },
    ]);
    // Nothing was persisted by computing it.
    expect(await app.db.select().from(memorySuggestions)).toHaveLength(0);
  });

  it("never offers a project without a goal, with a blank goal, or archived", async () => {
    await seedProject({ goal: null });
    await seedProject({ goal: "   " });
    await seedProject({ archivedAt: new Date("2026-08-01T00:00:00Z") });
    expect(await list()).toEqual([]);
  });

  it("trims the goal and bounds the offered statement to the memory bound", async () => {
    const long = "g".repeat(PROJECT_GOAL_MAX_CHARS);
    await seedProject({ goal: `  ${long.slice(0, PROJECT_GOAL_MAX_CHARS - 4)}  ` });
    const [item] = await list();
    expect(item!.statement.length).toBeLessThanOrEqual(MEMORY_STATEMENT_MAX_CHARS);
    expect(item!.statement.startsWith("ggg")).toBe(true);
    // What is shown is acceptable as shown.
    const accepted = await decide(item!.key, { decision: "remember", statement: item!.statement });
    expect(accepted.statusCode).toBe(201);
  });

  it("stops offering once a GOAL memory is linked to the project -- a preference does not count", async () => {
    const projectId = await seedProject();
    await app.db
      .insert(memories)
      .values({ kind: "preference", statement: "p", source: "user", projectId });
    expect(await list()).toHaveLength(1);
    await app.db
      .insert(memories)
      .values({ kind: "goal", statement: "g", source: "user", projectId });
    expect(await list()).toEqual([]);
  });

  it("orders by the project's most recent edit, newest first, and caps the list", async () => {
    const older = await seedProject({ name: "Older", updatedAt: new Date("2026-08-01T00:00:00Z") });
    const newer = await seedProject({ name: "Newer", updatedAt: new Date("2026-09-01T00:00:00Z") });
    expect((await list()).map((item) => item.project?.id)).toEqual([newer, older]);

    for (let i = 0; i < MEMORY_SUGGESTIONS_MAX; i += 1) {
      await seedProject({ name: `P${i}`, updatedAt: new Date("2026-07-01T00:00:00Z") });
    }
    const capped = await list();
    expect(capped).toHaveLength(MEMORY_SUGGESTIONS_MAX);
    expect(capped[0]!.project?.id).toBe(newer);
  });

  // ---- deciding -------------------------------------------------------

  it("remember: writes the memory with suggestion provenance and the suggestion disappears", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const response = await decide(key, {
      decision: "remember",
      statement: "Defend the thesis by May",
      note: "edited before saving",
    });
    expect(response.statusCode).toBe(201);
    const body = MemorySuggestionDecideResponseSchema.parse(response.json());
    expect(body.key).toBe(key);
    expect(body.decision).toBe("remember");
    const memory = body.memory!;
    expect(memory).toMatchObject({
      kind: "goal",
      statement: "Defend the thesis by May",
      note: "edited before saving",
      source: "suggestion",
      project_id: projectId,
      project: { id: projectId, name: "Thesis" },
      canvas_course_id: null,
      course: null,
    });
    expect(memory.suggestion_id).not.toBeNull();

    const [decision] = await app.db.select().from(memorySuggestions);
    expect(decision).toMatchObject({
      id: memory.suggestion_id,
      suggestionKey: key,
      suggestionKind: "project_goal",
      projectId,
      status: "accepted",
      askAgainAfter: null,
    });
    // No statement text lives on the decision row.
    expect(
      Object.values(decision!).some((v) => typeof v === "string" && v.includes("Defend")),
    ).toBe(false);

    expect(await list()).toEqual([]);
    const listed = (
      await app.inject({ method: "GET", url: "/memories" })
    ).json<MemoryListResponse>();
    expect(listed.items.map((item) => item.id)).toEqual([memory.id]);
    expect(MemoryItemSchema.parse(listed.items[0])).toEqual(memory);
  });

  it("never: stores only the decision and the suggestion is gone for good", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const response = await decide(key, { decision: "never" });
    expect(response.statusCode).toBe(200);
    expect(response.json<MemorySuggestionDecideResponse>()).toEqual({
      key,
      decision: "never",
      memory: null,
    });
    expect(await app.db.select().from(memories)).toHaveLength(0);
    const [decision] = await app.db.select().from(memorySuggestions);
    expect(decision).toMatchObject({ status: "never", askAgainAfter: null, projectId });
    expect(await list()).toEqual([]);
    // Still gone far in the future.
    expect(await listPendingMemorySuggestions(app.db, new Date(Date.now() + 365 * DAY_MS))).toEqual(
      [],
    );
  });

  it("not_now: silences the key for the not-now window, then offers it again", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const before = Date.now();
    const response = await decide(key, { decision: "not_now" });
    expect(response.statusCode).toBe(200);
    expect(response.json<MemorySuggestionDecideResponse>()).toEqual({
      key,
      decision: "not_now",
      memory: null,
    });
    const [decision] = await app.db.select().from(memorySuggestions);
    expect(decision!.status).toBe("dismissed");
    const askAgain = decision!.askAgainAfter!.getTime();
    expect(askAgain).toBeGreaterThanOrEqual(
      before + MEMORY_SUGGESTION_NOT_NOW_DAYS * DAY_MS - 1000,
    );
    expect(askAgain).toBeLessThanOrEqual(
      Date.now() + MEMORY_SUGGESTION_NOT_NOW_DAYS * DAY_MS + 1000,
    );

    expect(await list()).toEqual([]);
    const justBefore = await listPendingMemorySuggestions(app.db, new Date(askAgain - 1000));
    expect(justBefore).toEqual([]);
    const after = await listPendingMemorySuggestions(app.db, new Date(askAgain + 1000));
    expect(after.map((item) => item.key)).toEqual([key]);
  });

  it("repeating the SAME decision is idempotent (200), including remember after the memory was deleted", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const first = await decide(key, { decision: "remember", statement: "Defend by May" });
    expect(first.statusCode).toBe(201);
    const memoryId = first.json<MemorySuggestionDecideResponse>().memory!.id;

    const again = await decide(key, { decision: "remember", statement: "a different edit" });
    expect(again.statusCode).toBe(200);
    const againBody = MemorySuggestionDecideResponseSchema.parse(again.json());
    expect(againBody.memory!.id).toBe(memoryId);
    // The stored statement is the one the owner confirmed the first time.
    expect(againBody.memory!.statement).toBe("Defend by May");
    expect(await app.db.select().from(memories)).toHaveLength(1);
    expect(await app.db.select().from(memorySuggestions)).toHaveLength(1);

    await app.inject({ method: "DELETE", url: `/memories/${memoryId}` });
    const afterDelete = await decide(key, { decision: "remember", statement: "x" });
    expect(afterDelete.statusCode).toBe(200);
    expect(afterDelete.json<MemorySuggestionDecideResponse>().memory).toBeNull();
    // Delete means delete: the answer stands and no second memory is written.
    expect(await app.db.select().from(memories)).toHaveLength(0);

    const neverTwice = memorySuggestionKey("project_goal", await seedProject({ name: "Other" }));
    expect((await decide(neverTwice, { decision: "never" })).statusCode).toBe(200);
    expect((await decide(neverTwice, { decision: "never" })).statusCode).toBe(200);
  });

  it("a DIFFERENT decision for an answered key is refused (409) and changes nothing", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    expect((await decide(key, { decision: "never" })).statusCode).toBe(200);

    const conflict = await decide(key, { decision: "remember", statement: "Defend by May" });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json<ErrorBody>()).toEqual({ error: "memory_suggestion_already_decided" });
    expect(await app.db.select().from(memories)).toHaveLength(0);
    const [decision] = await app.db.select().from(memorySuggestions);
    expect(decision!.status).toBe("never");

    const notNow = await decide(key, { decision: "not_now" });
    expect(notNow.statusCode).toBe(409);
  });

  it("remember requires a statement, and the key must be <kind>:<uuid>", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const noStatement = await decide(key, { decision: "remember" });
    expect(noStatement.statusCode).toBe(400);
    expect(noStatement.json<ErrorBody>().error).toBe("validation_failed");

    for (const bad of [
      "project_goal",
      `habit:${projectId}`,
      "project_goal:not-a-uuid",
      `:${projectId}`,
    ]) {
      const response = await decide(bad, { decision: "never" });
      expect(response.statusCode).toBe(400);
      const body = response.json<ErrorBody & { issues: { path: string[] }[] }>();
      expect(body.error).toBe("validation_failed");
      expect(body.issues[0]!.path).toEqual(["key"]);
    }
    expect(await app.db.select().from(memorySuggestions)).toHaveLength(0);

    const tooLong = await decide(key, {
      decision: "remember",
      statement: "x".repeat(MEMORY_STATEMENT_MAX_CHARS + 1),
    });
    expect(tooLong.statusCode).toBe(400);
    const extra = await decide(key, { decision: "never", extra: 1 });
    expect(extra.statusCode).toBe(400);
  });

  it("remember for a project that no longer exists is a 400 on project_id, and nothing is written", async () => {
    const key = memorySuggestionKey("project_goal", crypto.randomUUID());
    const response = await decide(key, { decision: "remember", statement: "x" });
    expect(response.statusCode).toBe(400);
    const body = response.json<ErrorBody & { issues: { path: string[] }[] }>();
    expect(body.issues[0]!.path).toEqual(["project_id"]);
    expect(await app.db.select().from(memorySuggestions)).toHaveLength(0);
    expect(await app.db.select().from(memories)).toHaveLength(0);
  });

  it("a deleted project leaves the memory (project_id set null) and the decision row intact", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    const accepted = await decide(key, { decision: "remember", statement: "Defend by May" });
    const memoryId = accepted.json<MemorySuggestionDecideResponse>().memory!.id;
    await app.db.delete(projects).where(eq(projects.id, projectId));

    const found = await app.inject({ method: "GET", url: `/memories/${memoryId}` });
    expect(found.statusCode).toBe(200);
    const item = MemoryItemSchema.parse(found.json());
    expect(item.project_id).toBeNull();
    expect(item.project).toBeNull();
    expect(item.source).toBe("suggestion");
    expect(item.suggestion_id).not.toBeNull();
  });

  // ---- the switch -----------------------------------------------------

  it("when the switch is off: the list is empty and a decision is refused 409", async () => {
    const projectId = await seedProject();
    const key = memorySuggestionKey("project_goal", projectId);
    await setEnabled(false);
    expect(await list()).toEqual([]);
    expect(await listPendingMemorySuggestions(app.db)).toEqual([]);

    const response = await decide(key, { decision: "remember", statement: "x" });
    expect(response.statusCode).toBe(409);
    expect(response.json<ErrorBody>()).toEqual({ error: "memory_disabled" });
    expect(await app.db.select().from(memorySuggestions)).toHaveLength(0);
    expect(await app.db.select().from(memories)).toHaveLength(0);

    await setEnabled(true);
    expect((await list()).map((item) => item.key)).toEqual([key]);
    expect((await decide(key, { decision: "never" })).statusCode).toBe(200);
  });
});
