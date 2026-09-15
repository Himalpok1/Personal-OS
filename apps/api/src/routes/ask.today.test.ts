// Route-level tests for POST /ask's Checkpoint 9.7 "Ask about today" path
// (ADR-066). Same harness as ask.test.ts (real test database, app.inject,
// resolveModelForTask + generateText mocked). ADDITIONALLY:
//
//   * `../intelligence/today-context.js` is mocked -- Lane L1 owns its body
//     and the stub throws until it lands. The route is built against its
//     FROZEN exported signature (`buildTodayContext(ctx, options) ->
//     TodayContextBuild`), which is what the mock returns.
//   * `../ask/select-context.js`'s `selectAskContext` is wrapped in a spy over
//     the real implementation so the "scope today reads no note/task" contract
//     is asserted at the call boundary, not inferred from the response.
//
// The v18 (tz-less) byte-shape invariant is proven here too: the response to
// a tz-less request carries exactly the 8.6B keys and nothing new.
import type * as AiProviders from "@personal-os/ai-providers";
import { setLogSink } from "@personal-os/core/logging/logger";
import { aiModels, aiProviderConnections, aiTaskRoutes, notes, tasks } from "@personal-os/db";
import { ASK_PRESET_QUESTIONS, type AskResponse, type TodayContext } from "@personal-os/schema";
import { z } from "zod";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type * as SelectContext from "../ask/select-context.js";
import { ASK_TODAY_CONSENT_FROM } from "../ask/contracts.js";
import type { TodayContextBuild } from "../intelligence/today-context.js";
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

vi.mock("../ask/select-context.js", async () => {
  const actual = await vi.importActual<typeof SelectContext>("../ask/select-context.js");
  return { ...actual, selectAskContext: vi.fn(actual.selectAskContext) };
});

const { resolveModelForTask } = await import("@personal-os/ai-providers");
const { generateText } = await import("ai");
const { buildTodayContext } = await import("../intelligence/today-context.js");
const { selectAskContext } = await import("../ask/select-context.js");

const TZ = "America/Chicago";
const MODEL_ROW = "22222222-2222-4222-8222-222222222222";
const TASK_ID = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const EVENT_ID = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const INBOX_ID = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

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

/** A minimal but schema-valid TodayContext -- the route never inspects it, only `serialized`. */
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

/** A three-citation Today build: an overdue task, a timed event, a capture. */
function threeItemToday(overrides: Partial<TodayContextBuild> = {}): TodayContextBuild {
  const context = emptyTodayContext();
  context.summary.overdue_total = 1;
  context.overdue = {
    items: [
      {
        ref: 1,
        title: "Renew car insurance",
        due_local: "2026-09-14 09:00",
        project: null,
        priority: 1,
        recurring: false,
        has_reminder: true,
        snoozed: false,
      },
    ],
    total: 1,
  };
  context.events_today = {
    items: [
      {
        ref: 2,
        title: "Vendor sync at portal.internal",
        starts_local: "2026-09-15 14:30",
        date: null,
        all_day: false,
        location: null,
      },
    ],
    total: 1,
  };
  context.open_loops.inbox = {
    pending_count: 0,
    needs_confirm_count: 1,
    failed_count: 0,
    captures: [
      {
        ref: 3,
        text: "call the dentist",
        status: "needs_confirm",
        captured_local: "2026-09-15 08:00",
      },
    ],
  };
  const serialized = JSON.stringify(context);
  return {
    context,
    citations: [
      {
        ref: 1,
        type: "task",
        id: TASK_ID,
        title: "Renew car insurance",
        section: "overdue",
        detail: "P1 · overdue",
      },
      {
        ref: 2,
        type: "event",
        id: EVENT_ID,
        title: "Vendor sync at portal.internal",
        section: "event",
        detail: "14:30",
        occurs_at: "2026-09-15T19:30:00.000Z",
      },
      { ref: 3, type: "inbox_item", id: INBOX_ID, title: "call the dentist", section: "capture" },
    ],
    lastRef: 3,
    serialized,
    chars: serialized.length,
    untrustedInputs: ["Vendor sync at portal.internal"],
    isEmpty: false,
    droppedSections: [],
    ...overrides,
  };
}

/**
 * A build whose surviving citation refs have a GAP -- 1, 2, 5 -- exactly what
 * the drop ladder leaves behind when it empties a middle section. `lastRef` is
 * 5, the highest ordinal ever assigned; `citations.length` is 3, which is what
 * the pre-review route used as the offset and which would have handed the
 * first record ref 4 and the second ref 5, colliding with a SURVIVING Today
 * ref.
 */
