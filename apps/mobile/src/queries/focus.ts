import { ApiClientError } from "@personal-os/api-client";
import type { FocusSuggestionResponse, TodayResponse } from "@personal-os/schema";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { handleAskCloudError } from "@/queries/ask";
import { api } from "./client";
import { deviceTimezone } from "./today";

// Suggested Focus (Checkpoint 9.8) -- a narrower sibling of Cloud Ask that
// reuses the "ask" task route as its consent switch. See
// packages/schema/src/focus.ts for the wire contract; this file is the
// mobile query/mutation layer, mirroring queries/ask.ts's own conventions
// (askCloudMutationOptions / useAskCloud) closely.

/**
 * Pure: the client-side candidate-count gate, computed from the same /today
 * summary counters the Overdue/Due today chips already render. Exported for
 * direct unit testing. The server independently recomputes the same number
 * against TodayContext (packages/schema/src/focus.ts); a disagreement is
 * handled as a soft outcome, not an error -- see isFocusNotEnoughCandidatesError.
 */
export function focusCandidateCount(
  summary: Pick<TodayResponse["summary"], "overdue_total" | "due_today_total">,
): number {
  return summary.overdue_total + summary.due_today_total;
}

/** True when the server independently recomputed and refused -- a race with the client's own gate. */
export function isFocusNotEnoughCandidatesError(err: unknown): boolean {
  return err instanceof ApiClientError && err.code === "focus_not_enough_candidates";
}

// focus_not_enough_candidates is deliberately absent here -- it is its own
// SuggestedFocusState kind ("not_enough_candidates"), never routed through
// this map, because it is a soft outcome, not an error. cloud_ask_disabled
// and ask_consent_outdated reuse the Settings card's own wording via
// handleAskCloudError below, since they describe the same switch.
const FOCUS_ERROR_COPY: Record<string, string> = {
  cloud_ask_disabled: "Cloud Ask was turned off.",
  ask_consent_outdated: "Cloud Ask's scope changed. Re-enable it in Settings to continue.",
  focus_in_flight: "Already getting a suggestion — try again in a moment.",
  focus_uncited:
    "That suggestion referred to something that isn't in your data, so it was discarded. Try again.",
  focus_failed: "The AI provider request failed.",
  focus_timeout: "The provider didn't respond in time.",
  no_provider_configured: "The configured AI provider is unavailable right now.",
};

/** Never returns an empty string, and never echoes provider or server text. */
export function focusErrorMessage(err: unknown): string {
  const code = err instanceof ApiClientError ? err.code : undefined;
  return (code && FOCUS_ERROR_COPY[code]) ?? "Couldn't get a suggestion. Try again.";
}

/**
 * Exported separately from the hook, mirroring askCloudMutationOptions, so
 * focus.test.ts can wire it into a bare MutationObserver and prove neither a
 * focus regain nor a reconnect ever calls api.suggestFocus on its own.
 * retry: 0 for the identical reason: a retry would silently re-send today's
 * schedule a second time with no second tap.
 */
export function suggestFocusMutationOptions() {
  return {
    mutationFn: (): Promise<FocusSuggestionResponse> => api.suggestFocus({ tz: deviceTimezone() }),
    retry: 0 as const,
  };
}

/**
 * The one model call this feature makes -- synchronous, mirroring
 * useAskCloud: the server runs the call inline and returns the suggestion,
 * not a job handle. Suggested Focus shares Cloud Ask's "ask" task route as
 * its consent switch, so the same two failure classes carry the same
 * consequences (cloud_ask_disabled invalidates the cached "is it on" answer;
 * ask_consent_outdated is remembered for the Settings card) -- reusing
 * handleAskCloudError keeps that state in one place rather than a second
 * copy that could drift.
 */
export function useSuggestFocus() {
  const queryClient = useQueryClient();
  return useMutation({
    ...suggestFocusMutationOptions(),
    onError: (err: unknown) => handleAskCloudError(queryClient, err),
  });
}
