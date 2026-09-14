import type { ReminderItem } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  REMINDER_GRACE_MS,
  buildReminderBody,
  diffScheduledReminders,
  missedReminderDisposition,
  reminderNotificationIdentifier,
  toReminderTask,
  toScheduledReminder,
  type ReminderTask,
  type ScheduledReminder,
} from "./reconcile";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const FUTURE = "2026-08-18T09:00:00.000Z";
const PAST = "2026-08-16T09:00:00.000Z";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";

function task(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    key: `task:${TASK_ID}`,
    taskId: TASK_ID,
    occurrenceId: null,
    title: "Call the insurance guy",
    remindAt: FUTURE,
    dueAt: FUTURE,
    recurring: false,
    ...overrides,
  };
}

function occurrence(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    key: `occ:${OCC_ID}`,
    taskId: TASK_ID,
    occurrenceId: OCC_ID,
    title: "Water the plants",
    remindAt: FUTURE,
    dueAt: FUTURE,
    recurring: true,
    ...overrides,
  };
}

function scheduled(overrides: Partial<ScheduledReminder> = {}): ScheduledReminder {
  return {
    key: `task:${TASK_ID}`,
    taskId: TASK_ID,
    occurrenceId: null,
    notificationId: "n1",
    remindAt: FUTURE,
    legacy: false,
    ...overrides,
  };
}

