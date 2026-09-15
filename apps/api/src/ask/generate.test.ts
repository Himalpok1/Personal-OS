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
import { ASK_QUESTION_MAX_CHARS, TODAY_CONTEXT_MAX_CHARS } from "@personal-os/schema";
import {
  ASK_PROMPT_MAX_CHARS,
  ASK_RECORDS_MAX_CHARS_WITH_TODAY,
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
const { buildAskUserPrompt } = await import("./prompt.js");

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

describe("generateAskAnswer -- Checkpoint 9.7 options", () => {
  let app: FastifyInstance;
  let grant: CloudAskGrant;

  beforeAll(async () => {
    app = await buildTestApp();
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(async () => {
    await truncateTestTables(app);
    vi.clearAllMocks();
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
    const minted = await authorizeCloudAsk(fakeRequest("req-9-7"), app.db);
    if (!minted) throw new Error("test setup: expected a grant");
    grant = minted;
  });

  it("without options the prompt has no <today> fence (8.6B shape)", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("m"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("ok [1]"));
    await generateAskAnswer(app.db, grant, "q?", '[{"ref":1}]', "key");
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(String(call["prompt"])).not.toContain("<today>");
    expect(String(call["prompt"])).toContain("<records>");
  });

  it("embeds serializedToday verbatim in a <today> fence and still makes exactly ONE call with the closed argument set", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("m"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Nothing is due. [1]"));
    const today = '{"local_date":"2026-09-15","overdue":{"items":[{"ref":1}],"total":1}}';
    await generateAskAnswer(app.db, grant, "q?", "[]", "key", { serializedToday: today });
    expect(generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateText).mock.calls[0]![0] as Record<string, unknown>;
    expect(String(call["prompt"])).toContain("<today>\n" + today + "\n</today>");
    expect(String(call["prompt"])).not.toContain("<records>");
    expect(call["maxRetries"]).toBe(0);
    expect(call["experimental_telemetry"]).toEqual({ isEnabled: false });
  });

  it("passes untrustedInputs to the output filter so an echoed external host is stripped", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("m"));
    vi.mocked(generateText).mockResolvedValue(
      fakeGenerateTextResult("Your meeting is at portal.internal today [1]."),
    );
    const result = await generateAskAnswer(app.db, grant, "q?", "[]", "key", {
      serializedToday: "{}",
      untrustedInputs: ["Vendor sync at portal.internal"],
    });
    expect(result.answer).not.toContain("portal.internal");
    expect(result.answer).toContain("[link removed]");
  });

  it("refuses a concatenated prompt over ASK_PROMPT_MAX_CHARS with AskGenerationFailedError and NO model call", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain("m"));
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("never"));
    // Not reachable through the route at the shipped ceilings (12 000 +
    // 5 000 + 512 + 238 framing = 17 750 ≤ 18 000 on the USER prompt; the
    // system prompt is excluded) -- forced here by handing generate.ts an
    // oversized string directly.
    const oversized = '{"pad":"' + "x".repeat(ASK_PROMPT_MAX_CHARS) + '"}';
    await expect(
      generateAskAnswer(app.db, grant, "q?", "[]", "key", { serializedToday: oversized }),
    ).rejects.toThrow(AskGenerationFailedError);
    expect(generateText).not.toHaveBeenCalled();
  });
});

describe("the prompt ceiling arithmetic (Checkpoint 9.7 review)", () => {
  it("worst-case USER prompt (today + records + question + framing) fits ASK_PROMPT_MAX_CHARS", () => {
    // The framing is measured, not assumed: buildAskUserPrompt's fixed text
    // around three one-character payloads.
    const framing = buildAskUserPrompt("Q", "R", "T").length - 3;
    expect(framing).toBe(238);
    const worstCase =
      TODAY_CONTEXT_MAX_CHARS + ASK_RECORDS_MAX_CHARS_WITH_TODAY + ASK_QUESTION_MAX_CHARS + framing;
    expect(worstCase).toBe(17_750);
    expect(worstCase).toBeLessThanOrEqual(ASK_PROMPT_MAX_CHARS);
  });

  it("the ceiling is on the user prompt: the system prompt is not counted and would not fit if it were", async () => {
    const { buildAskSystemPrompt } = await import("./prompt.js");
    const framing = buildAskUserPrompt("Q", "R", "T").length - 3;
    const worstCase =
      TODAY_CONTEXT_MAX_CHARS + ASK_RECORDS_MAX_CHARS_WITH_TODAY + ASK_QUESTION_MAX_CHARS + framing;
    expect(worstCase + buildAskSystemPrompt().length).toBeGreaterThan(ASK_PROMPT_MAX_CHARS);
  });
});
