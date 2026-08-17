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
});
