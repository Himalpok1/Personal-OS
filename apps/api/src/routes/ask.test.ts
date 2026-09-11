// Route-level tests for POST /ask (Checkpoint 8.6B). Real test database via
// buildTestApp/truncateTestTables + app.inject, mirroring briefs.test.ts's
// established pattern: only @personal-os/ai-providers's resolveModelForTask
// and ai's generateText are mocked. No real provider, no network.
import type * as AiProviders from "@personal-os/ai-providers";
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { setLogSink } from "@personal-os/core/logging/logger";
import { aiModels, aiProviderConnections, aiTaskRoutes, notes, tasks } from "@personal-os/db";
import type { AskResponse } from "@personal-os/schema";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const { resolveModelForTask } = await import("@personal-os/ai-providers");
const { generateText } = await import("ai");

const TZ = "America/Chicago";

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

describe("POST /ask (Checkpoint 8.6B)", () => {
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
  });

  async function seedAskRoute(): Promise<string> {
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
    await app.db.insert(aiTaskRoutes).values({ taskName: "ask", primaryModelId: model!.id });
    return model!.id;
  }

  function ask(question: string) {
    return app.inject({ method: "POST", url: "/ask", payload: { question } });
  }

  describe("the switch", () => {
    it("returns 409 cloud_ask_disabled with no model call when no ask route exists", async () => {
      await app.db.insert(tasks).values({ title: "renew insurance", timezone: TZ });
      const response = await ask("what about my insurance?");
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "cloud_ask_disabled" });
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("validation", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("rejects a question shorter than 3 characters after normalization", async () => {
      const response = await ask("hi");
      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
      expect(generateText).not.toHaveBeenCalled();
    });

    it("rejects a question longer than 512 characters", async () => {
      const response = await ask("a".repeat(513));
      expect(response.statusCode).toBe(400);
    });

    it("rejects a missing question and an unknown field", async () => {
      expect((await app.inject({ method: "POST", url: "/ask", payload: {} })).statusCode).toBe(400);
      expect(
        (
          await app.inject({
            method: "POST",
            url: "/ask",
            payload: { question: "a real question here", q: "ignored" },
          })
        ).statusCode,
      ).toBe(400);
    });

    it("ignores a ?q= query parameter -- the route reads the body only", async () => {
      await app.db.insert(tasks).values({ title: "rent widget", timezone: TZ });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("You have a rent task."));

      const response = await app.inject({
        method: "POST",
        url: "/ask?q=ignored-query-string",
        payload: { question: "what about the widget?" },
      });
      expect(response.statusCode).toBe(200);
    });
  });

  describe("retrieval", () => {
    beforeEach(async () => {
      await seedAskRoute();
    });

    it("returns 422 no_relevant_context, with no model call, when the question yields no usable terms", async () => {
      // "the and for" -- three stopwords, zero surviving terms.
      const response = await ask("the and for");
      expect(response.statusCode).toBe(422);
      expect(response.json<ErrorBody>()).toEqual({ error: "no_relevant_context" });
      expect(generateText).not.toHaveBeenCalled();
    });

    it("returns 422 no_relevant_context, with no model call, when nothing matches", async () => {
      await app.db.insert(tasks).values({ title: "completely unrelated content", timezone: TZ });
      const response = await ask("what about my zzznomatch thing?");
      expect(response.statusCode).toBe(422);
      expect(generateText).not.toHaveBeenCalled();
    });

    it("a wildcard-shaped question does not dump the corpus -- ADR-059's rule extended to Ask", async () => {
      await app.db.insert(tasks).values({ title: "unrelated widget", timezone: TZ });
      const response = await ask("%%% ??? ...");
      expect(response.statusCode).toBe(422);
      expect(generateText).not.toHaveBeenCalled();
    });
  });

  describe("the happy path", () => {
    it("answers using matched tasks/notes, returns sources with server-authored ids, and no data was mutated", async () => {
      await seedAskRoute();
      const [task] = await app.db
        .insert(tasks)
        .values({ title: "Renew car insurance", timezone: TZ })
        .returning();
      const [note] = await app.db
        .insert(notes)
        .values({ title: "Insurance notes", body: "Agent's number is 555-0100" })
        .returning();
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("22222222-2222-4222-8222-222222222222"),
      );
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("You have a task to renew your car insurance. [1][2]"),
      );

      const response = await ask("what do I need to do about insurance?");
      expect(response.statusCode).toBe(200);
      const body = response.json<AskResponse>();
      expect(body.answer).toContain("insurance");
      expect(body.model_id).toBe("22222222-2222-4222-8222-222222222222");
      expect(body.redactions).toBe(0);
      const ids = body.sources.map((s) => s.id).sort();
      expect(ids).toEqual([note!.id, task!.id].sort());
      for (const source of body.sources) {
        expect(source.ref).toBeGreaterThanOrEqual(1);
        expect(["task", "note"]).toContain(source.type);
      }

      // Read-only: nothing was created, updated, or deleted by asking.
      expect(await app.db.select().from(tasks)).toHaveLength(1);
      expect(await app.db.select().from(notes)).toHaveLength(1);
    });

    it("reports redactions when a matched record contained a secret-shaped string", async () => {
      await seedAskRoute();
      await app.db.insert(notes).values({
        title: "API notes",
        body: `remember the key sk-${"a".repeat(30)} is old`,
      });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("33333333-3333-4333-8333-333333333333"),
      );
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("You have a note about an API key."),
      );

      const response = await ask("what do my api notes say?");
      expect(response.statusCode).toBe(200);
      expect(response.json<AskResponse>().redactions).toBeGreaterThan(0);
    });

    it("excludes archived and done/dropped items -- only live content answers", async () => {
      await seedAskRoute();
      await app.db.insert(tasks).values({
        title: "archived rent widget",
        timezone: TZ,
        archivedAt: new Date(),
      });
      await app.db
        .insert(tasks)
        .values({ title: "done rent widget", timezone: TZ, status: "done" });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("placeholder"));

      const response = await ask("what about the rent widget?");
      // Nothing live matches, so this is 422, not a 200 citing archived/done rows.
      expect(response.statusCode).toBe(422);
    });
  });

  describe("failure mapping", () => {
    beforeEach(async () => {
      await seedAskRoute();
      await app.db.insert(tasks).values({ title: "rent widget task", timezone: TZ });
    });

    it("no provider configured (connection disabled) -> 409 no_provider_configured", async () => {
      vi.mocked(resolveModelForTask).mockRejectedValue(
        new Error('AI provider connection "X" is disabled'),
      );
      const response = await ask("what about the rent widget?");
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "no_provider_configured" });
    });

    it("the ask route vanishing mid-request -> 409 cloud_ask_disabled", async () => {
      vi.mocked(resolveModelForTask).mockRejectedValue(new NoProviderConfiguredError("ask"));
      const response = await ask("what about the rent widget?");
      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "cloud_ask_disabled" });
    });

    it("a timeout -> 504 ask_timeout, and the copy never implies nothing was sent", async () => {
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      const secret = "sk-timeout-secret-should-never-leak";
      vi.mocked(generateText).mockRejectedValue(
        new DOMException(`aborted ${secret}`, "TimeoutError"),
      );

      const response = await ask("what about the rent widget?");
      expect(response.statusCode).toBe(504);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_timeout" });
      expect(response.body).not.toContain(secret);
    });

    it("a generic provider failure -> 502 ask_failed with no provider detail", async () => {
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      const secret = "sk-generic-secret-should-never-leak";
      vi.mocked(generateText).mockRejectedValue(new Error(`upstream: ${secret}`));

      const response = await ask("what about the rent widget?");
      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "ask_failed" });
      expect(response.body).not.toContain(secret);
    });
  });

  describe("concurrency", () => {
    it("refuses a second concurrent Ask with 429 ask_in_flight", async () => {
      await seedAskRoute();
      await app.db.insert(tasks).values({ title: "rent widget task", timezone: TZ });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      // Resolves after a macrotask so the two concurrent requests genuinely
      // overlap rather than the first completing before the second starts.
      vi.mocked(generateText).mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve(fakeGenerateTextResult("slow answer")), 30),
          ),
      );

      const [first, second] = await Promise.all([
        ask("what about the rent widget?"),
        ask("what about the rent widget?"),
      ]);
      const statuses = [first.statusCode, second.statusCode].sort();
      expect(statuses).toEqual([200, 429]);
    });
  });

  describe("logging discipline", () => {
    it("never writes the question, the answer, or any record title/body to a log line", async () => {
      await seedAskRoute();
      await app.db.insert(tasks).values({ title: "renew car insurance policy", timezone: TZ });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      vi.mocked(generateText).mockResolvedValue(
        fakeGenerateTextResult("You should renew the car insurance policy soon."),
      );

      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      try {
        const response = await ask("what should I do about my car insurance policy?");
        expect(response.statusCode).toBe(200);
      } finally {
        restore();
      }

      const flat = JSON.stringify(records);
      expect(flat).not.toContain("what should I do about my car insurance policy");
      expect(flat).not.toContain("renew car insurance policy");
      expect(flat).not.toContain("You should renew the car insurance policy soon");
    });

    it("also logs nothing sensitive on a failure path", async () => {
      await seedAskRoute();
      await app.db.insert(tasks).values({ title: "renew car insurance policy", timezone: TZ });
      vi.mocked(resolveModelForTask).mockResolvedValue(
        singleCandidateChain("11111111-1111-4111-8111-111111111111"),
      );
      const secret = "sk-log-path-secret-should-never-leak";
      vi.mocked(generateText).mockRejectedValue(new Error(`upstream: ${secret}`));

      const records: Record<string, unknown>[] = [];
      const restore = setLogSink({ write: (_level, record) => records.push(record) });
      try {
        await ask("what should I do about my car insurance policy?");
      } finally {
        restore();
      }
      expect(JSON.stringify(records)).not.toContain(secret);
    });
  });
});
