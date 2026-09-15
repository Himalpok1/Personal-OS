// Route-level tests for POST /focus/suggestion (Checkpoint 9.8). Same harness
// as routes/ask.today.test.ts: real test database via
// buildTestApp/truncateTestTables + app.inject, with
// `../intelligence/today-context.js`'s `buildTodayContext` mocked (Lane
// scope: this route trusts buildTodayContext's own contract, proven by
// today-context.test.ts) and `resolveModelForTask`/`generateText` mocked.
import type * as AiProviders from "@personal-os/ai-providers";
import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import type { TodayContext } from "@personal-os/schema";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ASK_TODAY_CONSENT_FROM } from "../ask/contracts.js";
import type { TodayContextBuild, TodayContextCitation } from "../intelligence/today-context.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

vi.mock("@personal-os/ai-providers", async () => {
  const actual = await vi.importActual<typeof AiProviders>("@personal-os/ai-providers");
  return { ...actual, resolveModelForTask: vi.fn() };
});

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof Ai>("ai");
  return { ...actual, generateText: vi.fn() };
});

vi.mock("../intelligence/today-context.js", () => ({ buildTodayContext: vi.fn() }));

const { resolveModelForTask } = await import("@personal-os/ai-providers");
const { generateText } = await import("ai");
const { buildTodayContext } = await import("../intelligence/today-context.js");

const TZ = "America/Chicago";
const MODEL_ROW = "22222222-2222-4222-8222-222222222222";

function fakeModel(tag: string): LanguageModel {
  return { modelId: tag } as unknown as LanguageModel;
}

function singleCandidateChain(modelRowId: string): AiProviders.ResolvedModel {
  return { model: fakeModel("primary"), modelRowId, fallbacks: [], fallbackModelRowIds: [] };
}

type GenerateTextReturn = Awaited<ReturnType<typeof Ai.generateText>>;
function fakeGenerateTextResult(text: string): GenerateTextReturn {
  return {
    text,
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    finishReason: "stop",
  } as unknown as GenerateTextReturn;
}

function taskId(n: number): string {
  return `aaaaaaaa-aaaa-4aaa-8aaa-${n.toString().padStart(12, "0")}`;
}

function emptyTodayContext(): TodayContext {
  return {
    local_date: "2026-09-15",
    tz: TZ,
    now_local: "2026-09-15 09:00",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    upcoming: { items: [], total: 0 },
    events_today: { items: [], total: 0 },
    reminders: { items: [], total: 0, horizon_days: 7 },
    recently_completed: { items: [], total: 0 },
    projects_touched: [],
    open_loops: {
      inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, captures: [] },
      stalled_projects: { items: [], total: 0 },
      projects_without_next_action: { items: [], total: 0 },
      snoozed_within_horizon: { items: [], total: 0 },
      reviews: { daily_status: null, weekly_status: null },
    },
  };
}

function ctxTask(ref: number, title: string) {
  return {
    ref,
    title,
    due_local: "2026-09-15 09:00",
    project: null,
    priority: 1,
    recurring: false,
    has_reminder: false,
    snoozed: false,
  };
}

/**
 * A TodayContextBuild with `overdueCount` overdue tasks and `dueTodayCount`
 * due-today tasks (refs 1..N), and OPTIONALLY one further "upcoming" task
 * whose ref lies OUTSIDE the overdue/due_today candidate set -- used to prove
 * the route validates citations against the narrower candidate ref space, not
 * the full Today ref space.
 */
function todayBuild(
  overdueCount: number,
  dueTodayCount: number,
  options: { withOutOfScopeRef?: boolean } = {},
): TodayContextBuild {
  const context = emptyTodayContext();
  const citations: TodayContextCitation[] = [];
  let ref = 1;

  const overdueItems: TodayContext["overdue"]["items"] = [];
  for (let i = 0; i < overdueCount; i++) {
    const title = `Overdue task ${ref}`;
    overdueItems.push(ctxTask(ref, title));
    citations.push({
      ref,
      type: "task",
      id: taskId(ref),
      title,
      section: "overdue",
      detail: "P1",
    });
    ref += 1;
  }
  context.overdue = { items: overdueItems, total: overdueItems.length };
  context.summary.overdue_total = overdueItems.length;

  const dueTodayItems: TodayContext["due_today"]["items"] = [];
  for (let i = 0; i < dueTodayCount; i++) {
    const title = `Due-today task ${ref}`;
    dueTodayItems.push(ctxTask(ref, title));
    citations.push({ ref, type: "task", id: taskId(ref), title, section: "due_today" });
    ref += 1;
  }
  context.due_today = { items: dueTodayItems, total: dueTodayItems.length };
  context.summary.due_today_total = dueTodayItems.length;

  let lastRef = ref - 1;
  if (options.withOutOfScopeRef) {
    const outOfScopeRef = ref;
    context.upcoming = {
      items: [{ ref: outOfScopeRef, date: "2026-09-16", kind: "task", title: "Future task" }],
      total: 1,
    };
    citations.push({
      ref: outOfScopeRef,
      type: "task",
      id: taskId(outOfScopeRef),
      title: "Future task",
      section: "upcoming",
    });
    lastRef = outOfScopeRef;
  }

  const serialized = JSON.stringify(context);
  return {
    context,
    citations,
    lastRef,
    serialized,
    chars: serialized.length,
    untrustedInputs: [],
    isEmpty: overdueCount + dueTodayCount === 0,
    droppedSections: [],
  };
}

