import type { MailSyncErrorCode } from "@personal-os/schema";

/**
 * User-facing copy for a mailbox's last sync failure.
 *
 * Direct sibling of `calendar/sync-error-copy.ts`, and it exists for the same
 * recorded reason: the API sends a CODE from a closed vocabulary rather than a
 * message, so this map is the ONLY place a mail sync failure acquires words.
 * Interpolating what the server sent is what produced the defect the calendar
 * version replaces -- Settings rendered `last_sync_error` verbatim, and that
 * column held Google's own `error_description` prose.
 *
 * Mail needs its own map rather than reusing calendar's because the two
 * vocabularies genuinely differ: calendar has `conflict` (an ETag precondition
 * failure) with no mail analogue, and mail has `cursor_expired` with no calendar
 * analogue.
 *
 * Every sentence says what the user can DO, or explicitly says nothing is
 * required of them. "Personal OS will retry" is not filler -- without it a
 * transient failure reads as a chore.
 */
const COPY: Record<MailSyncErrorCode, string> = {
  auth_expired: "The mailbox connection expired. Reconnect it to resume syncing.",
  auth_failed: "The saved credentials were rejected. Reconnect to resume syncing.",
  missing_scope: "Mail permission is missing. Reconnect and allow Personal OS to read mail metadata.",
  rate_limited: "Gmail is rate-limiting Personal OS. It will retry on its own.",
  provider_unavailable: "Gmail was unavailable. Personal OS will retry on its own.",
  network_error: "Gmail couldn't be reached. Personal OS will retry on its own.",
  // Recovery is automatic and bounded (ADR-053): the engine detects the 404,
  // runs a full pass and mints a new cursor. Naming it as something the user
  // must fix would be false, and naming it "an error" without saying it
  // self-heals invites a reconnect that would not help.
  cursor_expired: "Gmail's change history moved on, so Personal OS is catching up from scratch.",
  not_found: "A message or label Personal OS was tracking no longer exists.",
  // Ours to fix, not the user's -- so it deliberately does not ask them to do
  // anything, and deliberately does not show them the request.
  invalid_request: "Personal OS sent a request Gmail rejected.",
  connection_inactive: "This mailbox isn't active, so syncing is paused.",
  retries_exhausted: "Syncing didn't finish after several attempts. It will try again later.",
  provider_error: "A recent sync didn't finish. Personal OS will try again on its own.",
};

/**
 * A safe sentence for a mail sync-error code, or null when there is nothing to
 * report.
 *
 * NULL AND `provider_error` ARE DIFFERENT ANSWERS and this function keeps them
 * apart: null means "no error", `provider_error` means "an error we cannot
 * name". `sanitizeMailSyncErrorCode` makes the same distinction on the server,
 * and collapsing them here would throw it away at the last step.
 *
 * An unrecognised code falls back to the `provider_error` sentence, so a server
 * that gains a code before the app is rebuilt still renders words rather than a
 * raw token.
 */
export function mailSyncErrorCopy(code: MailSyncErrorCode | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return COPY[code] ?? COPY.provider_error;
}
