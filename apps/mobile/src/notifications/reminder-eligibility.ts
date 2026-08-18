// Pure, no expo imports -- same reasoning as reconcile.ts and
// resolve-notification-route.ts.
//
// This mirrors the ineligibility conditions in use-reminder-reconciliation.ts,
// which cancels every Personal-OS-owned local alarm when the current device
// is revoked, has notifications disabled, or is not the primary reminder
// device. That behaviour is correct (ADR-019: the primary device is chosen
// explicitly, never auto-promoted), but on its own it is silent.
//
// Checkpoint 5 found the failure mode this exists to surface: rebuilding the
// app wipes SecureStore, which forces a re-pair, which mints a NEW device row
// -- and primary status stays behind on the old, now-dead row. The device the
// user is holding then quietly schedules nothing at all.

export interface ReminderEligibilityInput {
  is_primary_reminder_device: boolean;
  notifications_enabled: boolean;
  revoked_at: string | null;
}

export interface ReminderEligibility {
  willSchedule: boolean;
  // "blocked" = nothing is scheduled at all. "degraded" = reminders are
  // scheduled but Android may deliver them late. They need different
  // wording, because telling someone their reminders are off when they
  // merely drift is as wrong as the reverse.
  kind: "blocked" | "degraded" | null;
  title: string | null;
  warning: string | null;
}

const UNKNOWN: ReminderEligibility = {
  willSchedule: false,
  kind: null,
  title: null,
  warning: null,
};

const BLOCKED_TITLE = "Reminders are not scheduled on this device";

// `exactAlarmCapable` mirrors ExactAlarmStatus.canScheduleExactAlarms().
// Without that permission Android schedules an inexact alarm with a one-hour
// delivery window, which Checkpoint 5 observed directly in `dumpsys alarm`
// (window=+1h0m0s0ms and no exactAllowReason, versus window=0
// exactAllowReason=permission once granted). Defaulting to true keeps web
// and pre-Android-12 callers, where the concept does not exist, silent.
export function describeReminderEligibility(
  device: ReminderEligibilityInput | undefined | null,
  exactAlarmCapable = true,
): ReminderEligibility {
  // Still loading, or this install's row is not in the list yet. Stay quiet
  // rather than flashing a scary banner during a refetch.
  if (!device) return UNKNOWN;

  if (device.revoked_at !== null) {
    return {
      willSchedule: false,
      kind: "blocked",
      title: BLOCKED_TITLE,
      warning: "This device is revoked. Reminders will not fire here.",
    };
  }

  if (!device.notifications_enabled) {
    return {
      willSchedule: false,
      kind: "blocked",
      title: BLOCKED_TITLE,
      warning: "Notifications are disabled for this device. Reminders will not fire here.",
    };
  }

  if (!device.is_primary_reminder_device) {
    return {
      willSchedule: false,
      kind: "blocked",
      title: BLOCKED_TITLE,
      warning:
        "This is not the primary reminder device. Reminders will not fire here — set it as primary below.",
    };
  }

  if (!exactAlarmCapable) {
    return {
      willSchedule: true,
      kind: "degraded",
      title: "Reminders may be delayed",
      warning:
        "Exact alarms are not permitted, so Android may deliver reminders up to an hour late. Grant “Alarms & reminders” to fix this.",
    };
  }

  return { willSchedule: true, kind: null, title: null, warning: null };
}
