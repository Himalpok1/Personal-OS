import { describe, expect, it } from "vitest";
import { diffScheduledReminders, type ReminderTask, type ScheduledReminder } from "./reconcile";

const NOW = new Date("2026-08-17T12:00:00.000Z");
const FUTURE = "2026-08-18T09:00:00.000Z";
const PAST = "2026-08-16T09:00:00.000Z";

function task(overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    id: "task-1",
    title: "Call the insurance guy",
    remind_at: FUTURE,
    status: "active",
    archived_at: null,
    ...overrides,
  };
}

describe("diffScheduledReminders", () => {
  it("schedules an eligible task with no existing notification", () => {
    const result = diffScheduledReminders([task()], [], NOW);
    expect(result.toSchedule).toEqual([task()]);
    expect(result.toCancel).toEqual([]);
  });

  it("does not re-schedule a task already scheduled for the same remind_at", () => {
    const scheduled: ScheduledReminder[] = [
      { taskId: "task-1", notificationId: "n1", remindAt: FUTURE },
    ];
    const result = diffScheduledReminders([task()], scheduled, NOW);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual([]);
  });

  it("re-schedules when exact-alarm capability changes", () => {
    const scheduled: ScheduledReminder[] = [
      {
        taskId: "task-1",
        notificationId: "n1",
        remindAt: FUTURE,
        exactAlarmCapable: false,
      },
    ];
    const result = diffScheduledReminders([task()], scheduled, NOW, true);
    expect(result.toSchedule).toEqual([task()]);
    expect(result.toCancel).toEqual(scheduled);
  });

  it("cancels and re-schedules when remind_at changes", () => {
    const scheduled: ScheduledReminder[] = [
      { taskId: "task-1", notificationId: "n1", remindAt: PAST },
    ];
    const result = diffScheduledReminders([task({ remind_at: FUTURE })], scheduled, NOW);
    expect(result.toSchedule).toEqual([task({ remind_at: FUTURE })]);
    expect(result.toCancel).toEqual(scheduled);
  });

  it.each([["done"], ["dropped"]] as const)(
    "cancels a scheduled reminder when the task becomes %s",
    (status) => {
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "n1", remindAt: FUTURE },
      ];
      const result = diffScheduledReminders([task({ status })], scheduled, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual(scheduled);
    },
  );

  it("cancels a scheduled reminder when the task is archived", () => {
    const scheduled: ScheduledReminder[] = [
      { taskId: "task-1", notificationId: "n1", remindAt: FUTURE },
    ];
    const result = diffScheduledReminders(
      [task({ archived_at: "2026-08-17T00:00:00.000Z" })],
      scheduled,
      NOW,
    );
    expect(result.toCancel).toEqual(scheduled);
  });

  it("cancels a scheduled reminder when the task is deleted from the active set entirely", () => {
    const scheduled: ScheduledReminder[] = [
      { taskId: "task-1", notificationId: "n1", remindAt: FUTURE },
    ];
    const result = diffScheduledReminders([], scheduled, NOW);
    expect(result.toCancel).toEqual(scheduled);
  });

  it("does not schedule a task whose remind_at is in the past", () => {
    const result = diffScheduledReminders([task({ remind_at: PAST })], [], NOW);
    expect(result.toSchedule).toEqual([]);
    expect(result.toCancel).toEqual([]);
  });

  it("does not schedule a task with no remind_at", () => {
    const result = diffScheduledReminders([task({ remind_at: null })], [], NOW);
    expect(result.toSchedule).toEqual([]);
  });

  it("schedules inbox tasks too -- only done/dropped/archived are excluded", () => {
    const result = diffScheduledReminders([task({ status: "inbox" })], [], NOW);
    expect(result.toSchedule).toEqual([task({ status: "inbox" })]);
  });

  it("handles a mixed batch: one new, one unchanged, one stale-cancelled", () => {
    const unchanged = task({ id: "task-2", remind_at: FUTURE });
    const stale = task({ id: "task-3", status: "done" });
    const fresh = task({ id: "task-1", remind_at: FUTURE });
    const scheduled: ScheduledReminder[] = [
      { taskId: "task-2", notificationId: "n2", remindAt: FUTURE },
      { taskId: "task-3", notificationId: "n3", remindAt: FUTURE },
    ];
    const result = diffScheduledReminders([fresh, unchanged, stale], scheduled, NOW);
    expect(result.toSchedule).toEqual([fresh]);
    expect(result.toCancel).toEqual([scheduled[1]]);
  });

  // Checkpoint 5.4 added `remind_at` to TaskUpdateSchema, so a reminder time
  // can now change through a normal PATCH rather than only via AI capture.
  // These cases drive the exact same task id through a full lifecycle of
  // edits, asserting exactly one alarm survives every step -- this is the
  // property the reconciler's exact-string match at reconcile.ts:78 exists
  // to guarantee, and the property a naive "always reschedule" reconciler
  // would violate by leaking a stale notification on every edit.
  describe("remind_at lifecycle (Checkpoint 5.6)", () => {
    const EARLIER = "2026-08-18T07:00:00.000Z";
    const LATER = "2026-08-18T11:00:00.000Z";

    it("schedules a reminder for a task that previously had none", () => {
      const before = task({ remind_at: null });
      const result = diffScheduledReminders([before], [], NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual([]);

      const after = task({ remind_at: FUTURE });
      const result2 = diffScheduledReminders([after], [], NOW);
      expect(result2.toSchedule).toEqual([after]);
      expect(result2.toCancel).toEqual([]);
    });

    it("moving remind_at earlier cancels the old alarm and schedules exactly one new one", () => {
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "original", remindAt: FUTURE },
      ];
      const movedEarlier = task({ remind_at: EARLIER });
      const result = diffScheduledReminders([movedEarlier], scheduled, NOW);
      expect(result.toSchedule).toEqual([movedEarlier]);
      expect(result.toCancel).toEqual(scheduled);
      // Applying the diff leaves exactly one alarm for task-1.
      const nextScheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "new", remindAt: EARLIER },
      ];
      const settled = diffScheduledReminders([movedEarlier], nextScheduled, NOW);
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });

    it("moving remind_at later cancels the old alarm and schedules exactly one new one", () => {
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "original", remindAt: FUTURE },
      ];
      const movedLater = task({ remind_at: LATER });
      const result = diffScheduledReminders([movedLater], scheduled, NOW);
      expect(result.toSchedule).toEqual([movedLater]);
      expect(result.toCancel).toEqual(scheduled);
      const nextScheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "new", remindAt: LATER },
      ];
      const settled = diffScheduledReminders([movedLater], nextScheduled, NOW);
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });

    it("clearing remind_at to null cancels the alarm and leaves none scheduled", () => {
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "original", remindAt: FUTURE },
      ];
      const cleared = task({ remind_at: null });
      const result = diffScheduledReminders([cleared], scheduled, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual(scheduled);
    });

    it("an unrelated field change with byte-identical remind_at preserves the existing alarm", () => {
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "original", remindAt: FUTURE },
      ];
      // Only the title changed -- remind_at is the exact same string
      // (not merely an equivalent instant). If the reconciler rescheduled
      // on every pass regardless of remind_at, this would churn a fresh
      // alarm every ~60s poll / foreground event.
      const retitled = task({ title: "Call the insurance guy (updated)" });
      const result = diffScheduledReminders([retitled], scheduled, NOW);
      expect(result.toSchedule).toEqual([]);
      expect(result.toCancel).toEqual([]);
    });

    it("collapses several duplicate scheduled notifications for one task to exactly one, cancelling only the owned extras", () => {
      const otherTask = task({ id: "task-2", remind_at: FUTURE });
      const scheduled: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "dup-1", remindAt: FUTURE },
        { taskId: "task-1", notificationId: "dup-2", remindAt: FUTURE },
        { taskId: "task-1", notificationId: "dup-3", remindAt: FUTURE },
        { taskId: "task-2", notificationId: "still-valid", remindAt: FUTURE },
      ];
      const result = diffScheduledReminders([task(), otherTask], scheduled, NOW);
      expect(result.toSchedule).toEqual([]);
      // Exactly two of the three duplicates for task-1 are cancelled; the
      // other task's own, still-correct notification is never touched.
      expect(result.toCancel).toHaveLength(2);
      expect(result.toCancel.every((entry) => entry.taskId === "task-1")).toBe(true);
      expect(result.toCancel.map((entry) => entry.notificationId).sort()).toEqual([
        "dup-2",
        "dup-3",
      ]);
    });

    it("exact-alarm capability flipping granted -> revoked -> granted forces replacement each time", () => {
      // Granted (true) -> revoked (false): the previously-exact alarm no
      // longer matches and must be replaced with an inexact one.
      const grantedSchedule: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "exact", remindAt: FUTURE, exactAlarmCapable: true },
      ];
      const revoked = diffScheduledReminders([task()], grantedSchedule, NOW, false);
      expect(revoked.toSchedule).toEqual([task()]);
      expect(revoked.toCancel).toEqual(grantedSchedule);

      // Settle onto the inexact alarm, then re-grant: revoked (false) ->
      // granted (true) must replace it again, not leave the inexact one.
      const inexactSchedule: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "inexact", remindAt: FUTURE, exactAlarmCapable: false },
      ];
      const reGranted = diffScheduledReminders([task()], inexactSchedule, NOW, true);
      expect(reGranted.toSchedule).toEqual([task()]);
      expect(reGranted.toCancel).toEqual(inexactSchedule);

      // Exactly one alarm remains after settling onto the newly-exact one.
      const exactSchedule: ScheduledReminder[] = [
        { taskId: "task-1", notificationId: "exact-2", remindAt: FUTURE, exactAlarmCapable: true },
      ];
      const settled = diffScheduledReminders([task()], exactSchedule, NOW, true);
      expect(settled.toSchedule).toEqual([]);
      expect(settled.toCancel).toEqual([]);
    });
  });
});