describe("diffScheduledReminders", () => {
  it("schedules an eligible reminder with no existing notification", () => {
    const result = diffScheduledReminders([task()], [], NOW);
    expect(result.toSchedule).toEqual([task()]);
    expect(result.toCancel).toEqual([]);
  });

  it("does not re-schedule a reminder already scheduled for the same remindAt under the same key", () => {
    const result = diffScheduledReminders([task()], [scheduled()], NOW);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual([]);
  });

  it("re-schedules when exact-alarm capability changes", () => {
    const existing = [scheduled({ exactAlarmCapable: false })];
    const result = diffScheduledReminders([task()], existing, NOW, true);
    expect(result.toSchedule).toEqual([task()]);
    expect(result.toCancel).toEqual(existing);
  });

  it("cancels and re-schedules when remindAt changes", () => {
    const existing = [scheduled({ remindAt: PAST })];
    const result = diffScheduledReminders([task({ remindAt: FUTURE })], existing, NOW);
    expect(result.toSchedule).toEqual([task({ remindAt: FUTURE })]);
    expect(result.toCancel).toEqual(existing);
  });

  it("cancels a scheduled reminder whose key is absent from the feed (done, dropped, archived, deleted)", () => {
    // The server no longer lists the item -- whatever the reason, the feed
    // is authoritative and the alarm goes.
    const existing = [scheduled()];
    const result = diffScheduledReminders([], existing, NOW);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual(existing);
  });

  it("does not schedule a reminder whose remindAt is more than an hour in the past", () => {
    const result = diffScheduledReminders([task({ remindAt: PAST })], [], NOW);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual([]);
  });

  it("does not schedule a reminder with an unparseable remindAt", () => {
    const result = diffScheduledReminders([task({ remindAt: "not a date" })], [], NOW);
    expect(result.toSchedule).toEqual([]);
  });

  describe("G2a: the one-hour grace window", () => {
    const FORTY_MINUTES_AGO = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();
    const JUST_OVER_AN_HOUR_AGO = new Date(NOW.getTime() - REMINDER_GRACE_MS - 1).toISOString();
    const EXACTLY_AN_HOUR_AGO = new Date(NOW.getTime() - REMINDER_GRACE_MS).toISOString();

    it("still lists a reminder whose instant passed within the last hour (the scheduler presents a one-off directly -- see missedReminderDisposition)", () => {
      const result = diffScheduledReminders([task({ remindAt: FORTY_MINUTES_AGO })], [], NOW);
      expect(result.toSchedule).toEqual([task({ remindAt: FORTY_MINUTES_AGO })]);
    });

    it("never cancels an existing schedule solely because its instant passed within the last hour", () => {
      const existing = [scheduled({ remindAt: FORTY_MINUTES_AGO })];
      const result = diffScheduledReminders(
        [task({ remindAt: FORTY_MINUTES_AGO })],
        existing,
        NOW,
      );
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual([]);
    });

    it("the cutoff is strict: exactly one hour ago is no longer eligible, one millisecond less is", () => {
      expect(
        diffScheduledReminders([task({ remindAt: EXACTLY_AN_HOUR_AGO })], [], NOW).toSchedule,
      ).toEqual([]);
      expect(
        diffScheduledReminders([task({ remindAt: JUST_OVER_AN_HOUR_AGO })], [], NOW).toSchedule,
      ).toEqual([]);
      const oneMsInside = new Date(NOW.getTime() - REMINDER_GRACE_MS + 1).toISOString();
      expect(
        diffScheduledReminders([task({ remindAt: oneMsInside })], [], NOW).toSchedule,
      ).toHaveLength(1);
    });

    it("an existing schedule whose feed entry aged past the hour is cancelled once the feed drops it", () => {
      // The server applies the same cutoff, so the item leaves the feed;
      // the stale alarm (which would fire immediately on re-schedule) is
      // cancelled through the ordinary absent-key path.
      const existing = [scheduled({ remindAt: JUST_OVER_AN_HOUR_AGO })];
      const result = diffScheduledReminders([], existing, NOW);
      expect(result.toCancel).toEqual(existing);
    });
  });

  it("handles a mixed batch: one new, one unchanged, one stale-cancelled", () => {
    const unchanged = task({ key: "task:t2", taskId: "t2" });
    const fresh = task({ key: "task:t1", taskId: "t1" });
    const existing: ScheduledReminder[] = [
      scheduled({ key: "task:t2", taskId: "t2", notificationId: "n2" }),
      scheduled({ key: "task:t3", taskId: "t3", notificationId: "n3" }),
    ];
    const result = diffScheduledReminders([fresh, unchanged], existing, NOW);
    expect(result.toSchedule).toEqual([fresh]);
    expect(result.toCancel).toEqual([existing[1]]);
  });

  // Checkpoint 9.4: a recurring task yields one feed item PER OCCURRENCE,
  // each with its own `occ:<id>` key, so two instances of one task are two
  // independent alarms -- and both share the parent's taskId.
  describe("per-occurrence reminders (Checkpoint 9.4)", () => {
    const LATER = "2026-08-25T09:00:00.000Z";
    const OCC_2 = "33333333-3333-4333-8333-333333333333";

    it("schedules every occurrence of one task independently, keyed on the occurrence", () => {
      const first = occurrence();
      const second = occurrence({ key: `occ:${OCC_2}`, occurrenceId: OCC_2, remindAt: LATER });
      const result = diffScheduledReminders([first, second], [], NOW);
      expect(result.toSchedule).toEqual([first, second]);
    });

    it("completing one occurrence cancels only its alarm; the next instance's alarm survives", () => {
      const next = occurrence({ key: `occ:${OCC_2}`, occurrenceId: OCC_2, remindAt: LATER });
      const existing: ScheduledReminder[] = [
        scheduled({ key: `occ:${OCC_ID}`, occurrenceId: OCC_ID, notificationId: "done-one" }),
        scheduled({
          key: `occ:${OCC_2}`,
          occurrenceId: OCC_2,
          notificationId: "next-one",
          remindAt: LATER,
        }),
      ];
      const result = diffScheduledReminders([next], existing, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["done-one"]);
    });

    it("a snoozed occurrence (feed remindAt moved) replaces its alarm under the same key", () => {
      const snoozed = occurrence({ remindAt: LATER });
      const existing = [scheduled({ key: `occ:${OCC_ID}`, occurrenceId: OCC_ID })];
      const result = diffScheduledReminders([snoozed], existing, NOW);
      expect(result.toSchedule).toEqual([snoozed]);
      expect(result.toCancel).toEqual(existing);
    });

    it("grouping is by key, never by taskId: a task's one-off alarm and an occurrence alarm do not collide", () => {
      // Should never happen server-side (a task is either one-off or
      // recurring) but the diff must not conflate the two labels.
      const existing = [scheduled({ notificationId: "task-level" })];
      const result = diffScheduledReminders([occurrence()], existing, NOW);
      expect(result.toSchedule).toEqual([occurrence()]);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["task-level"]);
    });
  });

  // Checkpoint 5.4 added `remind_at` to TaskUpdateSchema, so a reminder time
  // can now change through a normal PATCH rather than only via AI capture.
  // These cases drive the exact same key through a full lifecycle of edits,
  // asserting exactly one alarm survives every step -- this is the property
  // the reconciler's exact-string match exists to guarantee, and the property
  // a naive "always reschedule" reconciler would violate by leaking a stale
  // notification on every edit.
  describe("remindAt lifecycle (Checkpoint 5.6)", () => {
    const EARLIER = "2026-08-18T07:00:00.000Z";
    const LATER = "2026-08-18T11:00:00.000Z";

    it("moving remindAt earlier cancels the old alarm and schedules exactly one new one", () => {
      const existing = [scheduled({ notificationId: "original" })];
      const movedEarlier = task({ remindAt: EARLIER });
      const result = diffScheduledReminders([movedEarlier], existing, NOW);
      expect(result.toSchedule).toEqual([movedEarlier]);
      expect(result.toCancel).toEqual(existing);
      const settled = diffScheduledReminders(
        [movedEarlier],
        [scheduled({ notificationId: "new", remindAt: EARLIER })],
        NOW,
      );
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });

    it("moving remindAt later cancels the old alarm and schedules exactly one new one", () => {
      const existing = [scheduled({ notificationId: "original" })];
      const movedLater = task({ remindAt: LATER });
      const result = diffScheduledReminders([movedLater], existing, NOW);
      expect(result.toSchedule).toEqual([movedLater]);
      expect(result.toCancel).toEqual(existing);
      const settled = diffScheduledReminders(
        [movedLater],
        [scheduled({ notificationId: "new", remindAt: LATER })],
        NOW,
      );
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });

    it("an unrelated field change with byte-identical remindAt preserves the existing alarm", () => {
      const existing = [scheduled({ notificationId: "original" })];
      // Only the title changed -- remindAt is the exact same string (not
      // merely an equivalent instant). If the reconciler rescheduled on
      // every pass regardless, this would churn a fresh alarm every ~60s
      // poll / foreground event.
      const retitled = task({ title: "Call the insurance guy (updated)" });
      const result = diffScheduledReminders([retitled], existing, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual([]);
    });

    it("collapses several duplicate scheduled notifications for one key to exactly one, cancelling only the owned extras", () => {
      const otherTask = task({ key: "task:t2", taskId: "t2" });
      const existing: ScheduledReminder[] = [
        scheduled({ notificationId: "dup-1" }),
        scheduled({ notificationId: "dup-2" }),
        scheduled({ notificationId: "dup-3" }),
        scheduled({ key: "task:t2", taskId: "t2", notificationId: "still-valid" }),
      ];
      const result = diffScheduledReminders([task(), otherTask], existing, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toHaveLength(2);
      expect(result.toCancel.every((entry) => entry.key === `task:${TASK_ID}`)).toBe(true);
      expect(result.toCancel.map((entry) => entry.notificationId).sort()).toEqual([
        "dup-2",
        "dup-3",
      ]);
    });

    it("exact-alarm capability flipping granted -> revoked -> granted forces replacement each time", () => {
      const grantedSchedule = [scheduled({ notificationId: "exact", exactAlarmCapable: true })];
      const revoked = diffScheduledReminders([task()], grantedSchedule, NOW, false);
      expect(revoked.toSchedule).toEqual([task()]);
      expect(revoked.toCancel).toEqual(grantedSchedule);

      const inexactSchedule = [scheduled({ notificationId: "inexact", exactAlarmCapable: false })];
      const reGranted = diffScheduledReminders([task()], inexactSchedule, NOW, true);
      expect(reGranted.toSchedule).toEqual([task()]);
      expect(reGranted.toCancel).toEqual(inexactSchedule);

      const exactSchedule = [scheduled({ notificationId: "exact-2", exactAlarmCapable: true })];
      const settled = diffScheduledReminders([task()], exactSchedule, NOW, true);
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });
  });
});

describe("toScheduledReminder (reading the store back)", () => {
  it("reads the 9.4 payload shape", () => {
    expect(
      toScheduledReminder("n1", {
        key: `occ:${OCC_ID}`,
        taskId: TASK_ID,
        occurrenceId: OCC_ID,
        remindAt: FUTURE,
        exactAlarmCapable: true,
      }),
    ).toEqual({
      key: `occ:${OCC_ID}`,
      taskId: TASK_ID,
      occurrenceId: OCC_ID,
      notificationId: "n1",
      remindAt: FUTURE,
      exactAlarmCapable: true,
      legacy: false,
    });
  });

  it("reads a legacy (pre-9.4) `{ taskId, remindAt }` payload as an owned one-off reminder keyed task:<taskId>, flagged legacy", () => {
    expect(toScheduledReminder("legacy", { taskId: TASK_ID, remindAt: FUTURE })).toEqual({
      key: `task:${TASK_ID}`,
      taskId: TASK_ID,
      occurrenceId: null,
      notificationId: "legacy",
      remindAt: FUTURE,
      exactAlarmCapable: undefined,
      legacy: true,
    });
    // An empty key is no key.
    expect(toScheduledReminder("legacy", { key: "", taskId: TASK_ID, remindAt: FUTURE })).toMatchObject(
      { legacy: true },
    );
  });

  it("returns null for a foreign notification", () => {
    expect(toScheduledReminder("x", { source: "another-app" })).toBeNull();
    expect(toScheduledReminder("x", undefined)).toBeNull();
    expect(toScheduledReminder("x", { captureShortcut: true })).toBeNull();
  });

  describe("legacy entries armed by the previous APK", () => {
    it("an unchanged one-off reminder is NOT retained: the legacy alarm has no action category, so it is cancelled and re-scheduled with one", () => {
      const legacy = toScheduledReminder("legacy", { taskId: TASK_ID, remindAt: FUTURE });
      const result = diffScheduledReminders([task()], [legacy!], NOW);
      expect(result.toSchedule).toEqual([task()]);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["legacy"]);
    });

    it("...and exactly once: the replacement carries a key, so the next pass retains it", () => {
      const replacement = toScheduledReminder("reminder:task", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
      });
      const result = diffScheduledReminders([task()], [replacement!], NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual([]);
    });

    it("a legacy entry beside a current one for the same key: the current one is retained, the legacy one cancelled", () => {
      const legacy = toScheduledReminder("legacy", { taskId: TASK_ID, remindAt: FUTURE })!;
      const current = scheduled({ notificationId: "current" });
      const result = diffScheduledReminders([task()], [legacy, current], NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["legacy"]);
    });

    it("a recurring task's legacy parent-level alarm is CANCELLED and its occurrence alarm scheduled", () => {
      // Pre-9.4 the parent task's remind_at was scheduled once under its
      // task id; the 9.4 feed lists the same task only through `occ:` keys.
      const legacy = toScheduledReminder("legacy", { taskId: TASK_ID, remindAt: FUTURE });
      const result = diffScheduledReminders([occurrence()], [legacy!], NOW);
      expect(result.toSchedule).toEqual([occurrence()]);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["legacy"]);
    });

    it("a legacy alarm for a task no longer in the feed is cancelled", () => {
      const legacy = toScheduledReminder("legacy", { taskId: TASK_ID, remindAt: FUTURE });
      const result = diffScheduledReminders([], [legacy!], NOW);
      expect(result.toCancel.map((entry) => entry.notificationId)).toEqual(["legacy"]);
    });
  });
});

