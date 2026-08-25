import type { CalendarSyncErrorCode } from "@personal-os/schema";

/**
 * User-facing copy for a calendar connection's last sync failure.
 *
 * The API now sends a code from a closed vocabulary rather than a message
 * (see `packages/schema/src/calendar-sync-errors.ts`), so this map is the ONLY
 * place calendar sync failures acquire words. Interpolating anything the server
 * sent is what produced the defect this replaces: Settings used to render
 * `last_sync_error` verbatim, and that column held Google's own
 * `error_description` prose.
 *
 * This mirrors `HEALTH_STATUS_TEXT` in settings.tsx, which has followed the
 * same discipline since Checkpoint 6.4.
 *
 * Every sentence says what the user can DO, or explicitly says that nothing is
 * required of them. "Personal OS will retry" is not filler: without it a
 * transient failure reads as something the user must act on.
 */
const COPY: Record<CalendarSyncErrorCode, string> = {
  auth_expired: "The connection expired. Reconnect it to resume syncing.",
  auth_failed: "The saved credentials were rejected. Reconnect to resume syncing.",
  missing_scope: "Calendar permission is missing. Reconnect and allow calendar access.",
  rate_limited: "The calendar provider is rate-limiting Personal OS. It will retry on its own.",
  provider_unavailable: "The calendar provider was unavailable. Personal OS will retry on its own.",
  network_error: "The calendar provider couldn't be reached. Personal OS will retry on its own.",
  not_found: "The remote calendar or event no longer exists.",
  conflict: "The same item changed in both places. Personal OS will reconcile it on the next sync.",
  // Ours to fix, not the user's -- so it deliberately does not ask them to do
  // anything, and deliberately does not show them the request.
  invalid_request: "Personal OS sent a request this calendar provider rejected.",
  connection_inactive: "This connection isn't active, so syncing is paused.",
  retries_exhausted: "Syncing didn't finish after several attempts. It will try again later.",
  provider_error: "A recent sync didn't finish. Personal OS will try again on its own.",
};

/**
 * Returns a safe sentence for a sync-error code, or null when there is nothing
 * to report.
 *
 * Falls back to the `provider_error` sentence for a code this build does not
 * recognise, so a server that gains a new code before the app is rebuilt still
 * renders words rather than a raw token.
 */
export function calendarSyncErrorCopy(code: CalendarSyncErrorCode | null | undefined): string | null {
  if (code === null || code === undefined) return null;
  return COPY[code] ?? COPY.provider_error;
}