describe("POST /focus/suggestion (Checkpoint 9.8)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
    vi.clearAllMocks();
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(MODEL_ROW));
  });

  async function seedAskRoute(createdAt?: Date): Promise<void> {
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name: "Test provider",
        providerType: "openai_compatible",
        baseUrl: "https://example.invalid/v1",
        apiKeyCiphertext: Buffer.from("ciphertext"),
        apiKeyIv: Buffer.from("iv"),
        apiKeyAuthTag: Buffer.from("authtag"),
      })
      .returning();
    const [model] = await app.db
      .insert(aiModels)
      .values({ providerConnectionId: connection!.id, modelId: "test-model" })
      .returning();
    await app.db.insert(aiTaskRoutes).values({
      taskName: "ask",
      primaryModelId: model!.id,
      createdAt: createdAt ?? new Date(Date.parse(ASK_TODAY_CONSENT_FROM) + 1000),
    });
  }

  function focus(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/focus/suggestion", payload });
  }

  describe("the switch", () => {
    it("returns 409 cloud_ask_disabled with no Today build and no model call when no ask route exists", async () => {
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "cloud_ask_disabled" });
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("rejects a missing tz", async () => {
      const response = await focus({});
      expect(response.statusCode).toBe(400);
    });

    it("rejects an unknown field (.strict())", async () => {
      const response = await focus({ tz: TZ, extra: "nope" });
      expect(response.statusCode).toBe(400);
    });

    it("rejects an invalid IANA timezone", async () => {
      const response = await focus({ tz: "Not/A_Zone" });
      expect(response.statusCode).toBe(400);
    });
  });

  describe("consent vintage", () => {
    it("refuses 409 ask_consent_outdated for a route consented before ASK_TODAY_CONSENT_FROM", async () => {
      await seedAskRoute(new Date(Date.parse(ASK_TODAY_CONSENT_FROM) - 1000));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_consent_outdated" });
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("the candidate gate -- no AI call below FOCUS_MIN_CANDIDATES", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("candidateCount 0: 409 focus_not_enough_candidates, zero model calls", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(0, 0));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(409);
      expect(response.json<Record<string, unknown>>()).toEqual({
        error: "focus_not_enough_candidates",
        candidate_count: 0,
      });
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("candidateCount 1: 409 focus_not_enough_candidates, zero model calls", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(1, 0));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(409);
      expect(response.json<Record<string, unknown>>()).toEqual({
        error: "focus_not_enough_candidates",
        candidate_count: 1,
      });
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("the happy path", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("candidateCount >= 2: 200 with a valid single-citation response", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(1, 1));
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Consider finishing the overdue task first [1]."),
      );

      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(200);
      const body = response.json<Record<string, unknown>>();
      expect(body["candidate_count"]).toBe(2);
      expect(body["model_id"]).toBe(MODEL_ROW);
      expect(body["suggestion"]).toContain("overdue task first");
      expect(body["source"]).toEqual({
        ref: 1,
        type: "task",
        id: taskId(1),
        title: "Overdue task 1",
        section: "overdue",
        detail: "P1",
      });
    });

    it("embeds the exact serialized Today context in the prompt and reads only overdue/due_today for candidates", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(2, 1));
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider task 2 [2]."));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(200);
      expect(response.json<Record<string, unknown>>()["candidate_count"]).toBe(3);
    });
  });

  describe("citation enforcement", () => {
    beforeEach(async () => {
      await seedAskRoute();
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(1, 1));
    });

    it("citing zero refs -> 502 focus_uncited", async () => {
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider the task."));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "focus_uncited" });
    });

    it("citing two or more refs -> 502 focus_uncited", async () => {
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Consider [1] and also [2]."),
      );
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "focus_uncited" });
    });

    it("citing a ref OUTSIDE overdue/due_today (e.g. an upcoming ref) -> 502 focus_uncited", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(1, 1, { withOutOfScopeRef: true }));
      // ref 3 is the "upcoming" item -- present in the Today ref space but
      // NOT a member of candidateRefs (which is only refs 1 and 2 here).
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider [3]."));
      const response = await focus({ tz: TZ });
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "focus_uncited" });
    });
  });

  describe("in-flight", () => {
    it("a second concurrent request is refused 429 focus_in_flight while one is in flight", async () => {
      await seedAskRoute();
      vi.mocked(buildTodayContext).mockResolvedValue(todayBuild(1, 1));
      // Resolves after a macrotask so the two concurrent requests genuinely
      // overlap rather than the first completing before the second starts
      // (mirrors routes/ask.test.ts's own concurrency test).
      vi.mocked(generateText).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(fakeGenerateTextResult("Consider [1].")), 30),
          ),
      );

      const [first, second] = await Promise.all([focus({ tz: TZ }), focus({ tz: TZ })]);
      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([200, 429]);
      const failed = first.statusCode === 429 ? first : second;
      expect(failed.json<ErrorBody>()).toEqual({ error: "focus_in_flight" });
    });
  });
});
