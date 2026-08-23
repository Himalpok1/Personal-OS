// Route-level tests for the manual/on-demand AI Daily Brief (Checkpoint 5.5,
// ADR-041). Real test database via buildTestApp/truncateTestTables +
// app.inject, styled like reviews.test.ts. Only the model-calling layer is
// mocked -- `@personal-os/ai-providers`'s resolveModelForTask and `ai`'s
// generateText -- following the exact partial-mock pattern already
// established in this repo (apps/worker/src/jobs/ptt-transcribe.test.ts,
// and this feature's own apps/api/src/brief/generate.test.ts).
// callWithFallbackTracked is left REAL, so the route exercises the actual
// generation service, not a re-implementation of it. No real provider, no
// network.
//
// ai_daily_briefs.model_id carries a real foreign key to ai_models.id
// (packages/db/drizzle/0012_ai_daily_briefs.sql), so every success-path test
// below seeds a real ai_provider_connections + ai_models row and uses its id
// as the mocked chain's modelRowId -- an arbitrary non-uuid string would
// fail either the FK or DailyBriefRecordSchema's uuid check.
import type * as AiProviders from "@personal-os/ai-providers";
import { NoProviderConfiguredError, type ResolvedModel } from "@personal-os/ai-providers";
import { aiDailyBriefs, aiModels, aiProviderConnections } from "@personal-os/db";
import type { DailyBriefRecord } from "@personal-os/schema";
import type * as Ai from "ai";
import type { LanguageModel } from "ai";
import { and, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import type { ErrorBody } from "../test/types.js";

vi.mock("@personal-os/ai-providers", async () => {
  const actual = await vi.importActual<typeof AiProviders>("@personal-os/ai-providers");
  return {
    ...actual,
    resolveModelForTask: vi.fn(),
  };
});

vi.mock("ai", async () => {
  const actual = await vi.importActual<typeof Ai>("ai");
  return {
    ...actual,
    generateText: vi.fn(),
  };
});

const { resolveModelForTask } = await import("@personal-os/ai-providers");
const { generateText } = await import("ai");

const TZ = "America/Chicago";

function fakeModel(tag: string): LanguageModel {
  return { modelId: tag } as unknown as LanguageModel;
}

function singleCandidateChain(modelRowId: string): ResolvedModel {
  return { model: fakeModel("primary"), modelRowId, fallbacks: [], fallbackModelRowIds: [] };
}

type GenerateTextReturn = Awaited<ReturnType<typeof Ai.generateText>>;

function fakeGenerateTextResult(text: string): GenerateTextReturn {
  return { text } as unknown as GenerateTextReturn;
}

function mockSuccess(modelRowId: string, text = "You have 2 tasks today."): void {
  vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(modelRowId));
  vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult(text));
}

