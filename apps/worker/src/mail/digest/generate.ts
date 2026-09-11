import {
  callWithFallbackTracked,
  NoProviderConfiguredError,
  resolveModelForTask,
} from "@personal-os/ai-providers";
import type { Db } from "@personal-os/db";
import { MailDigestContentSchema, type MailDigestContent } from "@personal-os/schema";
import { generateText } from "ai";
import {
  MAIL_DIGEST_ATTEMPT_TIMEOUT_MS,
  MAIL_DIGEST_MAX_OUTPUT_TOKENS,
  MAIL_DIGEST_TASK_NAME,
  MAIL_DIGEST_TOTAL_BUDGET_MS,
  MailDigestFailedError,
  MailDigestTimeoutError,
  type MailDigestInput,
  collectUntrustedDigestInputs,
} from "./contracts.js";
import { log } from "../../logger.js";
import { containsLinkShapedContent, sanitizeDigestText } from "./output.js";
import { buildMailDigestSystemPrompt, buildMailDigestUserPrompt } from "./prompt.js";

// Model-calling service for the mail digest (ADR-053/054).
//
// Resolves the configured `mail_digest` route through the EXISTING
// provider-agnostic layer -- no new AI framework, no new credential path, no new
// env var. `ai_task_routes` already answers "which model serves this task", and
// `callWithFallbackTracked` already answers "which model actually served it".
//
// SECURITY: this module never logs the prompt, the `MailDigestInput`, or a raw
// provider/SDK error's message, body or stack. That matters more here than it
// did for the brief: the prompt CONTAINS attacker-authored subject lines, so a
// provider error that echoes the request body is a direct route from a stranger's
// subject into a worker log. Both error types carry static messages for exactly
// that reason.

export interface GeneratedMailDigest {
  content: MailDigestContent;
  /**
   * The `ai_models.id` that ACTUALLY served the call -- straight from
   * `callWithFallbackTracked`, never re-derived from the route's primary, so a
   * fallback hit is never misrecorded as the primary's provenance.
   */
  modelRowId: string | null;
  /** How many link-shaped fragments the output filter removed. */
  linksRemoved: number;
}

export interface GenerateMailDigestOptions {
  attemptTimeoutMs?: number;
  totalBudgetMs?: number;
}

/**
 * Neither `ai` nor its provider packages export a stable public abort type, so
 * abort-shaped errors are detected structurally -- the same reasoning
 * `apps/api/src/brief/generate.ts` records, against the same installed versions.
 * `AbortSignal.timeout()` rejects with a DOMException named "TimeoutError", not
 * "AbortError".
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
 * Resolves the `mail_digest` route and generates the digest text.
 *
 * Timeout model, matching the brief's: one monotonic origin captured before the
 * first candidate, so a slow primary genuinely eats into a fallback's share
 * rather than each candidate getting a fresh full budget. Once the budget is
 * gone no further candidate reaches `generateText` -- the timeout is thrown
 * BEFORE the provider call, not after it starts.
 *
 * THROWS ON EVERY FAILURE PATH, and never returns a partial or empty digest.
 * That is what makes the no-overwrite guarantee structural rather than
 * conventional: the caller persists only what this function returns, so there is
 * no value it can produce that would replace a good cached digest with a bad one.
 */