describe("missedReminderDisposition (Checkpoint 9.4)", () => {
  const FORTY_MINUTES_AGO = new Date(NOW.getTime() - 40 * 60 * 1000).toISOString();

  it("a future instant is an ordinary DATE trigger, for one-offs and occurrences alike", () => {
    expect(missedReminderDisposition(task(), NOW)).toBe("date");
    expect(missedReminderDisposition(occurrence(), NOW)).toBe("date");
    expect(missedReminderDisposition(task({ remindAt: NOW.toISOString() }), NOW)).toBe("date");
  });

  it("a missed ONE-OFF is presented now (a past DATE trigger would be removed by expo-notifications, not fired)", () => {
    expect(missedReminderDisposition(task({ remindAt: FORTY_MINUTES_AGO }), NOW)).toBe(
      "present_now",
    );
  });

  it("a missed OCCURRENCE is dropped -- a freshly generated successor must never ring the moment it exists", () => {
    expect(missedReminderDisposition(occurrence({ remindAt: FORTY_MINUTES_AGO }), NOW)).toBe(
      "drop",
    );
  });

  it("an unparseable instant is left to the DATE path (which the eligibility filter already excludes)", () => {
    expect(missedReminderDisposition(task({ remindAt: "never" }), NOW)).toBe("date");
  });
});

