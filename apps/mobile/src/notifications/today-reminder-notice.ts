import {
  describeReminderEligibility,
  type ReminderEligibilityInput,
} from "@/notifications/reminder-eligibility";

/**
 * The Today screen's view of whether reminders can actually fire here.
 *
 * Checkpoint 8.4 Lane 6. `describeReminderEligibility` has existed since
 * Checkpoint 5 but is rendered ONLY on the Settings screen -- so the one
 * failure it was written to surface (a re-pair mints a new device row and
 * leaves primary status stranded on the old one, after which the device in
 * the owner's hand schedules nothing at all) is invisible unless they happen
 * to open Settings. 8.4 makes the Rabbit the primary capture device and adds
 * reminders at creation time, which makes silence here much more expensive.
 *
 * INFORMATIONAL ONLY. This never promotes a device, never changes primary,
 * and never enables a notification setting -- ADR-019 and ADR-036 stand:
 * eligibility is surfaced, never auto-corrected.
 *
 * Returns null when everything is fine, which is the common case. Today is
 * not a diagnostics dashboard; it says something only when something is
 * wrong.
 */
export interface TodayReminderNotice {
  title: string;
  body: string;
  /** Which affordance resolves it. Exact-alarm has a system deep link; the rest are Settings. */
  action: "settings" | "exact-alarm";
}

export function todayReminderNotice(
  device: ReminderEligibilityInput | undefined | null,
  exactAlarmCapable = true,
): TodayReminderNotice | null {
  const { kind, title, warning } = describeReminderEligibility(device, exactAlarmCapable);
  if (kind === null || title === null || warning === null) return null;
  return { title, body: warning, action: kind === "degraded" ? "exact-alarm" : "settings" };
}
