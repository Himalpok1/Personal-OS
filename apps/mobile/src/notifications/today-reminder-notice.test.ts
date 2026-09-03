import { describe, expect, it } from "vitest";
import { todayReminderNotice } from "./today-reminder-notice";

const eligible = {
  is_primary_reminder_device: true,
  notifications_enabled: true,
  revoked_at: null,
};

// Checkpoint 8.4 Lane 6. Today must say something ONLY when something is
// wrong, and must never fix it itself.
describe("todayReminderNotice", () => {
  it("says nothing when reminders will fire", () => {
    expect(todayReminderNotice(eligible, true)).toBeNull();
  });

  it("says nothing while the device row is still loading", () => {
    // A refetch must not flash a scary banner.
    expect(todayReminderNotice(undefined, true)).toBeNull();
    expect(todayReminderNotice(null, true)).toBeNull();
  });

  it("names the stranded-primary case and points at Settings", () => {
    // The failure this exists for: a re-pair mints a new device row and
    // primary stays behind on the old one, so nothing is scheduled at all.
    const notice = todayReminderNotice({ ...eligible, is_primary_reminder_device: false }, true);
    expect(notice).not.toBeNull();
    expect(notice!.action).toBe("settings");
    expect(notice!.body).toMatch(/primary/i);
  });

  it("names a revoked device and a notifications-disabled device", () => {
    expect(todayReminderNotice({ ...eligible, revoked_at: "2026-09-01T00:00:00Z" }, true)?.action).toBe(
      "settings",
    );
    expect(todayReminderNotice({ ...eligible, notifications_enabled: false }, true)?.action).toBe(
      "settings",
    );
  });

  it("routes the exact-alarm case to the system deep link, not to Settings", () => {
    // Distinct from the blocked cases: reminders ARE scheduled, just late.
    // Telling someone their reminders are off when they merely drift is as
    // wrong as the reverse.
    const notice = todayReminderNotice(eligible, false);
    expect(notice).not.toBeNull();
    expect(notice!.action).toBe("exact-alarm");
    expect(notice!.title).toMatch(/delayed/i);
  });

  it("defaults exact-alarm capability to true, keeping web and pre-Android-12 silent", () => {
    expect(todayReminderNotice(eligible)).toBeNull();
  });

  it("always returns non-empty copy when it returns anything at all", () => {
    for (const device of [
      { ...eligible, is_primary_reminder_device: false },
      { ...eligible, notifications_enabled: false },
      { ...eligible, revoked_at: "2026-09-01T00:00:00Z" },
    ]) {
      const notice = todayReminderNotice(device, true);
      expect(notice!.title.length).toBeGreaterThan(0);
      expect(notice!.body.length).toBeGreaterThan(0);
    }
  });
});
