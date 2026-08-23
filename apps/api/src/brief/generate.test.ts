// Pure-logic tests for the Daily Brief generation service -- no DB, no
// network, no real provider (mirrors prompt.test.ts's no-DB style, since
// `db` here is only ever forwarded, unused, into the mocked
// resolveModelForTask). `@personal-os/ai-providers` is partial-mocked per
// this codebase's established ptt-transcribe.test.ts pattern (spread over
// vi.importActual, stubbing only the one function under test's control),
// keeping callWithFallbackTracked's REAL implementation in play so the
// fallback/candidate-index/provenance behavior is exercised for real, not
// re-implemented in a mock. The `ai` package's generateText is likewise
// partial-mocked.

import type * as AiProviders from "@personal-os/ai-providers";
import { NoProviderConfiguredError } from "@personal-os/ai-providers";
import type { Db } from "@personal-os/db";
import type { LanguageModel } from "ai";
import type * as Ai from "ai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BriefInput } from "./contracts.js";
import { BriefGenerationFailedError, BriefGenerationTimeoutError } from "./contracts.js";
import { buildBriefSystemPrompt, buildBriefUserPrompt } from "./prompt.js";

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
const { generateDailyBrief } = await import("./generate.js");

const FAKE_DB = {} as Db;
const FAKE_ENCRYPTION_KEY = "test-encryption-key";

function fakeModel(tag: string): LanguageModel {
  return { modelId: tag } as unknown as LanguageModel;
}

const SAMPLE_INPUT: BriefInput = {
  generated_at: "2026-08-22T14:00:00.000Z",
  tz: "America/Chicago",
  local_date: "2026-08-22",
  summary: {
    overdue_total: 0,
    due_today_total: 0,
    inbox_attention_total: 0,
    active_project_count: 0,
  },
  overdue: { items: [], total: 0 },
  due_today: { items: [], total: 0 },
  events_today: { items: [], total: 0 },
  upcoming: { items: [], total: 0 },
  inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, snippets: [] },
  projects: { items: [], total: 0 },
  reviews: { daily_status: null, weekly_status: null },
};

// A single-candidate chain (no configured fallback) -- the common case.
function singleCandidateChain(): AiProviders.ResolvedModel {
  return {
    model: fakeModel("primary"),
    modelRowId: "model-primary-id",
    fallbacks: [],
    fallbackModelRowIds: [],
  };
}

// A two-candidate chain: one explicitly configured fallback.
function chainWithFallback(): AiProviders.ResolvedModel {
  return {
    model: fakeModel("primary"),
    modelRowId: "model-primary-id",
    fallbacks: [fakeModel("fallback")],
    fallbackModelRowIds: ["model-fallback-id"],
  };
}

// Derived from the real (unmocked-in-type) generateText signature rather
// than hand-picking GenerateTextResult's type parameters, which avoids
// fighting its multi-parameter generic shape for a fixture that only ever
// needs `.text`.
type GenerateTextReturn = Awaited<ReturnType<typeof Ai.generateText>>;

