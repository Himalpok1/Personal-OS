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

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function reminderTask(id: string) {
  return {
    id,
    title: `Task ${id}`,
    remind_at: FUTURE,
    status: "active" as const,
    archived_at: null,
  };
}

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

  it("repairs duplicate owned reminders without cancelling unrelated notifications", async () => {
    getAllMock.mockResolvedValue([
      {
        identifier: "retained",
        content: {
          data: { taskId: "task-1", remindAt: FUTURE, exactAlarmCapable: true },
        },
      },
      {
        identifier: "duplicate",
        content: {
          data: { taskId: "task-1", remindAt: FUTURE, exactAlarmCapable: true },
        },
      },
      {
        identifier: "unrelated",
        content: { data: { source: "another-app" } },
      },
    ]);

    await applyReminderReconciliation([reminderTask("task-1")], true);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("duplicate");
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("serializes overlapping reconciliations and continues after an earlier failure", async () => {
    const firstSchedule = deferred<string>();
    scheduleMock
      .mockImplementationOnce(() => firstSchedule.promise)
      .mockResolvedValueOnce("notification-2");

    const first = applyReminderReconciliation([reminderTask("task-1")]);
    const second = applyReminderReconciliation([reminderTask("task-2")]);

    await vi.waitFor(() => expect(scheduleMock).toHaveBeenCalledTimes(1));
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0]?.[0].content.data).toMatchObject({ taskId: "task-1" });

    firstSchedule.reject(new Error("first reconciliation failed"));

    await expect(first).rejects.toThrow("first reconciliation failed");
    await expect(second).resolves.toBeUndefined();
    expect(getAllMock).toHaveBeenCalledTimes(2);
    expect(
      scheduleMock.mock.calls.map(([request]) => request.content.data["taskId"]),
    ).toEqual(["task-1", "task-2"]);
  });
});
