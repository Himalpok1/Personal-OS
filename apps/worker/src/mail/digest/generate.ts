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
} from "./contracts.js";
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
  const startedAt = performance.now();

  let linksRemoved = 0;

  try {
    const { result, modelRowId } = await callWithFallbackTracked(chain, async (model) => {
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
      });

      // THE OUTPUT FILTER RUNS INSIDE THE ATTEMPT, before anything is returned,
      // so no unfiltered text can reach a caller even transiently.
      const sanitized = sanitizeDigestText(generated.text);
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
      if (containsLinkShapedContent(sanitized.text)) throw new MailDigestFailedError();

      // Server-owned output shape: only `text` is taken from the model's result
      // and reconstructed here, never spread. `MailDigestContentSchema` being
      // `.passthrough()` exists for future SERVER-authored fields, not as a
      // licence to persist arbitrary model-returned keys.
      return MailDigestContentSchema.parse({ text: sanitized.text });
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
