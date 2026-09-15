import { ApiClientError } from "@personal-os/api-client";

// Copy for every closed error code `POST /ask` can return (Checkpoint 8.6B;
// two rows added by 9.7, "Ask about today").
// Keyed on the code alone, same convention as
// `components/inbox/confirm-state.ts`'s CONFIRM_ERROR_COPY: the route returns
// no free-text reason on any of these, so there is nothing to accidentally
// echo, and no raw error text ever needs to reach the screen.
//
// `ask_timeout` is worded carefully, and deliberately differs from every
// other entry here: unlike a request that never left the device, a timeout
// means a request WAS SENT -- the question and the matching note/task text
// already reached the provider -- so the copy must never imply nothing
// happened.
//
// `ask_uncited` (9.7) is the same situation as a timeout in that respect: the
// request was sent AND answered, but the answer named a `[n]` that matches no
// source, so the server discarded it rather than hand back an answer whose
// citations cannot be opened. `ask_consent_outdated` (9.7) means the "ask"
// row predates the current disclosure; the Settings card carries the
// re-enable path. `no_relevant_context` is kept for the 8.6B request shape.
//
// `validation_failed` is ALSO what a pre-9.7 server returns to every 9.7
// request, because its `.strict()` request schema rejects the `tz` key the
// client now always sends -- so the copy names both possibilities and
// blames neither. Fixed text; the server's own message is never shown.
const ASK_ERROR_COPY: Record<string, string> = {
  cloud_ask_disabled: "Cloud Ask was turned off.",
  no_provider_configured: "The configured AI provider is unavailable right now.",
  no_relevant_context: "Nothing in your notes or tasks matched those words — try different ones.",
  ask_in_flight: "Another Ask is already in progress — try again in a moment.",
  ask_timeout: "The provider didn't respond in time.",
  ask_failed: "The AI provider request failed.",
  validation_failed: "That question couldn't be sent. Check its length, or update the server.",
  ask_uncited:
    "The answer referred to something that isn't in your data, so it was discarded. Try again.",
  ask_consent_outdated: "Cloud Ask's scope changed. Re-enable it in Settings to continue.",
};

/** Never returns an empty string, and never echoes provider or server text. */
export function askErrorMessage(error: unknown): string {
  const code = error instanceof ApiClientError ? error.code : undefined;
  return (code && ASK_ERROR_COPY[code]) ?? "Couldn't complete that Ask.";
}

/**
 * True when the server says Cloud Ask itself was turned off -- the one
 * failure that means a cached "is it enabled" answer is now stale and worth
 * refetching, rather than just a failed attempt to retry as-is.
 */
export function isCloudAskDisabledError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "cloud_ask_disabled";
}

/**
 * True when the server refused the question because the "ask" route was
 * consented under an older disclosure (Checkpoint 9.7). The screen shows the
 * mapped copy; `useAskCloud` remembers it so the Settings card can offer the
 * re-enable path.
 */
export function isAskConsentOutdatedError(error: unknown): boolean {
  return error instanceof ApiClientError && error.code === "ask_consent_outdated";
}
