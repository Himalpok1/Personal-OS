import { ApiClientError } from "@personal-os/api-client";

// Copy for every closed error code `POST /ask` can return (Checkpoint 8.6B).
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
const ASK_ERROR_COPY: Record<string, string> = {
  cloud_ask_disabled: "Cloud Ask was turned off.",
  no_provider_configured: "The configured AI provider is unavailable right now.",
  no_relevant_context: "Nothing in your notes or tasks matched those words — try different ones.",
  ask_in_flight: "Another Ask is already in progress — try again in a moment.",
  ask_timeout: "The provider didn't respond in time.",
  ask_failed: "The AI provider request failed.",
  validation_failed: "That question is too short or too long.",
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
