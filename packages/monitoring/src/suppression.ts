import { isWithinQuietHours } from "@personal-os/core";

// Whether a target should be probed at all right now.
//
// PURE: no database, no clock of its own, no network. Everything it needs is an
// argument, so every branch is testable without a fixture.
//
// ===========================================================================
// WHY THIS REUSES isWithinQuietHours RATHER THAN COMPUTING A WINDOW ITSELF
// ===========================================================================
//
// `devices.quiet_hours_start/_end/_timezone` already models "a recurring daily
// local window", and `packages/core/src/quiet-hours.ts` already answers "is now
// inside it" -- including the overnight-wraparound case (22:00 to 06:00), which
// is the half everyone gets wrong, and doing so through `toWallClockComponents`
// so it is DST-safe rather than accidentally correct.
//
// `monitor_targets` deliberately uses the SAME three-column shape so it can call
// the SAME function. A second implementation of local-window arithmetic would be
// a second chance to get DST wrong, in a component whose entire job is to be
// trusted about whether something is broken.

/** Why a check was not performed. Null means it should be. */
export type SuppressionReason = "disabled" | "muted" | "maintenance_window";

export interface SuppressionInput {
  enabled: boolean;
  /** Ad-hoc suppression, typically a deploy. */
  mutedUntil: Date | null;
  /** Recurring daily window. All three are null together (a database CHECK). */
  maintenanceStart: string | null;
  maintenanceEnd: string | null;
  maintenanceTimezone: string | null;
}

/**
 * Returns why a target must not be probed now, or null to go ahead.
 *
 * The three reasons are ORDERED from most deliberate to most incidental, and the
 * order is what the caller records -- a target that is both disabled and inside
 * its maintenance window is `disabled`, because that is the fact an operator
 * needs to see first.
 *
 * A malformed or partial maintenance window is treated as NO WINDOW rather than
 * as a permanent suppression. The database CHECK makes a partial triple
 * unrepresentable, so reaching that branch means a row was built in a test or by
 * a future writer -- and the safe failure is to keep monitoring, never to
 * silently stop.
 */
export function suppressionReason(
  input: SuppressionInput,
  now: Date = new Date(),
): SuppressionReason | null {
  if (!input.enabled) return "disabled";
  if (input.mutedUntil !== null && input.mutedUntil.getTime() > now.getTime()) return "muted";

  const { maintenanceStart, maintenanceEnd, maintenanceTimezone } = input;
  if (
    maintenanceStart !== null &&
    maintenanceEnd !== null &&
    maintenanceTimezone !== null &&
    isWithinQuietHours(now, maintenanceStart, maintenanceEnd, maintenanceTimezone)
  ) {
    return "maintenance_window";
  }

  return null;
}

/**
 * Whether enough time has passed since the last check to run another.
 *
 * A separate question from suppression, and deliberately lenient: a target whose
 * interval has ALMOST elapsed is checked rather than skipped, because a cron
 * tick that lands a second early would otherwise defer a five-minute check by a
 * whole tick every time, and the intervals would drift apart from what the
 * operator configured.
 */
export function isDueForCheck(
  lastCheckedAt: Date | null,
  intervalSeconds: number,
  now: Date = new Date(),
  toleranceMs = 1000,
): boolean {
  if (lastCheckedAt === null) return true;
  return now.getTime() - lastCheckedAt.getTime() + toleranceMs >= intervalSeconds * 1000;
}
