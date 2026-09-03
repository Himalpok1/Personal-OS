import { ApiClientError } from "@personal-os/api-client";
import { isCommittableToolCall, readStoredParseResult, type InboxItem } from "@personal-os/schema";

/**
 * Whether "Confirm as parsed" can possibly succeed for this item.
 *
 * Checkpoint 8.4: an `unclear` parse result is a real parser outcome with no
 * entity to create, so confirming one could only ever fail. The app offered
 * the button anyway, the API returned 202, and the job threw on all five
 * attempts -- leaving the user with a button that returned to its idle label
 * and no other feedback at all. Two production items failed exactly this way.
 */
export function canConfirmInboxItem(item: InboxItem): boolean {
  if (item.status !== "needs_confirm") return false;
  const stored = readStoredParseResult(item.parse_result);
  return stored !== null && isCommittableToolCall(stored.toolCall);
}

/**
 * Copy for every refusal POST /inbox/:id/confirm can return. Keyed on the
 * closed `error` code, never on a message: the API deliberately returns no
 * prose, because the `unclear` tool's own `reason` argument is derived from
 * the capture text.
 */
const CONFIRM_ERROR_COPY: Record<string, string> = {
  parse_result_not_committable: "The parser couldn't classify this, so there's nothing to file yet.",
  parse_result_unreadable: "This capture's parse result can't be read.",
  not_awaiting_confirmation: "This capture is no longer awaiting confirmation.",
  job_queue_unavailable: "The job queue is offline. Try again shortly.",
  not_found: "This capture no longer exists.",
};

/** Never returns an empty string: before 8.4 the mutation had no error path at all. */
export function confirmErrorMessage(error: unknown): string {
  const code = error instanceof ApiClientError ? error.code : undefined;
  return (code && CONFIRM_ERROR_COPY[code]) ?? "Couldn't confirm this capture.";
}
