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
import { log } from "@personal-os/core/logging/logger";
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
  collectUntrustedBriefInputs,
} from "./contracts.js";
import { containsLinkShapedContent, sanitizeBriefText } from "./output.js";
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
  // The externally-authored half of THIS payload, computed once and reused by
  // both the filter and its post-condition so the two can never disagree about
  // what was untrusted. See collectUntrustedBriefInputs for why calendar text
  // is the only untrusted class here.
  const untrustedInputs = collectUntrustedBriefInputs(input);
  const startedAt = performance.now();

  // AI USAGE ACCOUNTING (Checkpoint 8.6B, closing recorded debt: this lane
  // previously emitted no ai.usage at all, because apps/api had no guarded
  // logger until this checkpoint ported apps/worker's to @personal-os/core).
  // Declared outside the attempt closure so the values survive it, assigned
  // from the LAST attempt that reached a provider -- the one whose result is
  // actually returned. `calls` comes from candidateIndex, not a literal 1, for
  // the same reason mail/digest/generate.ts's identical comment gives: a
  // primary-fails-then-fallback-succeeds run is an already-tested path.
  let usageIn: number | undefined;
  let usageOut: number | undefined;
  let usageTotal: number | undefined;
  let finishReason: string | undefined;
  let calls = 1;

  try {
    const { result, modelRowId } = await callWithFallbackTracked(
      chain,
      async (model, candidateIndex) => {
        calls = candidateIndex + 1;
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
          // Checkpoint 8.6B (D1f) -- see capture-parse.ts's identical comment.
          // callWithFallbackTracked already owns the fallback chain, and the
          // route owns nothing further (POST /briefs is synchronous, no queue
          // retry beneath it) -- so the SDK's own retry must be zero, not
          // silently doubling or tripling a slow/failing candidate's attempts.
          maxRetries: 0,
          // Telemetry is opt-out in ai@7.0.66: omitted, its start event carries
          // the whole prompt -- here, the user's own Today snapshot -- to any
          // in-process subscriber. Pinned explicitly rather than relying on
          // nothing subscribing today.
          experimental_telemetry: { isEnabled: false },
        });

        // Scalars only, and every one of them first-party or SDK-normalized --
        // see the mail digest's identical comment for why each field here is
        // safe to log. Deliberately absent: generated.text, providerMetadata,
        // rawFinishReason, response.modelId/headers/body, usage.raw.
        usageIn = generated.usage?.inputTokens;
        usageOut = generated.usage?.outputTokens;
        usageTotal = generated.usage?.totalTokens;
        finishReason = generated.finishReason;

        // THE OUTPUT FILTER RUNS INSIDE THE ATTEMPT, before anything is
        // returned, so no unfiltered text can reach a caller even transiently.
        // Before Checkpoint 8.1 this was a bare `.trim()` and the Brief lane had
        // no output constraint at all -- see output.ts for why that was a real
        // gap rather than a theoretical one.
        const sanitized = sanitizeBriefText(generated.text, untrustedInputs);
        const text = sanitized.text;
        if (text.length === 0) {
          // An empty brief is a failure, not a success -- the frozen
          // no-overwrite invariant means this must never displace a good
          // cached brief with an empty one.
          throw new BriefGenerationFailedError();
        }

        // Post-condition, asserted rather than assumed. If link-shaped content
        // survives the filter, the filter has a hole, and a persisted brief
        // carrying a live link is exactly what ADR-054's reasoning forbids -- so
        // the brief is refused rather than stored with a warning nobody reads.
        if (containsLinkShapedContent(text, untrustedInputs)) {
          throw new BriefGenerationFailedError();
        }

        // Server-owned output: only `text` is taken from the model's result
        // and re-constructed here, never spread -- BriefContentSchema being
        // `.passthrough()` is for future server-authored fields, not a
        // license to persist arbitrary model-returned keys.
        return BriefContentSchema.parse({ text });
      },
    );

    // COUNTS ONLY. NO PROMPT, NO OUTPUT, NO USER CONTENT.
    log.info("ai.usage", {
      task: DAILY_BRIEF_TASK_NAME,
      modelId: modelRowId,
      calls,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(usageIn === undefined ? {} : { usageIn }),
      ...(usageOut === undefined ? {} : { usageOut }),
      ...(usageTotal === undefined ? {} : { usageTotal }),
      ...(finishReason === undefined ? {} : { finishReason }),
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
