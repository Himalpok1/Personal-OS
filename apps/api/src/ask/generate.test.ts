// Generation-service tests for Cloud Ask, mirroring
// apps/api/src/brief/generate.test.ts's established mocking style:
// @personal-os/ai-providers's resolveModelForTask and ai's generateText are
// partial-mocked (spread over vi.importActual), so callWithFallback-adjacent
// machinery is never re-implemented as a mock. A grant is minted for real
// (via a real test database and the real authorizeCloudAsk), because the
// grant mechanism IS the thing under test alongside generation -- a hand-built
// grant object would (correctly) be refused by assertGrant.
import type * as AiProviders from "@personal-os/ai-providers";
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import type { LanguageModel } from "ai";
import type * as Ai from "ai";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { authorizeCloudAsk, AskUnauthorizedError, type CloudAskGrant } from "./authorize.js";
import {
  AskGenerationFailedError,
  AskProviderDisabledError,
  AskTimeoutError,
} from "./contracts.js";

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
const { generateAskAnswer } = await import("./generate.js");

function fakeModel(tag: string): LanguageModel {
  return { modelId: tag } as unknown as LanguageModel;
}

function singleCandidateChain(modelRowId: string): AiProviders.ResolvedModel {
  return { model: fakeModel("primary"), modelRowId, fallbacks: [], fallbackModelRowIds: [] };
}

function chainWithFallback(modelRowId: string): AiProviders.ResolvedModel {
  return {
    model: fakeModel("primary"),
    modelRowId,
    fallbacks: [fakeModel("fallback")],
    fallbackModelRowIds: ["fallback-row-id"],
  };
}

type GenerateTextReturn = Awaited<ReturnType<typeof Ai.generateText>>;
function fakeGenerateTextResult(
  text: string,
  overrides: Partial<GenerateTextReturn> = {},
): GenerateTextReturn {
  return {
    text,
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    finishReason: "stop",
    ...overrides,
  } as unknown as GenerateTextReturn;
}

function fakeRequest(id = "req-1"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

describe("generateAskAnswer (Checkpoint 8.6B)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
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

  let grant: CloudAskGrant;

  beforeEach(async () => {
    await truncateTestTables(app);
    vi.clearAllMocks();
    await seedAskRoute();
    const minted = await authorizeCloudAsk(fakeRequest(), app.db);
    if (!minted) throw new Error("test setup: expected a grant");
    grant = minted;
  });

  it("rejects a forged grant before resolving any model", async () => {
    const forged = { requestId: "x", grantedAt: "y" };
    await expect(generateAskAnswer(app.db, forged, "q", "[]", "key")).rejects.toThrow(
      AskUnauthorizedError,
    );
    expect(resolveModelForTask).not.toHaveBeenCalled();
  });

  it("calls generateText with the closed argument set: PRIMARY model only, maxRetries 0, telemetry disabled", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(chainWithFallback("model-x"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("You have one task."));

    await generateAskAnswer(app.db, grant, "what do I have?", "[]", "key");

    expect(generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(Object.keys(call).sort()).toEqual(
      [
        "model",
        "system",
        "prompt",
        "maxOutputTokens",
        "abortSignal",
        "maxRetries",
        "experimental_telemetry",
      ].sort(),
    );
    expect(call["maxRetries"]).toBe(0);
    expect(call["experimental_telemetry"]).toEqual({ isEnabled: false });
    // PRIMARY only -- the fallback candidate is never passed to generateText.
    expect((call["model"] as LanguageModel & { modelId: string }).modelId).toBe("primary");
  });

  it("returns the model's answer, sanitized, plus the serving model's row id", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-y"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("You have one task about renewing insurance. [1]"),
    );

    const result = await generateAskAnswer(app.db, grant, "what do I have?", "[]", "key");
    expect(result.answer).toContain("renewing insurance");
    expect(result.modelRowId).toBe("model-y");
    expect(result.usageIn).toBe(10);
    expect(result.usageOut).toBe(5);
    expect(result.finishReason).toBe("stop");
  });

  it("maps NoProviderConfiguredError (route vanished mid-request) unchanged", async () => {
    vi.mocked(resolveModelForTask).mockRejectedValue(new NoProviderConfiguredError("ask"));
    await expect(generateAskAnswer(app.db, grant, "q", "[]", "key")).rejects.toThrow(
      NoProviderConfiguredError,
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps any OTHER resolution failure (e.g. a disabled connection) to AskProviderDisabledError", async () => {
    vi.mocked(resolveModelForTask).mockRejectedValue(
      new Error('AI provider connection "X" is disabled'),
    );
    await expect(generateAskAnswer(app.db, grant, "q", "[]", "key")).rejects.toThrow(
      AskProviderDisabledError,
    );
  });

  it("maps an abort/timeout-shaped failure to AskTimeoutError with no provider detail", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-z"));
    const secret = "sk-timeout-detail-should-never-leak";
    vi.mocked(generateText).mockRejectedValue(
      new DOMException(`aborted: ${secret}`, "TimeoutError"),
    );

    let caught: unknown;
    try {
      await generateAskAnswer(app.db, grant, "q", "[]", "key");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AskTimeoutError);
    expect(String(caught)).not.toContain(secret);
  });

  it("maps a generic provider failure to AskGenerationFailedError with no provider detail", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-w"));
    const secret = "sk-generic-failure-detail-should-never-leak";
    vi.mocked(generateText).mockRejectedValue(new Error(`upstream 500: ${secret}`));

    let caught: unknown;
    try {
      await generateAskAnswer(app.db, grant, "q", "[]", "key");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AskGenerationFailedError);
    expect(String(caught)).not.toContain(secret);
  });

  it("refuses an empty answer as a failure, not a success with a hole in it", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-v"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("   "));
    await expect(generateAskAnswer(app.db, grant, "q", "[]", "key")).rejects.toThrow(
      AskGenerationFailedError,
    );
  });

  it("the output filter runs INSIDE the pipeline: a model answer with a URL comes back with it removed, not refused", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-u"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("See https://evil.example/reset for the reset link."),
    );
    const result = await generateAskAnswer(app.db, grant, "q", "[]", "key");
    expect(result.answer).not.toContain("https://");
    expect(result.answer).toContain("[link removed]");
  });
});