describe("reminderNotificationIdentifier", () => {
  it("is deterministic in the key and the instant", () => {
    expect(reminderNotificationIdentifier(task())).toBe(`reminder:task:${TASK_ID}:${FUTURE}`);
    expect(reminderNotificationIdentifier(occurrence())).toBe(
      `reminder:occ:${OCC_ID}:${FUTURE}`,
    );
    expect(reminderNotificationIdentifier(task())).toBe(reminderNotificationIdentifier(task()));
  });

  it("changes when the instant moves, so a snoozed reminder is a different notification", () => {
    expect(reminderNotificationIdentifier(task({ remindAt: PAST }))).not.toBe(
      reminderNotificationIdentifier(task()),
    );
  });
});

describe("toReminderTask", () => {
  it("projects the wire item, dropping the timezone (the notification formats in the device zone)", () => {
    const item: ReminderItem = {
      key: `occ:${OCC_ID}`,
      task_id: TASK_ID,
      occurrence_id: OCC_ID,
      title: "Water the plants",
      remind_at: FUTURE,
      due_at: FUTURE,
      timezone: "America/Chicago",
      recurring: true,
    };
    expect(toReminderTask(item)).toEqual(occurrence());
  });
});

describe("buildReminderBody", () => {
  it("is 'Reminder' when there is no due instant", () => {
    expect(buildReminderBody({ dueAt: null, remindAt: FUTURE, recurring: false })).toBe(
      "Reminder",
    );
    expect(buildReminderBody({ dueAt: null, remindAt: FUTURE, recurring: true })).toBe(
      "Reminder · repeats",
    );
  });

  it("formats the due time and appends the repeat marker for a recurring item", () => {
    const body = buildReminderBody({ dueAt: FUTURE, remindAt: FUTURE, recurring: false });
    expect(body).toMatch(/^Due \d{1,2}:\d{2}/);
    expect(body).not.toContain("repeats");
    expect(buildReminderBody({ dueAt: FUTURE, remindAt: FUTURE, recurring: true })).toMatch(
      /^Due \d{1,2}:\d{2}.* · repeats$/,
    );
  });

  it("adds the weekday when the due date is on a different local day than the reminder", () => {
    const dayBefore = "2026-08-17T09:00:00.000Z";
    const body = buildReminderBody({ dueAt: FUTURE, remindAt: dayBefore, recurring: false });
    expect(body).toMatch(/^Due [A-Z][a-z]{2} \d{1,2}:\d{2}/);
  });

  it("never carries anything but the due time and the repeat marker", () => {
    // The input has no field for a body/notes at all -- the shape is closed
    // -- so this pins that no other property influences the string.
    const body = buildReminderBody({ dueAt: FUTURE, remindAt: FUTURE, recurring: false });
    expect(body.length).toBeLessThan(30);
  });
});
