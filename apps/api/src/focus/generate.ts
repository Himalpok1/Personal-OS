// Suggested Focus -- the model-calling service (Checkpoint 9.8 design gate).
//
// SECURITY: this module never logs the today-context, the prompt, or a raw
// provider/SDK error's message/body/stack. FocusTimeoutError and
// FocusGenerationFailedError (contracts.ts) carry only static messages for
// exactly that reason.
//
// This file lives under apps/api/src/focus/, a SIBLING of
// apps/api/src/intelligence/, deliberately outside that directory: Guard 4 in
// ask/ai-egress-guard.test.ts forbids any `ai`/provider import and any DB
// write verb under apps/api/src/intelligence/, exactly the way
// apps/api/src/ask/generate.ts already lives outside intelligence/ despite
// calling buildTodayContext from it. This module is also added to Guard 1's
// EXPECTED_MODEL_CALLERS set (a sixth, reviewed entry) because it calls
// `generateText` directly.
//
// PRIMARY MODEL ONLY, NO FALLBACK CHAIN, and the SAME "ask" task route Cloud
// Ask uses -- there is no separate `ai_task_routes` row or task name for
// Suggested Focus. Whatever model/connection the owner has configured for
// Cloud Ask is what serves this call too.
import { NoProviderConfiguredError, resolveModelForTask } from "@personal-os/ai-providers";
import type { Db } from "@personal-os/db";
import { generateText } from "ai";
import { assertGrant } from "../ask/authorize.js";
import { ASK_TASK_NAME, AskProviderDisabledError } from "../ask/contracts.js";
import {
  FOCUS_ATTEMPT_TIMEOUT_MS,
  FOCUS_MAX_OUTPUT_TOKENS,
  FocusGenerationFailedError,
  FocusTimeoutError,
} from "./contracts.js";
import { containsLinkShapedContent, sanitizeFocusSuggestion } from "./output.js";
import { buildFocusSystemPrompt, buildFocusUserPrompt } from "./prompt.js";

export interface GeneratedFocusSuggestion {
  suggestion: string;
  /** The `ai_models.id` that actually served the call. */
  modelRowId: string | null;
  latencyMs: number;
  usageIn?: number;
  usageOut?: number;
  usageTotal?: number;
  finishReason?: string;
}

/**
 * Neither `ai` nor its provider packages export a stable public abort type,
 * so abort-shaped errors are detected structurally -- the same reasoning
 * apps/api/src/ask/generate.ts, apps/api/src/brief/generate.ts and
 * apps/worker/src/mail/digest/generate.ts each record independently, against
 * the same installed versions. This is the fourth copy of the helper; the
 * established, accepted pattern in this codebase is not to extract a shared
 * one (recorded debt, not attempted here either).
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
 * Resolves the SAME `ask` task route Cloud Ask uses and generates a
 * suggestion over an already-built `TodayContext`.
 *
 * Requires a valid grant, checked FIRST via `assertGrant` -- a forged or
 * missing grant throws before any provider is resolved. `serializedToday`
 * must be the exact `TodayContextBuild.serialized` string; this function
 * performs no further transformation of it.
 *
 * THROWS ON EVERY FAILURE PATH and never returns a partial or empty
 * suggestion.
 */
export async function generateFocusSuggestion(
  db: Db,
  grant: unknown,
  serializedToday: string,
  untrustedInputs: readonly string[],
  encryptionKey: string,
): Promise<GeneratedFocusSuggestion> {
  assertGrant(grant);

  // NoProviderConfiguredError propagates unchanged -- it means the "ask" row
  // itself vanished between authorizeCloudAsk's check and this call (a race,
  // not the common case), and the route maps it to the SAME 409
  // cloud_ask_disabled that a missing route always gets. Every OTHER
  // resolution failure is mapped to AskProviderDisabledError, exactly as
  // ask/generate.ts's loadModel call does.
  let resolved;
  try {
    resolved = await resolveModelForTask(db, ASK_TASK_NAME, encryptionKey);
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) throw error;
    throw new AskProviderDisabledError();
  }

  const systemPrompt = buildFocusSystemPrompt();
  const userPrompt = buildFocusUserPrompt(serializedToday);
  const startedAt = performance.now();

  try {
    const generated = await generateText({
      // PRIMARY ONLY -- resolved.fallbacks is never referenced anywhere in
      // this file, matching ask/generate.ts's module comment.
      model: resolved.model,
      system: systemPrompt,
      prompt: userPrompt,
      maxOutputTokens: FOCUS_MAX_OUTPUT_TOKENS,
      abortSignal: AbortSignal.timeout(FOCUS_ATTEMPT_TIMEOUT_MS),
      // One deliberate transmission per tap: the SDK's own retry must be
      // zero, and there is no outer fallback loop or queue retry beneath
      // this route to pick up the slack.
      maxRetries: 0,
      // Telemetry is opt-out in the installed `ai` SDK: omitted, its start
      // event carries the whole prompt -- here, today's schedule -- to any
      // in-process subscriber of the "ai:telemetry" tracing channel.
      experimental_telemetry: { isEnabled: false },
    });

    // THE OUTPUT FILTER RUNS INSIDE THE ATTEMPT, before anything is
    // returned, matching Ask/Brief/digest's discipline.
    const sanitized = sanitizeFocusSuggestion(generated.text, untrustedInputs);
    const text = sanitized.text;
    if (text.length === 0) {
      throw new FocusGenerationFailedError();
    }
    if (containsLinkShapedContent(text, untrustedInputs)) {
      throw new FocusGenerationFailedError();
    }

    return {
      suggestion: text,
      modelRowId: resolved.modelRowId,
      latencyMs: Math.round(performance.now() - startedAt),
      usageIn: generated.usage?.inputTokens,
      usageOut: generated.usage?.outputTokens,
      usageTotal: generated.usage?.totalTokens,
      finishReason: generated.finishReason,
    };
  } catch (error) {
    if (error instanceof FocusGenerationFailedError) throw error;
    if (isAbortLikeError(error)) throw new FocusTimeoutError();
    // Never let a raw provider/SDK error's message/body/stack escape.
    throw new FocusGenerationFailedError();
  }
}
