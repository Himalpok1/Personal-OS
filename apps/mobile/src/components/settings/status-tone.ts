// Chip tones for the Settings integration cards (Checkpoint 10.3).
//
// Pure, so the mapping can be pinned without rendering. Each function is the
// chip-tone form of the `*StatusToneClass` helper Settings used to spell as
// text colours, and follows those helpers' own semantics rather than a
// generic "error is red" rule:
//
//   * `unavailable` -- Personal OS's own API could not be reached -- is the
//     ONE red state. It is the only one where the app itself is failing.
//   * `needs_reconnect` and a failed sync (`error`) are amber: degraded but
//     live, and the copy beside the chip already says what happens next.
//   * `connected` is green. Nothing else is: "not configured", "not
//     connected" and "disconnected" describe an absence, not a fault.
import type { CalendarConnectionStatus } from "@personal-os/schema";
import type { CanvasConnectionDisplayState } from "@/components/canvas/connection-state";
import type { MailConnectionDisplayState } from "@/components/mail/connection-state";
import type { ChipTone } from "@/components/ui";

export { healthConnectionChipTone } from "@/components/health/connection-tone";

export function mailConnectionChipTone(state: MailConnectionDisplayState): ChipTone {
  switch (state) {
    case "unavailable":
      return "danger";
    case "needs_reconnect":
    case "error":
      return "warning";
    case "connected":
      return "success";
    case "not_configured":
    case "not_connected":
    case "disconnected":
      return "neutral";
  }
}

export function canvasConnectionChipTone(state: CanvasConnectionDisplayState): ChipTone {
  switch (state) {
    case "unavailable":
      return "danger";
    case "needs_reconnect":
    case "error":
      return "warning";
    case "connected":
      return "success";
    case "not_configured":
    case "not_connected":
    case "disconnected":
      return "neutral";
  }
}

/**
 * Calendar connections carry the wire status directly (there is no display
 * state module for them): `active` is the live state, `needs_reauth` and
 * `revoked` both mean syncing has stopped until the owner reconnects.
 */
export function calendarConnectionChipTone(status: CalendarConnectionStatus): ChipTone {
  switch (status) {
    case "active":
      return "success";
    case "needs_reauth":
    case "revoked":
      return "warning";
    case "disconnected":
      return "neutral";
  }
}

/** The one word a calendar connection's chip shows for each wire status. */
export function calendarConnectionChipLabel(status: CalendarConnectionStatus): string {
  switch (status) {
    case "active":
      return "connected";
    case "needs_reauth":
      return "reconnect needed";
    case "revoked":
      return "revoked";
    case "disconnected":
      return "disconnected";
  }
}

/**
 * The monitoring summary line's tone: red when the API is unreachable or an
 * incident is open, default otherwise (the same rule the card spelled inline).
 */
export function monitorSummaryTone(
  isLoadError: boolean,
  activeIncidentCount: number,
): "danger" | "default" {
  return isLoadError || activeIncidentCount > 0 ? "danger" : "default";
}
