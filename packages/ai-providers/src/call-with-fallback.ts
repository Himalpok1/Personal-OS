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

export interface TrackedCallResult<T> {
  result: T;
  modelRowId: string;
}

// Same fallback semantics and the same invariant as callWithFallback above --
// only explicitly-configured fallbacks are ever tried, never a silent
// provider switch -- but additionally reports which candidate's ai_models.id
// actually produced the result, so a caller can record real provenance
// (e.g. which model served a generation) instead of assuming it was always
// the route's primary.
export async function callWithFallbackTracked<T>(
  chain: ResolvedModel,
  attempt: (model: LanguageModel, candidateIndex: number) => Promise<T>,
): Promise<TrackedCallResult<T>> {
  if (chain.fallbacks.length !== chain.fallbackModelRowIds.length) {
    throw new Error(
      "callWithFallbackTracked: fallbacks and fallbackModelRowIds must be the same length",
    );
  }
  const candidates: Array<{ model: LanguageModel; modelRowId: string }> = [
    { model: chain.model, modelRowId: chain.modelRowId },
  ];
  for (const [index, model] of chain.fallbacks.entries()) {
    // Safe: length equality was just checked above.
    const modelRowId = chain.fallbackModelRowIds[index] as string;
    candidates.push({ model, modelRowId });
  }

  let lastError: unknown;
  for (const [candidateIndex, candidate] of candidates.entries()) {
    try {
      const result = await attempt(candidate.model, candidateIndex);
      return { result, modelRowId: candidate.modelRowId };
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
