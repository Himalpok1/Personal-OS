import { beforeEach, describe, expect, it, vi } from "vitest";

const { cancelMock, getAllMock, scheduleMock } = vi.hoisted(() => ({
  cancelMock: vi.fn(),
  getAllMock: vi.fn(),
  scheduleMock: vi.fn(),
}));

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  getAllScheduledNotificationsAsync: getAllMock,
  cancelScheduledNotificationAsync: cancelMock,
  scheduleNotificationAsync: scheduleMock,
  SchedulableTriggerInputTypes: { DATE: "date" },
}));

const { applyReminderReconciliation, cancelOwnedReminders } = await import("./scheduler");

const FUTURE = new Date(Date.now() + 60_000).toISOString();

describe("local reminder scheduler", () => {
  beforeEach(() => {
    cancelMock.mockReset().mockResolvedValue(undefined);
    getAllMock.mockReset().mockResolvedValue([]);
    scheduleMock.mockReset().mockResolvedValue("notification-1");
  });

  it("schedules an eligible reminder with ownership and exact-alarm metadata", async () => {
    await applyReminderReconciliation(
      [
        {
          id: "task-1",
          title: "Call mom",
          remind_at: FUTURE,
          status: "active",
          archived_at: null,
        },
      ],
      true,
    );

    expect(scheduleMock).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.objectContaining({
          data: {
            taskId: "task-1",
            remindAt: FUTURE,
            exactAlarmCapable: true,
          },
        }),
      }),
    );
  });

  it("cancels only Personal OS-owned reminders", async () => {
    getAllMock.mockResolvedValue([
      {
        identifier: "owned",
        content: { data: { taskId: "task-1", remindAt: FUTURE } },
      },
      { identifier: "unrelated", content: { data: {} } },
    ]);

    await cancelOwnedReminders();

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("owned");
  });

  it("replaces an inexact schedule after exact-alarm access is granted", async () => {
    getAllMock.mockResolvedValue([
      {
        identifier: "old",
        content: {
          data: { taskId: "task-1", remindAt: FUTURE, exactAlarmCapable: false },
        },
      },
    ]);

    await applyReminderReconciliation(
      [
        {
          id: "task-1",
          title: "Call mom",
          remind_at: FUTURE,
          status: "active",
          archived_at: null,
        },
      ],
      true,
    );

    expect(cancelMock).toHaveBeenCalledWith("old");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });
});