describe("briefs routes", () => {
  let app: FastifyInstance;
  let modelId: string;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // ai_provider_connections/ai_models are deliberately not cleared by
  // truncateTestTables (matching today.test.ts's established precedent for
  // this same pair of tables) -- a fresh model row is seeded every test so
  // each one owns an id independent of accumulated rows from earlier tests.
  async function seedModel(name = "Test provider"): Promise<string> {
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name,
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
    return model!.id;
  }

  beforeEach(async () => {
    await truncateTestTables(app);
    vi.clearAllMocks();
    modelId = await seedModel();
  });

  async function postBrief(tz: string) {
    return app.inject({ method: "POST", url: "/briefs", payload: { tz } });
  }

  async function getCurrentBrief(tz: string) {
    return app.inject({ method: "GET", url: `/briefs/current?tz=${encodeURIComponent(tz)}` });
  }

  async function countBriefRows(): Promise<number> {
    const rows = await app.db.select().from(aiDailyBriefs);
    return rows.length;
  }

  describe("POST /briefs", () => {
    it("creates a brief when none exists yet, returning a DailyBriefRecord", async () => {
      mockSuccess(modelId, "You have 2 tasks today.");

      const response = await postBrief(TZ);

      expect(response.statusCode).toBe(200);
      const body = response.json<DailyBriefRecord>();
      expect(body.timezone).toBe(TZ);
      expect(body.content).toEqual({ text: "You have 2 tasks today." });
      expect(body.model_id).toBe(modelId);
      expect(typeof body.brief_date).toBe("string");
      expect(await countBriefRows()).toBe(1);
    });

    it("upserts on a second POST for the same tz: same id, content/generated_at advance, still exactly one row", async () => {
      mockSuccess(modelId, "First brief.");
      const first = await postBrief(TZ);
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<DailyBriefRecord>();

      // Guarantee a distinct generated_at rather than relying on wall-clock
      // drift alone (Postgres timestamptz has microsecond resolution but a
      // fast machine can still tie at the millisecond the JS Date carries).
      await new Promise((resolve) => setTimeout(resolve, 5));

      mockSuccess(modelId, "Second brief, regenerated.");
      const second = await postBrief(TZ);
      expect(second.statusCode).toBe(200);
      const secondBody = second.json<DailyBriefRecord>();

      expect(secondBody.id).toBe(firstBody.id);
      expect(secondBody.content).toEqual({ text: "Second brief, regenerated." });
      expect(secondBody.generated_at).not.toBe(firstBody.generated_at);
      expect(await countBriefRows()).toBe(1);
    });

    it("the same local date under two different timezone identifiers produces two distinct rows -- identity is the (date, tz) pair", async () => {
      mockSuccess(modelId);

      // UTC and Etc/UTC are distinct IANA identifiers with the identical,
      // always-zero offset, so their local calendar date is guaranteed equal
      // regardless of when the suite runs -- unlike two arbitrary zones,
      // which would usually land on different dates rather than the same
      // one this test needs to prove doesn't collide.
      const utc = await postBrief("UTC");
      const etcUtc = await postBrief("Etc/UTC");

      expect(utc.statusCode).toBe(200);
      expect(etcUtc.statusCode).toBe(200);
      const utcBody = utc.json<DailyBriefRecord>();
      const etcUtcBody = etcUtc.json<DailyBriefRecord>();

      expect(utcBody.brief_date).toBe(etcUtcBody.brief_date);
      expect(utcBody.id).not.toBe(etcUtcBody.id);
      expect(await countBriefRows()).toBe(2);
    });

    it("a failed regeneration preserves the existing cached brief byte-for-byte", async () => {
      mockSuccess(modelId, "First successful brief.");
      const first = await postBrief(TZ);
      expect(first.statusCode).toBe(200);
      const firstBody = first.json<DailyBriefRecord>();
      expect(await countBriefRows()).toBe(1);

      vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(modelId));
      vi.mocked(generateText).mockRejectedValue(new Error("provider exploded"));

      const second = await postBrief(TZ);
      expect(second.statusCode).toBe(502);
      expect(second.json<ErrorBody>()).toEqual({ error: "brief_generation_failed" });

      expect(await countBriefRows()).toBe(1);
      const current = await getCurrentBrief(TZ);
      expect(current.statusCode).toBe(200);
      expect(current.json<DailyBriefRecord>()).toEqual(firstBody);
    });

    it("no provider configured -> 409 no_provider_configured, and no row is written", async () => {
      vi.mocked(resolveModelForTask).mockRejectedValue(
        new NoProviderConfiguredError("daily_brief"),
      );

      const response = await postBrief(TZ);

      expect(response.statusCode).toBe(409);
      expect(response.json<ErrorBody>()).toEqual({ error: "no_provider_configured" });
      expect(generateText).not.toHaveBeenCalled();
      expect(await countBriefRows()).toBe(0);
    });

    it("a timeout/abort-shaped failure -> 504 brief_generation_timeout with no provider detail in the response, and no row written", async () => {
      vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(modelId));
      const secret = "sk-abort-detail-should-never-leak";
      vi.mocked(generateText).mockRejectedValue(
        new DOMException(`aborted: ${secret}`, "TimeoutError"),
      );

      const response = await postBrief(TZ);

      expect(response.statusCode).toBe(504);
      expect(response.json<ErrorBody>()).toEqual({ error: "brief_generation_timeout" });
      expect(response.body).not.toContain(secret);
      expect(await countBriefRows()).toBe(0);
    });

    it("a generic provider failure -> 502 brief_generation_failed with no provider detail in the response, and no row written", async () => {
      vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(modelId));
      const secret = "sk-provider-error-detail-should-never-leak";
      vi.mocked(generateText).mockRejectedValue(new Error(`upstream 500: ${secret}`));

      const response = await postBrief(TZ);

      expect(response.statusCode).toBe(502);
      expect(response.json<ErrorBody>()).toEqual({ error: "brief_generation_failed" });
      expect(response.body).not.toContain(secret);
      expect(await countBriefRows()).toBe(0);
    });

    it("two concurrent POSTs for the same tz still leave exactly one row and neither response is a 5xx", async () => {
      mockSuccess(modelId, "Concurrent brief.");

      const [a, b] = await Promise.all([postBrief(TZ), postBrief(TZ)]);

      expect(a.statusCode).toBeLessThan(500);
      expect(b.statusCode).toBeLessThan(500);
      expect(a.statusCode).toBe(200);
      expect(b.statusCode).toBe(200);
      expect(await countBriefRows()).toBe(1);
    });

    it("persists the exact ai_models.id reported by the tracked call as model_id", async () => {
      const provenanceModelId = await seedModel("Provenance test provider");
      vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain(provenanceModelId));
      vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Provenance brief."));

      const response = await postBrief(TZ);

      expect(response.statusCode).toBe(200);
      expect(response.json<DailyBriefRecord>().model_id).toBe(provenanceModelId);

      const [row] = await app.db
        .select()
        .from(aiDailyBriefs)
        .where(and(eq(aiDailyBriefs.timezone, TZ)));
      expect(row?.modelId).toBe(provenanceModelId);
    });
  });

  describe("GET /briefs/current", () => {
    it("returns the persisted record for a matching (date, tz) row without ever generating", async () => {
      mockSuccess(modelId, "Cached brief text.");
      const posted = await postBrief(TZ);
      expect(posted.statusCode).toBe(200);
      const postedBody = posted.json<DailyBriefRecord>();
      vi.clearAllMocks();

      const response = await getCurrentBrief(TZ);

      expect(response.statusCode).toBe(200);
      expect(response.json<DailyBriefRecord>()).toEqual(postedBody);
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("404s not_found when no brief exists for that tz's local date, and never generates", async () => {
      const response = await getCurrentBrief(TZ);

      expect(response.statusCode).toBe(404);
      expect(response.json<ErrorBody>()).toEqual({ error: "not_found" });
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("rejects an unknown timezone with 400 validation_failed and never generates", async () => {
      const response = await app.inject({
        method: "GET",
        url: "/briefs/current?tz=Not%2FA_Real_Zone",
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
      expect(resolveModelForTask).not.toHaveBeenCalled();
      expect(generateText).not.toHaveBeenCalled();
    });

    it("rejects a missing tz with 400 validation_failed", async () => {
      const response = await app.inject({ method: "GET", url: "/briefs/current" });

      expect(response.statusCode).toBe(400);
      expect(response.json<ErrorBody>().error).toBe("validation_failed");
    });
  });
});