function fakeGenerateTextResult(text: string): GenerateTextReturn {
  return { text } as unknown as GenerateTextReturn;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("generateDailyBrief", () => {
  it("happy path: returns the generated content and the serving model's id", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("You have 2 tasks today."));

    const brief = await generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY);

    expect(brief).toEqual({
      content: { text: "You have 2 tasks today." },
      modelRowId: "model-primary-id",
    });
  });

  it("calls generateText with the exact frozen shape: maxOutputTokens, system, prompt, an abortSignal, and no tools key", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("Brief text."));

    await generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY);

    expect(generateText).toHaveBeenCalledTimes(1);
    const call = vi.mocked(generateText).mock.calls[0]![0];
    expect(call.system).toBe(buildBriefSystemPrompt());
    expect(call.prompt).toBe(buildBriefUserPrompt(SAMPLE_INPUT));
    expect(call.maxOutputTokens).toBe(800);
    expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    expect(call).not.toHaveProperty("tools");
    expect(call).not.toHaveProperty("temperature");
  });

  it("server-owned output: extra fields on the model's result are not persisted, only text", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    // Cast past GenerateTextResult's real shape -- simulating a model/SDK
    // response carrying fields generateDailyBrief must not trust or persist.
    vi.mocked(generateText).mockResolvedValue({
      text: "Brief text.",
      reasoning: "some internal reasoning the model should not leak",
      sources: ["not a real field on BriefContent"],
    } as unknown as GenerateTextReturn);

    const brief = await generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY);

    expect(Object.keys(brief.content)).toEqual(["text"]);
    expect(brief.content).toEqual({ text: "Brief text." });
  });

  it("throws BriefGenerationFailedError for empty text", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult(""));

    await expect(generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY)).rejects.toThrow(
      BriefGenerationFailedError,
    );
  });

  it("throws BriefGenerationFailedError for whitespace-only text", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    vi.mocked(generateText).mockResolvedValue(fakeGenerateTextResult("   \n\t  "));

    await expect(generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY)).rejects.toThrow(
      BriefGenerationFailedError,
    );
  });

  it("lets NoProviderConfiguredError propagate unchanged, not wrapped", async () => {
    vi.mocked(resolveModelForTask).mockRejectedValue(new NoProviderConfiguredError("daily_brief"));

    await expect(
      generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY),
    ).rejects.toBeInstanceOf(NoProviderConfiguredError);
    expect(generateText).not.toHaveBeenCalled();
  });

  it("maps a generic provider failure to BriefGenerationFailedError without leaking the original message", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    const secret = "sk-secret-value";
    vi.mocked(generateText).mockRejectedValue(
      new Error(`upstream 401: invalid api key ${secret} rejected by provider`),
    );

    let caught: unknown;
    try {
      await generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(BriefGenerationFailedError);
    const err = caught as Error;
    expect(err.message).not.toContain(secret);
    expect(err.name).not.toContain(secret);
    expect(JSON.stringify(err)).not.toContain(secret);
  });

  it("maps an aborted attempt to BriefGenerationTimeoutError", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    const abortError = new DOMException("The operation was aborted.", "TimeoutError");
    vi.mocked(generateText).mockRejectedValue(abortError);

    await expect(generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY)).rejects.toThrow(
      BriefGenerationTimeoutError,
    );
  });

  it("maps a plain-Error abort shape (name 'AbortError') to BriefGenerationTimeoutError too", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(singleCandidateChain());
    const abortError = new Error("aborted");
    abortError.name = "AbortError";
    vi.mocked(generateText).mockRejectedValue(abortError);

    await expect(generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY)).rejects.toThrow(
      BriefGenerationTimeoutError,
    );
  });

  it("budget exhaustion: does not attempt a second candidate once the total budget is gone", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(chainWithFallback());
    // The primary takes real wall-clock time and then fails -- long enough
    // to exceed the tiny total budget below, so by the time
    // callWithFallbackTracked reaches the fallback candidate, this
    // module's own remaining-budget check must reject it before calling
    // generateText a second time.
    vi.mocked(generateText).mockImplementationOnce(async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      throw new Error("primary provider unreachable");
    });

    await expect(
      generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY, {
        totalBudgetMs: 10,
        attemptTimeoutMs: 10,
      }),
    ).rejects.toThrow(BriefGenerationTimeoutError);

    expect(generateText).toHaveBeenCalledTimes(1);
  });

  it("gives each attempt a fresh AbortSignal and reports the fallback's model id on success", async () => {
    vi.mocked(resolveModelForTask).mockResolvedValue(chainWithFallback());
    vi.mocked(generateText)
      .mockRejectedValueOnce(new Error("primary down"))
      .mockResolvedValueOnce(fakeGenerateTextResult("Fallback brief."));

    const brief = await generateDailyBrief(FAKE_DB, SAMPLE_INPUT, FAKE_ENCRYPTION_KEY, {
      totalBudgetMs: 5_000,
      attemptTimeoutMs: 5_000,
    });

    expect(generateText).toHaveBeenCalledTimes(2);
    const firstSignal = vi.mocked(generateText).mock.calls[0]![0].abortSignal;
    const secondSignal = vi.mocked(generateText).mock.calls[1]![0].abortSignal;
    expect(firstSignal).toBeInstanceOf(AbortSignal);
    expect(secondSignal).toBeInstanceOf(AbortSignal);
    expect(firstSignal).not.toBe(secondSignal);

    expect(brief).toEqual({
      content: { text: "Fallback brief." },
      modelRowId: "model-fallback-id",
    });
  });
});
