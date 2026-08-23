// Checkpoint 5.5 -- model-calling service for the manual AI Daily Brief
// (ADR-041). Resolves the configured `daily_brief` route, calls the model
// (with the route's explicit fallback chain, per callWithFallbackTracked's
// no-silent-provider-switch invariant), and enforces the frozen timeout
// model. Owns no HTTP concerns -- the route maps the errors thrown here to
// status codes, and NoProviderConfiguredError is left to propagate
// unchanged for that same mapping.
//
// SECURITY: this module never logs the prompt, the BriefInput payload, or a
// raw provider/SDK error's message/body/stack. BriefGenerationTimeoutError
// and BriefGenerationFailedError (contracts.ts) carry only static messages
// for exactly that reason -- a provider error can echo request headers or
// body, so its text must never reach a thrown error, a log line, or the
// persisted brief.

import {
  callWithFallbackTracked,
  NoProviderConfiguredError,
  resolveModelForTask,
} from "@personal-os/ai-providers";
import type { Db } from "@personal-os/db";
import { BriefContentSchema, type BriefContent } from "@personal-os/schema";
import { generateText } from "ai";
import {
  BRIEF_ATTEMPT_TIMEOUT_MS,
  BRIEF_MAX_OUTPUT_TOKENS,
  BRIEF_TOTAL_BUDGET_MS,
  BriefGenerationFailedError,
  BriefGenerationTimeoutError,
  DAILY_BRIEF_TASK_NAME,
  type BriefInput,
} from "./contracts.js";
import { buildBriefSystemPrompt, buildBriefUserPrompt } from "./prompt.js";

export interface GeneratedBrief {
  content: BriefContent;
  // The ai_models.id that actually served the call -- straight from
  // callWithFallbackTracked, never re-derived from the route's primary, so
  // a fallback hit is never misrecorded as the primary's provenance.
  modelRowId: string | null;
}

export interface GenerateDailyBriefOptions {
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
}

// Defensive by design: neither `ai` nor its underlying provider packages
// export a stable public AbortError/isAbortError type this package can rely
// on (checked directly against the installed `ai@7.0.66` and
// `@ai-sdk/provider-utils` sources -- provider-utils' own internal
// `isAbortError` treats "AbortError", "ResponseAborted", and "TimeoutError"
// as abort-shaped, and Node's own `AbortSignal.timeout()` fires with a
// DOMException named "TimeoutError", not "AbortError"). Any DOMException is
// also treated as abort-like -- a non-abort DOMException reaching this path
// is not a realistic shape for a fetch-based provider call to throw.
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
 * Resolves the `daily_brief` task route and generates the brief text.
 *
 * Timeout model: a single monotonic start time is captured before the first
 * candidate is attempted. Every candidate's remaining budget is measured
 * against that one origin (not reset per candidate), so a slow primary
 * genuinely eats into a fallback's share rather than each candidate getting
 * its own fresh `totalBudgetMs`. Once the remaining budget is exhausted, no
 * further candidate ever reaches `generateText` -- the timeout is thrown
 * before the provider call, not after it starts.
 */
export async function generateDailyBrief(
  db: Db,
  input: BriefInput,
  encryptionKey: string,
  opts: GenerateDailyBriefOptions = {},
): Promise<GeneratedBrief> {
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? BRIEF_ATTEMPT_TIMEOUT_MS;
  const totalBudgetMs = opts.totalBudgetMs ?? BRIEF_TOTAL_BUDGET_MS;

  // NoProviderConfiguredError propagates unchanged -- the route maps it to
  // 409. Every OTHER resolution failure is sanitized here rather than left
  // to escape: resolve-model.ts can throw plain Errors carrying a
  // user-chosen connection label, an internal ai_models uuid, or a raw Node
  // crypto error (a rotated CREDENTIALS_ENCRYPTION_KEY against stored
  // ciphertext), and an unmapped throw would reach server.ts's generic
  // handler and be logged verbatim via request.log.error({ err }). Mapping
  // to the static-message failure error keeps this module's stated
  // "no raw error text ever reaches a log or a response" invariant true for
  // the resolution phase too, not just the model call.
  let chain;
  try {
    chain = await resolveModelForTask(db, DAILY_BRIEF_TASK_NAME, encryptionKey);
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) throw error;
    throw new BriefGenerationFailedError();
  }

  const systemPrompt = buildBriefSystemPrompt();
  const userPrompt = buildBriefUserPrompt(input);
  const startedAt = performance.now();

  try {
    const { result, modelRowId } = await callWithFallbackTracked(chain, async (model) => {
      const elapsed = performance.now() - startedAt;
      const remaining = totalBudgetMs - elapsed;
      if (remaining <= 0) {
        // No further provider call for this (or any later) candidate --
        // the total budget is already gone.
        throw new BriefGenerationTimeoutError();
      }

      // A fresh AbortSignal per attempt -- Math.min bounds it by both the
      // per-attempt cap and whatever budget is left, and a signal that has
      // already fired is never reused for a fallback candidate.
      // AbortSignal.timeout() requires an integer millisecond count --
      // performance.now() has sub-millisecond precision, so `remaining`
      // must be floored (never rounded up past the real deadline) and
      // floor-clamped to at least 1ms since `remaining > 0` was already
      // checked above but could still be a sub-1ms fraction.
      const signalMs = Math.max(1, Math.floor(Math.min(attemptTimeoutMs, remaining)));
      const abortSignal = AbortSignal.timeout(signalMs);

      const generated = await generateText({
        model,
        system: systemPrompt,
        prompt: userPrompt,
        maxOutputTokens: BRIEF_MAX_OUTPUT_TOKENS,
        abortSignal,
      });

      const text = generated.text.trim();
      if (text.length === 0) {
        // An empty brief is a failure, not a success -- the frozen
        // no-overwrite invariant means this must never displace a good
        // cached brief with an empty one.
        throw new BriefGenerationFailedError();
      }

      // Server-owned output: only `text` is taken from the model's result
      // and re-constructed here, never spread -- BriefContentSchema being
      // `.passthrough()` is for future server-authored fields, not a
      // license to persist arbitrary model-returned keys.
      return BriefContentSchema.parse({ text });
    });

    return { content: result, modelRowId };
  } catch (error) {
    // A candidate already threw one of these two typed errors directly
    // (budget exhaustion, empty text) -- propagate as-is rather than
    // re-mapping it through the generic classification below.
    if (
      error instanceof BriefGenerationTimeoutError ||
      error instanceof BriefGenerationFailedError
    ) {
      throw error;
    }
    if (isAbortLikeError(error) || performance.now() - startedAt >= totalBudgetMs) {
      throw new BriefGenerationTimeoutError();
    }
    // Never let a raw provider/SDK error's message/body/stack escape --
    // BriefGenerationFailedError's constructor carries only a static
    // message for exactly this reason.
    throw new BriefGenerationFailedError();
  }
}
