import { describe, expect, it } from "vitest";
import { describeReminderEligibility } from "./reminder-eligibility";

const eligible = {
  is_primary_reminder_device: true,
  notifications_enabled: true,
  revoked_at: null,
};

describe("describeReminderEligibility", () => {
  it("is silent when the device will actually schedule reminders", () => {
    expect(describeReminderEligibility(eligible)).toEqual({
      willSchedule: true,
      kind: null,
      title: null,
      warning: null,
    });
  });

  // The Checkpoint 5 finding: re-pairing after a rebuild mints a new device
  // row and leaves primary status on the old one, so the live device
  // schedules nothing while showing no indication of it.
  it("warns when this device is not the primary reminder device", () => {
    const result = describeReminderEligibility({
      ...eligible,
      is_primary_reminder_device: false,
    });
    expect(result.willSchedule).toBe(false);
    expect(result.kind).toBe("blocked");
    expect(result.warning).toContain("not the primary reminder device");
  });

  it("warns when notifications are disabled for this device", () => {
    const result = describeReminderEligibility({ ...eligible, notifications_enabled: false });
    expect(result.willSchedule).toBe(false);
    expect(result.warning).toContain("Notifications are disabled");
  });

  it("warns when this device is revoked", () => {
    const result = describeReminderEligibility({
      ...eligible,
      revoked_at: "2026-08-18T00:00:00Z",
    });
    expect(result.willSchedule).toBe(false);
    expect(result.warning).toContain("revoked");
  });

  it("reports revocation ahead of the other reasons", () => {
    const result = describeReminderEligibility({
      is_primary_reminder_device: false,
      notifications_enabled: false,
      revoked_at: "2026-08-18T00:00:00Z",
    });
    expect(result.warning).toContain("revoked");
  });

  // A refetch must not flash a warning for a device whose row simply is not
  // loaded yet.
  it("stays quiet, and claims nothing, while the device row is unknown", () => {
    for (const value of [undefined, null]) {
      expect(describeReminderEligibility(value)).toEqual({
        willSchedule: false,
        kind: null,
        title: null,
        warning: null,
      });
    }
  });

  // Checkpoint 5 finding: targetSdk 36 means Android does not auto-grant
  // SCHEDULE_EXACT_ALARM, so a fresh install schedules alarms with a
  // one-hour window until the user grants "Alarms & reminders".
  it("reports a delay risk, not a blockage, when exact alarms are unavailable", () => {
    const result = describeReminderEligibility(eligible, false);
    expect(result.willSchedule).toBe(true);
    expect(result.kind).toBe("degraded");
    expect(result.warning).toContain("up to an hour late");
  });

  it("treats exact alarms as available by default, for web and pre-Android-12", () => {
    expect(describeReminderEligibility(eligible).kind).toBeNull();
    expect(describeReminderEligibility(eligible, true).kind).toBeNull();
  });

  // A blocked device schedules nothing at all, so the exact-alarm window is
  // irrelevant -- reporting it would bury the reason reminders are off.
  it("reports a blocking reason ahead of the exact-alarm delay risk", () => {
    const result = describeReminderEligibility(
      { ...eligible, is_primary_reminder_device: false },
      false,
    );
    expect(result.kind).toBe("blocked");
    expect(result.warning).toContain("not the primary reminder device");
  });
});