export async function generateMailDigest(
  db: Db,
  input: MailDigestInput,
  encryptionKey: string,
  opts: GenerateMailDigestOptions = {},
): Promise<GeneratedMailDigest> {
  const attemptTimeoutMs = opts.attemptTimeoutMs ?? MAIL_DIGEST_ATTEMPT_TIMEOUT_MS;
  const totalBudgetMs = opts.totalBudgetMs ?? MAIL_DIGEST_TOTAL_BUDGET_MS;

  // NoProviderConfiguredError propagates unchanged -- the caller treats "no
  // model configured" as a skip rather than a failure, because it is a
  // deployment state, not a fault. Every OTHER resolution failure is sanitized
  // here: resolve-model.ts can throw plain Errors carrying a user-chosen
  // connection label, an internal ai_models uuid, or a raw Node crypto error
  // from a rotated CREDENTIALS_ENCRYPTION_KEY, and an unmapped throw would reach
  // the job's error containment carrying text nobody vetted.
  let chain;
  try {
    chain = await resolveModelForTask(db, MAIL_DIGEST_TASK_NAME, encryptionKey);
  } catch (error) {
    if (error instanceof NoProviderConfiguredError) throw error;
    throw new MailDigestFailedError();
  }

  const systemPrompt = buildMailDigestSystemPrompt();
  const userPrompt = buildMailDigestUserPrompt(input);
  // The attacker-authored half of THIS payload, computed once and reused by both
  // the filter and its post-condition so the two can never disagree about what
  // was untrusted. See collectUntrustedDigestInputs for why it lives in
  // contracts.ts rather than here.
  const untrustedInputs = collectUntrustedDigestInputs(input);
  const startedAt = performance.now();

  let linksRemoved = 0;
  // AI USAGE ACCOUNTING (Checkpoint 8.1). Declared OUTSIDE the attempt closure
  // so the values survive it, and assigned from the LAST attempt that reached a
  // provider -- which is the one whose result is returned.
  //
  // `calls` comes from `candidateIndex`, not a literal 1. callWithFallbackTracked
  // loops the fallback chain, and a primary-fails-then-fallback-succeeds run is
  // an already-tested path (generate.test.ts), so a hardcoded 1 would understate
  // real provider calls exactly when the number mattered most.
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
        const remaining = totalBudgetMs - (performance.now() - startedAt);
        if (remaining <= 0) throw new MailDigestTimeoutError();

        // A fresh AbortSignal per attempt, bounded by both the per-attempt cap and
        // the remaining budget. Floored (never rounded past the real deadline) and
        // clamped to at least 1ms, since `remaining > 0` can still be sub-1ms.
        const signalMs = Math.max(1, Math.floor(Math.min(attemptTimeoutMs, remaining)));

        const generated = await generateText({
          model,
          system: systemPrompt,
          prompt: userPrompt,
          maxOutputTokens: MAIL_DIGEST_MAX_OUTPUT_TOKENS,
          abortSignal: AbortSignal.timeout(signalMs),
          // Checkpoint 8.6B (D1f) -- see apps/worker/src/jobs/capture-parse.ts's
          // identical comment. callWithFallbackTracked already owns the
          // fallback chain; the SDK's own internal retry must be zero so it
          // cannot silently re-send a prompt containing attacker-authored
          // subject lines.
          maxRetries: 0,
          // Telemetry is opt-out in ai@7.0.66: omitted, its start event
          // carries the whole prompt -- here, attacker-authored subjects and
          // display names -- to any in-process subscriber. Pinned explicitly.
          experimental_telemetry: { isEnabled: false },
        });

        // THE OUTPUT FILTER RUNS INSIDE THE ATTEMPT, before anything is returned,
        // so no unfiltered text can reach a caller even transiently.
        // Scalars only, and every one of them first-party or SDK-normalized. See
        // the emit below for why each is safe.
        usageIn = generated.usage?.inputTokens;
        usageOut = generated.usage?.outputTokens;
        usageTotal = generated.usage?.totalTokens;
        finishReason = generated.finishReason;

        const sanitized = sanitizeDigestText(generated.text, untrustedInputs);
        linksRemoved = sanitized.linksRemoved;

        if (sanitized.text.length === 0) {
          // An empty digest is a FAILURE, not a success. Returning it would let
          // the no-overwrite invariant be satisfied on a technicality while a good
          // cached digest was replaced by nothing.
          throw new MailDigestFailedError();
        }

        // Post-condition, asserted rather than assumed. If link-shaped content
        // survives the filter, the filter has a hole, and a digest carrying a live
        // link is exactly what ADR-054 forbids -- so the digest is refused rather
        // than persisted with a warning nobody reads.
        if (containsLinkShapedContent(sanitized.text, untrustedInputs)) {
          throw new MailDigestFailedError();
        }

        // Server-owned output shape: only `text` is taken from the model's result
        // and reconstructed here, never spread. `MailDigestContentSchema` being
        // `.passthrough()` exists for future SERVER-authored fields, not as a
        // licence to persist arbitrary model-returned keys.
        return MailDigestContentSchema.parse({ text: sanitized.text });
      },
    );

    // ===================================================================
    // STRUCTURED USAGE ONLY. NO PROMPT, NO OUTPUT, NO ATTACKER TEXT.
    // ===================================================================
    //
    // Emitted through the worker's guarded logger, whose `LogFields` type
    // accepts scalars only and whose denylist replaces a forbidden name with
    // `[forbidden-field]`. Every field below is either a literal from this
    // source, a first-party uuid, a number the provider adapter validated as a
    // number before the SDK returned it, or `finishReason` -- a six-member
    // union the SDK MAPS the provider's raw value onto, never the raw value.
    //
    // Deliberately absent: `generated.text`, `providerMetadata`,
    // `rawFinishReason`, `response.modelId`/`headers`/`body`, and `usage.raw`.
    // `modelRowId` already gives provenance as our own uuid, so the provider's
    // model string would add a provider-controlled value for nothing.
    //
    // `usage*` are optional: the AI SDK types them as possibly-undefined and not
    // every provider populates them. Undefined fields are omitted rather than
    // defaulted to 0, because a fabricated zero is worse than a missing number.
    log.info("ai.usage", {
      task: MAIL_DIGEST_TASK_NAME,
      modelId: modelRowId,
      calls,
      latencyMs: Math.round(performance.now() - startedAt),
      ...(usageIn === undefined ? {} : { usageIn }),
      ...(usageOut === undefined ? {} : { usageOut }),
      ...(usageTotal === undefined ? {} : { usageTotal }),
      ...(finishReason === undefined ? {} : { finishReason }),
    });

    return { content: result, modelRowId, linksRemoved };
  } catch (error) {
    // A candidate already threw one of the two typed errors (budget exhaustion,
    // empty or unfilterable text) -- propagate as-is rather than re-mapping it.
    if (error instanceof MailDigestTimeoutError || error instanceof MailDigestFailedError) {
      throw error;
    }
    if (isAbortLikeError(error) || performance.now() - startedAt >= totalBudgetMs) {
      throw new MailDigestTimeoutError();
    }
    // Never let a raw provider/SDK error's message, body or stack escape. The
    // prompt that produced it contained attacker-authored subject lines.
    throw new MailDigestFailedError();
  }
}
