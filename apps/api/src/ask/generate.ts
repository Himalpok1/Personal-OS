// Cloud Ask -- the model-calling service (design §6.2, §7, §10).
//
// SECURITY: this module never logs the question, the context, the prompt, or a
// raw provider/SDK error's message/body/stack. AskTimeoutError and
// AskGenerationFailedError (contracts.ts) carry only static messages for
// exactly that reason -- a provider error can echo request headers or body,
// and this lane's request body can carry the user's own note/task text.
//
// PRIMARY MODEL ONLY, NO FALLBACK CHAIN (design §5, bullet 4: "every
// transmission is exactly one deliberate act"). `resolveModelForTask` resolves
// the whole configured chain, but this module deliberately calls `generateText`
// with only `resolved.model` -- the route's primary -- and never touches
// `resolved.fallbacks`. A failed Ask is reported to the user, who re-asks
// deliberately; it is not silently retried against a second, possibly
// different-cost provider the user didn't explicitly choose for this feature.
import { NoProviderConfiguredError, resolveModelForTask } from "@personal-os/ai-providers";
import type { Db } from "@personal-os/db";
import { generateText } from "ai";
import { assertGrant } from "./authorize.js";
import {
  ASK_ATTEMPT_TIMEOUT_MS,
  ASK_MAX_OUTPUT_TOKENS,
  ASK_TASK_NAME,
  AskGenerationFailedError,
  AskProviderDisabledError,
  AskTimeoutError,
} from "./contracts.js";
import { containsLinkShapedContent, sanitizeAskAnswer } from "./output.js";
import { buildAskSystemPrompt, buildAskUserPrompt } from "./prompt.js";

export interface GeneratedAskAnswer {
  answer: string;
  /** The `ai_models.id` that actually served the call. */
  modelRowId: string | null;
  latencyMs: number;
  usageIn?: number;
  usageOut?: number;
  usageTotal?: number;
  finishReason?: string;
}

/**
 * Neither `ai` nor its provider packages export a stable public abort type, so
 * abort-shaped errors are detected structurally -- the same reasoning
 * `apps/api/src/brief/generate.ts` and `apps/worker/src/mail/digest/generate.ts`
 * record, against the same installed versions. `AbortSignal.timeout()` rejects
 * with a DOMException named "TimeoutError", not "AbortError".
 */
function isAbortLikeError(error: unknown): boolean {
  if (error instanceof DOMException) return true;
  if (error instanceof Error) {
    return (
      error.name === "AbortError" ||
      error.name === "TimeoutError" ||
      error.name === "ResponseAborted"
    );
  }
  return false;
}

/**
 * Resolves the `ask` task route and generates an answer over already-selected,
 * already-redacted context.
 *
 * Requires a valid grant, checked FIRST via `assertGrant` -- a forged or
 * missing grant throws before any provider is resolved. `serializedRecords`
 * must be the exact string `buildAskContext` produced (see redact.ts): this
 * function performs no further transformation of it, so the string measured
 * against `ASK_MAX_CONTEXT_CHARS` upstream is the same string embedded here.
 *
 * THROWS ON EVERY FAILURE PATH and never returns a partial or empty answer --
 * the caller persists nothing regardless, but an empty or unfilterable answer
 * is still a failure, not a success with a hole in it.
 */
export async function generateAskAnswer(
  db: Db,
  grant: unknown,
  question: string,
  serializedRecords: string,
  encryptionKey: string,
): Promise<GeneratedAskAnswer> {
  assertGrant(grant);

  // NoProviderConfiguredError propagates unchanged -- it means the "ask" row
  // itself vanished between authorizeCloudAsk's check and this call (a race,
  // not the common case), and the route maps it to the SAME 409
  // cloud_ask_disabled that a missing route always gets. Every OTHER
  // resolution failure (most commonly: the configured connection is
  // disabled) is mapped to AskProviderDisabledError -- see resolve-model.ts's
  // loadModel, which throws a plain Error carrying a connection name for
  // exactly that case, and design §6.4's "two 409s for one state" resolution.
  let resolved;
  try {
    resolved = await resolveModelForTask(db, ASK_TASK_NAME, encryptionKey);
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) throw error;
    throw new AskProviderDisabledError();
  }

  const systemPrompt = buildAskSystemPrompt();
  const userPrompt = buildAskUserPrompt(question, serializedRecords);
  const startedAt = performance.now();

  try {
    const generated = await generateText({
      // PRIMARY ONLY -- see the module comment. `resolved.fallbacks` is never
      // referenced anywhere in this file.
      model: resolved.model,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: ASK_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(ASK_ATTEMPT_TIMEOUT_MS),
      // One deliberate transmission per Ask (design §5, §9): the SDK's own
      // retry must be zero, and there is no outer fallback loop or queue retry
      // beneath this route to pick up the slack -- a failed Ask is reported,
      // not silently re-sent.
      maxRetries: 0,
      // Telemetry is opt-out in ai@7.0.66: omitted, its start event carries
      // the whole prompt -- here, the user's own note/task text -- to any
      // in-process subscriber of the "ai:telemetry" tracing channel. Pinned
      // explicitly and proven silent by generate.test.ts.
      experimental_telemetry: { isEnabled: false },
    });

    // THE OUTPUT FILTER RUNS INSIDE THE ATTEMPT, before anything is returned,
    // matching the Brief and digest's discipline.
    const sanitized = sanitizeAskAnswer(generated.text);
    const text = sanitized.text;
    if (text.length === 0) {
      throw new AskGenerationFailedError();
    }
    if (containsLinkShapedContent(text)) {
      throw new AskGenerationFailedError();
    }

    return {
      answer: text,
      modelRowId: resolved.modelRowId,
      latencyMs: Math.round(performance.now() - startedAt),
      usageIn: generated.usage?.inputTokens,
      usageOut: generated.usage?.outputTokens,
      usageTotal: generated.usage?.totalTokens,
      finishReason: generated.finishReason,
    };
  } catch (error) {
    if (error instanceof AskGenerationFailedError) throw error;
    if (isAbortLikeError(error)) throw new AskTimeoutError();
    // Never let a raw provider/SDK error's message/body/stack escape.
    throw new AskGenerationFailedError();
  }
}
