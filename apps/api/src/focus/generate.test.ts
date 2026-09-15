// Generation-service tests for Suggested Focus, mirroring
// apps/api/src/ask/generate.test.ts's established mocking style:
// @personal-os/ai-providers's resolveModelForTask and ai's generateText are
// partial-mocked. A grant is minted for real (via a real test database and
// the real authorizeCloudAsk), because the grant mechanism IS part of what is
// under test -- a hand-built grant object would (correctly) be refused by
// assertGrant.
import type * as AiProviders from "@personal-os/ai-providers";
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import type { LanguageModel } from "ai";
import type * as Ai from "ai";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { authorizeCloudAsk, AskUnauthorizedError, type CloudAskGrant } from "../ask/authorize.js";
import { AskProviderDisabledError } from "../ask/contracts.js";
import { FocusGenerationFailedError, FocusTimeoutError } from "./contracts.js";

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
const { generateFocusSuggestion } = await import("./generate.js");

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

describe("generateFocusSuggestion (Checkpoint 9.8)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });

  async function seedAskRoute(): Promise<void> {
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
    // The SAME "ask" task route Cloud Ask uses -- Suggested Focus adds no new
    // ai_task_routes row or task name.
    await app.db.insert(aiTaskRoutes).values({ taskName: "ask", primaryModelId: model!.id });
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
    await expect(generateFocusSuggestion(app.db, forged, "{}", [], "key")).rejects.toThrow(
      AskUnauthorizedError,
    );
    expect(resolveModelForTask).not.toHaveBeenCalled();
  });

  it("resolves the SAME 'ask' task route, not a new one", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-x"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider [1]."));
    await generateFocusSuggestion(app.db, grant, "{}", [], "key");
    expect(resolveModelForTask).toHaveBeenCalledWith(app.db, "ask", "key");
  });

  it("calls generateText with the closed argument set: PRIMARY model only, maxRetries 0, telemetry disabled", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(chainWithFallback("model-x"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider finishing [1]."));

    await generateFocusSuggestion(app.db, grant, "{}", [], "key");

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

  it("embeds serializedToday verbatim in a <today> fence", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-y"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Consider it [1]."));
    const today = '{"overdue":{"items":[{"ref":1}],"total":1}}';
    await generateFocusSuggestion(app.db, grant, today, [], "key");
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(String(call["prompt"])).toContain("<today>\n" + today + "\n</today>");
  });

  it("returns the model's suggestion, sanitized, plus the serving model's row id", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-y"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("Consider renewing the insurance policy today [1]."),
    );

    const result = await generateFocusSuggestion(app.db, grant, "{}", [], "key");
    expect(result.suggestion).toContain("renewing the insurance policy");
    expect(result.modelRowId).toBe("model-y");
    expect(result.usageIn).toBe(10);
    expect(result.usageOut).toBe(5);
    expect(result.finishReason).toBe("stop");
  });

  it("maps NoProviderConfiguredError (route vanished mid-request) unchanged", async () => {
    vi.mocked(resolveModelForTask).mockRejectedValue(new NoProviderConfiguredError("ask"));
    await expect(generateFocusSuggestion(app.db, grant, "{}", [], "key")).rejects.toThrow(
      NoProviderConfiguredError,
    );
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps any OTHER resolution failure (e.g. a disabled connection) to AskProviderDisabledError", async () => {
    vi.mocked(resolveModelForTask).mockRejectedValue(
      new Error('AI provider connection "X" is disabled'),
    );
    await expect(generateFocusSuggestion(app.db, grant, "{}", [], "key")).rejects.toThrow(
      AskProviderDisabledError,
    );
  });

  it("maps an abort/timeout-shaped failure to FocusTimeoutError with no provider detail", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-z"));
    const secret = "sk-timeout-detail-should-never-leak";
    vi.mocked(generateText).mockRejectedValue(
      new DOMException(`aborted: ${secret}`, "TimeoutError"),
    );

    let caught: unknown;
    try {
      await generateFocusSuggestion(app.db, grant, "{}", [], "key");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FocusTimeoutError);
    expect(String(caught)).not.toContain(secret);
  });

  it("maps a generic provider failure to FocusGenerationFailedError with no provider detail", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-w"));
    const secret = "sk-generic-failure-detail-should-never-leak";
    vi.mocked(generateText).mockRejectedValue(new Error(`upstream 500: ${secret}`));

    let caught: unknown;
    try {
      await generateFocusSuggestion(app.db, grant, "{}", [], "key");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(FocusGenerationFailedError);
    expect(String(caught)).not.toContain(secret);
  });

  it("refuses an empty suggestion as a failure, not a success with a hole in it", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-v"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("   "));
    await expect(generateFocusSuggestion(app.db, grant, "{}", [], "key")).rejects.toThrow(
      FocusGenerationFailedError,
    );
  });

  it("the output filter runs INSIDE the pipeline: a suggestion with a URL comes back with it removed, not refused", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-u"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("Consider [1], see https://evil.example/reset for details."),
    );
    const result = await generateFocusSuggestion(app.db, grant, "{}", [], "key");
    expect(result.suggestion).not.toContain("https://");
    expect(result.suggestion).toContain("[link removed]");
  });

  it("passes untrustedInputs to the output filter so an echoed external host is stripped", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("model-t"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("Your meeting at portal.internal [1] is overdue."),
    );
    const result = await generateFocusSuggestion(app.db, grant, "{}", ["portal.internal"], "key");
    expect(result.suggestion).not.toContain("portal.internal");
    expect(result.suggestion).toContain("[link removed]");
  });
});
