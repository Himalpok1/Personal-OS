import type { LanguageModel } from "ai";
import type { ResolvedModel } from "./resolve-model.js";

// Tries the primary model, then each fallback in order -- but only the
// ones the caller explicitly configured on ai_task_routes.fallback_model_ids.
// No fallback chain configured means no fallback: the call just fails. This
// is deliberate -- Personal OS must never silently switch a task to a
// different, possibly paid, provider the user didn't opt into.
export async function callWithFallback<T>(
  chain: ResolvedModel,
  attempt: (model: LanguageModel) => Promise<T>,
): Promise<T> {
  const candidates = [chain.model, ...chain.fallbacks];
  let lastError: unknown;
  for (const model of candidates) {
    try {
      return await attempt(model);
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