function gappedToday(): TodayContextBuild {
  const base = threeItemToday();
  const context = base.context;
  context.open_loops.inbox.captures[0]!.ref = 5;
  const serialized = JSON.stringify(context);
  return {
    ...base,
    context,
    citations: [base.citations[0]!, base.citations[1]!, { ...base.citations[2]!, ref: 5 }],
    lastRef: 5,
    serialized,
    chars: serialized.length,
  };
}

describe("POST /ask -- Checkpoint 9.7 'Ask about today'", () => {
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
    // Default the consent vintage to just AFTER the constant rather than
    // leaning on the database's `now()`: ASK_TODAY_CONSENT_FROM is a
    // placeholder the integrator sets at deploy, so a wall-clock-relative
    // default would make every test in this file pass or fail by calendar
    // date. Only the vintage tests below pass an explicit value.
    await app.db.insert(aiTaskRoutes).values({
      taskName: "ask",
      primaryModelId: model!.id,
      createdAt: createdAt ?? new Date(Date.parse(ASK_TODAY_CONSENT_FROM) + 1000),
    });
  }

  function ask(payload: Record<string, unknown>) {
    return app.inject({ method: "POST", url: "/ask", payload });
  }

  describe("v18 compatibility -- the tz-less request is the exact 8.6B path", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("never builds the Today context and returns exactly the 8.6B keys, refs from 1, task/note only", async () => {
      const [task] = await app.db
        .insert(tasks)
        .values({ title: "Renew car insurance", timezone: TZ })
        .returning();
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Renew it. [1]"));

      const response = await ask({ question: "what about my insurance?" });
      expect(response.statusCode).toBe(200);
      expect(buildTodayContext).not.toHaveBeenCalled();

      const body = response.json<Record<string, unknown>>();
      expect(Object.keys(body).sort()).toEqual(["answer", "model_id", "redactions", "sources"]);
      expect(body).not.toHaveProperty("citations_present");
      const sources = body["sources"] as Record<string, unknown>[];
      expect(sources).toHaveLength(1);
      expect(Object.keys(sources[0]!).sort()).toEqual(["id", "ref", "title", "type"]);
      expect(sources[0]).toEqual({
        ref: 1,
        type: "task",
        id: task!.id,
        title: "Renew car insurance",
      });
      // The prompt carried no <today> fence either.
      const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
      expect(String(call["prompt"])).not.toContain("<today>");
    });

    it("a multi-source tz-less response parses against a FROZEN literal copy of the v18 schema", async () => {
      // Not the current AskResponseSchema -- 9.7 widened it. This is the
      // versionCode 18 client's own schema, copied verbatim from
      // `git show HEAD:packages/schema/src/ask.ts` (task|note only, four
      // source keys, four response keys, `.strict()` throughout). A 9.7
      // response that would break that client fails HERE, not on a phone.
      const V18AskSourceSchema = z
        .object({
          ref: z.number().int().min(1),
          type: z.enum(["task", "note"]),
          id: z.string().uuid(),
          title: z.string(),
        })
        .strict();
      const V18AskResponseSchema = z
        .object({
          answer: z.string(),
          sources: z.array(V18AskSourceSchema),
          redactions: z.number().int().min(0),
          model_id: z.string().uuid().nullable(),
        })
        .strict();

      await app.db.insert(tasks).values({ title: "Renew insurance policy", timezone: TZ });
      await app.db
        .insert(notes)
        .values({ title: "Insurance policy notes", body: "policy renewal detail" });
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Renew it [1]; your note [2] has the detail."),
      );

      const response = await ask({ question: "what about my insurance policy?" });
      expect(response.statusCode).toBe(200);
      const parsed = V18AskResponseSchema.parse(response.json());
      expect(parsed.sources.length).toBeGreaterThanOrEqual(2);
      expect(new Set(parsed.sources.map((s) => s.type))).toEqual(new Set(["task", "note"]));
    });

    it("an unresolvable [n] in a tz-less answer is NOT refused -- 8.6B semantics unchanged", async () => {
      await app.db.insert(tasks).values({ title: "Renew car insurance", timezone: TZ });
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Renew it. [9]"));
      const response = await ask({ question: "what about my insurance?" });
      expect(response.statusCode).toBe(200);
    });

    it("keeps the 422 semantics without tz", async () => {
      const response = await ask({ question: "the and for" });
      expect(response.statusCode).toBe(422);
      expect(response.json<ErrorBody>()).toEqual({ error: "no_relevant_context" });
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("`scope` WITHOUT `tz` is 400 validation_failed -- never the body-selecting 8.6B path", async () => {
      // A caller asking for scope "today" without tz would otherwise get the
      // exact opposite of what the flag asks for (note/task bodies selected),
      // so the schema refuses it (packages/schema AskRequestSchema).
      for (const scope of ["today", "both"]) {
        const response = await ask({ question: "what about my insurance?", scope });
        expect(response.statusCode).toBe(400);
        const body = response.json<{ error: string; issues?: { path: string[] }[] }>();
        expect(body.error).toBe("validation_failed");
        expect(body.issues?.some((issue) => issue.path.includes("scope"))).toBe(true);
      }
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("an outdated consent row still answers a tz-less request (only the Today widening is gated)", async () => {
      await truncateTestTables(app);
      await seedAskRoute(new Date(Date.parse(ASK_TODAY_CONSENT_FROM) - 86_400_000));
      await app.db.insert(tasks).values({ title: "Renew car insurance", timezone: TZ });
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Renew it. [1]"));
      const response = await ask({ question: "what about my insurance?" });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("validation", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("rejects an unknown timezone and an unknown scope with 400, before any read", async () => {
      expect((await ask({ question: "what today?", tz: "Mars/Olympus" })).statusCode).toBe(400);
      expect((await ask({ question: "what today?", tz: TZ, scope: "all" })).statusCode).toBe(400);
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("consent vintage", () => {
    it("a route row created before ASK_TODAY_CONSENT_FROM -> 409 ask_consent_outdated, no read model, no model call", async () => {
      await seedAskRoute(new Date(Date.parse(ASK_TODAY_CONSENT_FROM) - 1000));
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      let response;
      try {
        response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      } finally {
        restore();
      }
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_consent_outdated" });
      expect(buildTodayContext).not.toHaveBeenCalled();
      expect(selectAskContext).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
      expect(
        records.some((r) => r["event"] === "ask.failed" && r["outcome"] === "consent_outdated"),
      ).toBe(true);
    });

    it("a route row created at or after ASK_TODAY_CONSENT_FROM proceeds", async () => {
      await seedAskRoute(new Date(Date.parse(ASK_TODAY_CONSENT_FROM)));
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Renew insurance [1]."));
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("scope today", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("reads NO note/task via the lexical selector, even when a note matches the question", async () => {
      // A note that the 8.6B path WOULD have selected for "focus".
      await app.db
        .insert(notes)
        .values({ title: "Focus journal", body: "private thoughts about focus" });
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Renew your car insurance first [1], then the vendor sync [2]."),
      );

      const response = await ask({
        question: ASK_PRESET_QUESTIONS.focus,
        tz: TZ,
        scope: "today",
      });
      expect(response.statusCode).toBe(200);
      expect(selectAskContext).not.toHaveBeenCalled();

      const body = response.json<AskResponse>();
      expect(body.sources.map((s) => s.type)).not.toContain("note");
      // The prompt carried no <records> fence and none of the note's text.
      const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
      expect(String(call["prompt"])).not.toContain("<records>");
      expect(String(call["prompt"])).not.toContain("private thoughts");
      expect(String(call["prompt"])).toContain("<today>");
    });

    it("passes the preset derived from an exact preset question to buildTodayContext", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Nothing [1]."));
      await ask({ question: ASK_PRESET_QUESTIONS.slipping, tz: TZ, scope: "today" });
      expect(buildTodayContext).toHaveBeenCalledTimes(1);
      const [ctx, options] = vi.mocked(buildTodayContext).mock.calls[0]!;
      expect(options).toEqual({ preset: "slipping" });
      expect(ctx.tz).toBe(TZ);
      expect(ctx.db).toBe(app.db);
      expect(ctx.effectiveNow).toBeInstanceOf(Date);
    });

    it("passes no preset for a free-text question", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Nothing [1]."));
      await ask({ question: "what is on my plate?", tz: TZ, scope: "today" });
      expect(vi.mocked(buildTodayContext).mock.calls[0]![1]).toEqual({});
    });

    it("returns Today citations as sources with section/detail/occurs_at, refs ascending, and citations_present", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Insurance [1], then the sync [2]; a capture is waiting [3]."),
      );
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
      const body = response.json<AskResponse>();
      expect(body.citations_present).toBe(true);
      expect(body.sources).toEqual([
        {
          ref: 1,
          type: "task",
          id: TASK_ID,
          title: "Renew car insurance",
          section: "overdue",
          detail: "P1 · overdue",
        },
        {
          ref: 2,
          type: "event",
          id: EVENT_ID,
          title: "Vendor sync at portal.internal",
          section: "event",
          detail: "14:30",
          occurs_at: "2026-09-15T19:30:00.000Z",
        },
        {
          ref: 3,
          type: "inbox_item",
          id: INBOX_ID,
          title: "call the dentist",
          section: "capture",
        },
      ]);
      expect(body.redactions).toBe(0);
    });

    it("an empty day answers with citations_present false and no sources, without refusing", async () => {
      const empty = emptyTodayContext();
      const serialized = JSON.stringify(empty);
      vi.mocked(buildTodayContext).mockResolvedValue({
        context: empty,
        citations: [],
        lastRef: 0,
        serialized,
        chars: serialized.length,
        untrustedInputs: [],
        isEmpty: true,
        droppedSections: [],
      });
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Nothing is due, scheduled, or waiting today."),
      );
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
      const body = response.json<AskResponse>();
      expect(body.citations_present).toBe(false);
      expect(body.sources).toEqual([]);
    });

    it("a question that yields no terms is NOT 422 when tz is present", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Insurance [1]."));
      const response = await ask({ question: "the and for", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("scope both (and tz without scope)", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("selects records at refs continuing after the Today citations, capped at 4 records / 6000 chars, section 'record'", async () => {
      const inserted = [];
      for (let i = 0; i < 6; i++) {
        const [note] = await app.db
          .insert(notes)
          .values({ title: `Insurance note ${i}`, body: "insurance detail" })
          .returning();
        inserted.push(note!.id);
      }
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Insurance is overdue [1]; your notes [4][5] say more."),
      );

      const response = await ask({ question: "what about insurance?", tz: TZ, scope: "both" });
      expect(response.statusCode).toBe(200);
      expect(selectAskContext).toHaveBeenCalledTimes(1);
      const body = response.json<AskResponse>();
      const recordSources = body.sources.filter((s) => s.section === "record");
      expect(recordSources.length).toBeGreaterThan(0);
      expect(recordSources.length).toBeLessThanOrEqual(4);
      expect(recordSources[0]!.ref).toBe(4);
      expect(body.sources.map((s) => s.ref)).toEqual(
        [...body.sources.map((s) => s.ref)].sort((a, b) => a - b),
      );
      for (const source of recordSources) {
        expect(source.type).toBe("note");
        expect(inserted).toContain(source.id);
      }
      const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
      const prompt = String(call["prompt"]);
      expect(prompt).toContain("<today>");
      expect(prompt).toContain("<records>");
      expect(prompt).toContain('"ref":4');
      expect(prompt).not.toContain('"ref":8');
    });

    it("records continue after the HIGHEST Today ref, not the citation count, when the ladder left gaps", async () => {
      // Today's surviving refs are 1, 2, 5. The first record must be 6.
      for (let i = 0; i < 3; i++) {
        await app.db
          .insert(notes)
          .values({ title: `Insurance note ${i}`, body: "insurance detail" });
      }
      vi.mocked(buildTodayContext).mockResolvedValue(gappedToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Insurance is overdue [1]; your notes [6] say more."),
      );

      const response = await ask({ question: "what about insurance?", tz: TZ, scope: "both" });
      expect(response.statusCode).toBe(200);
      const body = response.json<AskResponse>();
      const recordRefs = body.sources.filter((s) => s.section === "record").map((s) => s.ref);
      expect(recordRefs.length).toBeGreaterThan(0);
      expect(Math.min(...recordRefs)).toBe(6);
      // No ref is claimed twice across Today and records.
      const allRefs = body.sources.map((s) => s.ref);
      expect(new Set(allRefs).size).toBe(allRefs.length);
      expect(allRefs).toContain(5);
    });

    it("a ref used twice across Today and records is refused before the answer is returned", async () => {
      // A builder bug (two citations sharing an ordinal) must never produce an
      // answer whose [n] silently resolves to the wrong one of two items.
      const build = threeItemToday();
      await app.db.insert(notes).values({ title: "Insurance note", body: "insurance detail" });
      vi.mocked(buildTodayContext).mockResolvedValue({
        ...build,
        citations: [build.citations[0]!, { ...build.citations[1]!, ref: 1 }],
      });
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Insurance [1]."));
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      let response;
      try {
        response = await ask({ question: "what about insurance?", tz: TZ, scope: "today" });
      } finally {
        restore();
      }
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_failed" });
      const failed = records.find((r) => r["event"] === "ask.failed");
      expect(failed?.["outcome"]).toBe("ref_collision");
    });

    it("tz without scope behaves as 'both'", async () => {
      await app.db.insert(notes).values({ title: "Insurance note", body: "insurance detail" });
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("See [4]."));
      const response = await ask({ question: "what about insurance?", tz: TZ });
      expect(response.statusCode).toBe(200);
      expect(selectAskContext).toHaveBeenCalledTimes(1);
      expect(response.json<AskResponse>().sources.some((s) => s.section === "record")).toBe(true);
    });

    it("zero candidates is NOT 422 when tz is present -- the day itself is the context", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Insurance [1]."));
      const response = await ask({ question: "zzznomatch thing?", tz: TZ, scope: "both" });
      expect(response.statusCode).toBe(200);
      expect(selectAskContext).toHaveBeenCalledTimes(1);
      const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
      expect(String(call["prompt"])).not.toContain("<records>");
    });
  });

  describe("citation validation", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("an unresolvable [n] -> 502 ask_uncited, logged as outcome uncited with unresolvedCount", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("You have a dentist appointment [7] and insurance [1]."),
      );
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      let response;
      try {
        response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      } finally {
        restore();
      }
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_uncited" });
      const failed = records.find((r) => r["event"] === "ask.failed");
      expect(failed).toBeDefined();
      expect(failed!["outcome"]).toBe("uncited");
      expect(failed!["unresolvedCount"]).toBe(1);
      expect(JSON.stringify(records)).not.toContain("dentist appointment");
    });

    it("a range citation overrunning the context is uncited too", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("All of [1-4]."));
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(502);
    });

    it("the sanitizer's own [link removed] is not a citation", async () => {
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("See https://evil.example/x for the sync [2]."),
      );
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
      expect(response.json<AskResponse>().answer).toContain("[link removed]");
    });
  });

  describe("output filter provenance", () => {
    it("an external event host echoed by the model is stripped via untrustedInputs", async () => {
      await seedAskRoute();
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Your sync is at portal.internal at 14:30 [2]."),
      );
      const response = await ask({ question: "what today?", tz: TZ, scope: "today" });
      expect(response.statusCode).toBe(200);
      expect(response.json<AskResponse>().answer).not.toContain("portal.internal");
    });
  });

  describe("logging discipline", () => {
    it("ai.usage carries todayChars, todayItemCount and a scope token; never the question, context or answer", async () => {
      await seedAskRoute();
      const today = threeItemToday();
      vi.mocked(buildTodayContext).mockResolvedValue(today);
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("Renew car insurance first [1]."),
      );
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      try {
        const response = await ask({
          question: "what should I do about my car insurance policy?",
          tz: TZ,
          scope: "today",
        });
        expect(response.statusCode).toBe(200);
      } finally {
        restore();
      }
      const usage = records.find((r) => r["event"] === "ai.usage");
      expect(usage).toBeDefined();
      expect(usage!["scope"]).toBe("today");
      expect(usage!["todayChars"]).toBe(today.chars);
      expect(usage!["todayItemCount"]).toBe(3);
      expect(usage!["sourceCount"]).toBe(3);
      const flat = JSON.stringify(records);
      expect(flat).not.toContain("car insurance policy");
      expect(flat).not.toContain("Renew car insurance");
      expect(flat).not.toContain("portal.internal");
      expect(flat).not.toContain(TASK_ID);
      expect(flat).not.toContain("[forbidden-field]");
    });

    it("scope token is 'both' for a tz request without scope and 'none' without tz", async () => {
      await seedAskRoute();
      await app.db.insert(notes).values({ title: "Insurance note", body: "insurance detail" });
      vi.mocked(buildTodayContext).mockResolvedValue(threeItemToday());
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("See [1]."));
      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      try {
        await ask({ question: "what about insurance?", tz: TZ });
        await ask({ question: "what about insurance?" });
      } finally {
        restore();
      }
      const usages = records.filter((r) => r["event"] === "ai.usage");
      expect(usages.map((u) => u["scope"])).toEqual(["both", "none"]);
      expect(usages[1]).not.toHaveProperty("todayChars");
    });
  });
});
