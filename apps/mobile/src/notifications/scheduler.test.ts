import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReminderTask } from "./reconcile";

const { cancelMock, getAllMock, scheduleMock, getPresentedMock, dismissMock } = vi.hoisted(
  () => ({
    cancelMock: vi.fn(),
    getAllMock: vi.fn(),
    scheduleMock: vi.fn(),
    getPresentedMock: vi.fn(),
    dismissMock: vi.fn(),
  }),
);

vi.mock("react-native", () => ({ Platform: { OS: "android" } }));
vi.mock("expo-notifications", () => ({
  getAllScheduledNotificationsAsync: getAllMock,
  cancelScheduledNotificationAsync: cancelMock,
  scheduleNotificationAsync: scheduleMock,
  getPresentedNotificationsAsync: getPresentedMock,
  dismissNotificationAsync: dismissMock,
  setNotificationChannelAsync: vi.fn(),
  setNotificationCategoryAsync: vi.fn(),
  SchedulableTriggerInputTypes: { DATE: "date" },
  AndroidImportance: { MAX: 5, HIGH: 4, DEFAULT: 3, LOW: 2 },
}));

const {
  applyReminderReconciliation,
  cancelOwnedReminders,
  cancelRemindersForKey,
  resetPresentedImmediatelyForTest,
} = await import("./scheduler");

const FUTURE = new Date(Date.now() + 60_000).toISOString();
const FORTY_MINUTES_AGO = new Date(Date.now() - 40 * 60_000).toISOString();
const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, reject, resolve };
}

function reminderTask(taskId: string, overrides: Partial<ReminderTask> = {}): ReminderTask {
  return {
    key: `task:${taskId}`,
    taskId,
    occurrenceId: null,
    title: `Task ${taskId}`,
    remindAt: FUTURE,
    dueAt: FUTURE,
    recurring: false,
    ...overrides,
  };
}

function scheduledEntry(identifier: string, data: Record<string, unknown>) {
  return { identifier, content: { data } };
}

/** The shape getPresentedNotificationsAsync returns: a Notification wrapping a request. */
function presentedEntry(identifier: string, data: Record<string, unknown>) {
  return { date: Date.now(), request: { identifier, content: { data }, trigger: null } };
}

function resetMocks() {
  cancelMock.mockReset().mockResolvedValue(undefined);
  getAllMock.mockReset().mockResolvedValue([]);
  scheduleMock.mockReset().mockResolvedValue("notification-1");
  getPresentedMock.mockReset().mockResolvedValue([]);
  dismissMock.mockReset().mockResolvedValue(undefined);
  resetPresentedImmediatelyForTest();
}

describe("local reminder scheduler", () => {
  beforeEach(resetMocks);

  it("schedules an eligible reminder with the 9.4 payload, category, channel and a deterministic identifier", async () => {
    await applyReminderReconciliation(
      [
        reminderTask(TASK_ID, {
          key: `occ:${OCC_ID}`,
          occurrenceId: OCC_ID,
          title: "Water the plants",
          recurring: true,
        }),
      ],
      true,
    );

    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const request = scheduleMock.mock.calls[0]![0];
    expect(request.identifier).toBe(`reminder:occ:${OCC_ID}:${FUTURE}`);
    expect(request.content.title).toBe("Water the plants");
    expect(request.content.body).toMatch(/^Due .* · repeats$/);
    expect(request.content.categoryIdentifier).toBe("reminder");
    expect(request.content.data).toEqual({
      key: `occ:${OCC_ID}`,
      taskId: TASK_ID,
      occurrenceId: OCC_ID,
      remindAt: FUTURE,
      exactAlarmCapable: true,
    });
    expect(request.trigger).toEqual({
      type: "date",
      date: new Date(FUTURE),
      channelId: "reminders",
    });
  });

  it("re-scheduling the same reminder yields the same identifier (replace, never stack)", async () => {
    await applyReminderReconciliation([reminderTask(TASK_ID)], true);
    await applyReminderReconciliation([reminderTask(TASK_ID)], true);
    const ids = scheduleMock.mock.calls.map(([request]) => request.identifier);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
  });

  it("cancels only Personal OS-owned reminders, including legacy-shaped ones", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("owned", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
      }),
      scheduledEntry("legacy", { taskId: TASK_ID, remindAt: FUTURE }),
      scheduledEntry("unrelated", {}),
      scheduledEntry("capture-shortcut-1", { captureShortcut: true }),
    ]);

    await cancelOwnedReminders();

    expect(cancelMock.mock.calls.map(([id]) => id).sort()).toEqual(["legacy", "owned"]);
  });

  it("replaces an inexact schedule after exact-alarm access is granted", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("old", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
        exactAlarmCapable: false,
      }),
    ]);

    await applyReminderReconciliation([reminderTask(TASK_ID)], true);

    expect(cancelMock).toHaveBeenCalledWith("old");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it("repairs duplicate owned reminders without cancelling unrelated notifications", async () => {
    const data = {
      key: `task:${TASK_ID}`,
      taskId: TASK_ID,
      occurrenceId: null,
      remindAt: FUTURE,
      exactAlarmCapable: true,
    };
    getAllMock.mockResolvedValue([
      scheduledEntry("retained", data),
      scheduledEntry("duplicate", data),
      scheduledEntry("unrelated", { source: "another-app" }),
    ]);

    await applyReminderReconciliation([reminderTask(TASK_ID)], true);

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("duplicate");
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  it("cancels a legacy (pre-9.4) alarm for a task the feed now lists per occurrence, and schedules the occurrence", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("legacy-parent", { taskId: TASK_ID, remindAt: FUTURE, exactAlarmCapable: true }),
    ]);

    await applyReminderReconciliation(
      [reminderTask(TASK_ID, { key: `occ:${OCC_ID}`, occurrenceId: OCC_ID, recurring: true })],
      true,
    );

    expect(cancelMock).toHaveBeenCalledTimes(1);
    expect(cancelMock).toHaveBeenCalledWith("legacy-parent");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock.mock.calls[0]![0].identifier).toBe(`reminder:occ:${OCC_ID}:${FUTURE}`);
  });

  it("replaces a legacy (pre-9.4) alarm for an unchanged one-off task, once, with one that carries the action category", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("legacy", { taskId: TASK_ID, remindAt: FUTURE, exactAlarmCapable: true }),
    ]);

    await applyReminderReconciliation([reminderTask(TASK_ID)], true);

    expect(cancelMock).toHaveBeenCalledWith("legacy");
    expect(scheduleMock).toHaveBeenCalledTimes(1);
    const request = scheduleMock.mock.calls[0]![0];
    expect(request.identifier).toBe(`reminder:task:${TASK_ID}:${FUTURE}`);
    expect(request.content.categoryIdentifier).toBe("reminder");
    expect(request.content.data.key).toBe(`task:${TASK_ID}`);

    // The replacement is retained on the next pass: no churn.
    resetMocks();
    getAllMock.mockResolvedValue([scheduledEntry(request.identifier, request.content.data)]);
    await applyReminderReconciliation([reminderTask(TASK_ID)], true);
    expect(cancelMock).not.toHaveBeenCalled();
    expect(scheduleMock).not.toHaveBeenCalled();
  });

  describe("a missed reminder inside the grace hour (Checkpoint 9.4)", () => {
    it("presents a missed ONE-OFF immediately on the reminders channel -- never a DATE trigger in the past, which expo-notifications removes", async () => {
      await applyReminderReconciliation([reminderTask(TASK_ID, { remindAt: FORTY_MINUTES_AGO })]);

      expect(getPresentedMock).toHaveBeenCalledTimes(1);
      expect(scheduleMock).toHaveBeenCalledTimes(1);
      const request = scheduleMock.mock.calls[0]![0];
      expect(request.identifier).toBe(`reminder:task:${TASK_ID}:${FORTY_MINUTES_AGO}`);
      expect(request.trigger).toEqual({ channelId: "reminders" });
      expect(request.content.categoryIdentifier).toBe("reminder");
    });

    it("does NOT present it when a notification for that key is already in the shade (the fired alarm, or a previous process's presentation)", async () => {
      getPresentedMock.mockResolvedValue([
        presentedEntry("fired-earlier", {
          key: `task:${TASK_ID}`,
          taskId: TASK_ID,
          occurrenceId: null,
          remindAt: FORTY_MINUTES_AGO,
        }),
      ]);

      await applyReminderReconciliation([reminderTask(TASK_ID, { remindAt: FORTY_MINUTES_AGO })]);

      expect(scheduleMock).not.toHaveBeenCalled();
    });

    it("presents it once per process: a later pass in the same process does not re-present a swiped-away entry", async () => {
      const missed = reminderTask(TASK_ID, { remindAt: FORTY_MINUTES_AGO });
      await applyReminderReconciliation([missed]);
      expect(scheduleMock).toHaveBeenCalledTimes(1);

      // Swiped away: no longer presented, and still not in the scheduled store.
      await applyReminderReconciliation([missed]);
      expect(scheduleMock).toHaveBeenCalledTimes(1);
    });

    it("a legacy presented entry (no key) guards through its derived task:<id> key too", async () => {
      getPresentedMock.mockResolvedValue([
        presentedEntry("legacy", { taskId: TASK_ID, remindAt: FORTY_MINUTES_AGO }),
      ]);

      await applyReminderReconciliation([reminderTask(TASK_ID, { remindAt: FORTY_MINUTES_AGO })]);

      expect(scheduleMock).not.toHaveBeenCalled();
    });

    it("never presents a missed OCCURRENCE -- a fresh successor must not ring the moment it is generated", async () => {
      await applyReminderReconciliation([
        reminderTask(TASK_ID, {
          key: `occ:${OCC_ID}`,
          occurrenceId: OCC_ID,
          recurring: true,
          remindAt: FORTY_MINUTES_AGO,
        }),
      ]);

      expect(getPresentedMock).not.toHaveBeenCalled();
      expect(scheduleMock).not.toHaveBeenCalled();
    });

    it("a future reminder in the same pass still gets its DATE trigger, and the shade is read at most once", async () => {
      await applyReminderReconciliation([
        reminderTask(TASK_ID, { remindAt: FORTY_MINUTES_AGO }),
        reminderTask("task-2", { remindAt: FUTURE }),
        reminderTask("task-3", { remindAt: FORTY_MINUTES_AGO }),
      ]);

      expect(getPresentedMock).toHaveBeenCalledTimes(1);
      expect(scheduleMock.mock.calls.map(([request]) => request.trigger)).toEqual([
        { channelId: "reminders" },
        { type: "date", date: new Date(FUTURE), channelId: "reminders" },
        { channelId: "reminders" },
      ]);
    });
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
    expect(scheduleMock.mock.calls.map(([request]) => request.content.data["taskId"])).toEqual([
      "task-1",
      "task-2",
    ]);
  });
});

describe("cancelRemindersForKey (Checkpoint 9.4)", () => {
  beforeEach(resetMocks);

  it("also dismisses a PRESENTED notification for the key, so completing in-app removes the fired entry's live buttons", async () => {
    getPresentedMock.mockResolvedValue([
      presentedEntry("fired-occ", {
        key: `occ:${OCC_ID}`,
        taskId: TASK_ID,
        occurrenceId: OCC_ID,
        remindAt: FUTURE,
      }),
      presentedEntry("fired-other", {
        key: "occ:other",
        taskId: TASK_ID,
        occurrenceId: "other",
        remindAt: FUTURE,
      }),
      presentedEntry("capture", { captureShortcut: true }),
    ]);

    await cancelRemindersForKey(`occ:${OCC_ID}`);

    expect(dismissMock).toHaveBeenCalledTimes(1);
    expect(dismissMock).toHaveBeenCalledWith("fired-occ");
  });

  it("dismisses a presented legacy (pre-9.4) entry through its derived task:<id> key", async () => {
    getPresentedMock.mockResolvedValue([
      presentedEntry("legacy", { taskId: TASK_ID, remindAt: FUTURE }),
    ]);

    await cancelRemindersForKey(`task:${TASK_ID}`);

    expect(dismissMock).toHaveBeenCalledWith("legacy");
  });

  it("a dismiss that fails (already swiped away) does not fail the cancel", async () => {
    getPresentedMock.mockResolvedValue([
      presentedEntry("gone", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
      }),
    ]);
    dismissMock.mockRejectedValue(new Error("not presented"));

    await expect(cancelRemindersForKey(`task:${TASK_ID}`)).resolves.toBeUndefined();
  });

  it("cancels every owned entry whose key matches and nothing else", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("occ-a", {
        key: `occ:${OCC_ID}`,
        taskId: TASK_ID,
        occurrenceId: OCC_ID,
        remindAt: FUTURE,
      }),
      scheduledEntry("occ-a-dup", {
        key: `occ:${OCC_ID}`,
        taskId: TASK_ID,
        occurrenceId: OCC_ID,
        remindAt: FUTURE,
      }),
      scheduledEntry("task-level", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
      }),
      scheduledEntry("unrelated", { source: "another-app" }),
    ]);

    await cancelRemindersForKey(`occ:${OCC_ID}`);

    expect(cancelMock.mock.calls.map(([id]) => id).sort()).toEqual(["occ-a", "occ-a-dup"]);
  });

  it("matches a legacy (pre-9.4) entry through its derived task:<taskId> key", async () => {
    getAllMock.mockResolvedValue([scheduledEntry("legacy", { taskId: TASK_ID, remindAt: FUTURE })]);

    await cancelRemindersForKey(`task:${TASK_ID}`);

    expect(cancelMock).toHaveBeenCalledWith("legacy");
  });

  it("is a no-op when nothing matches", async () => {
    getAllMock.mockResolvedValue([
      scheduledEntry("other", {
        key: "task:other",
        taskId: "other",
        occurrenceId: null,
        remindAt: FUTURE,
      }),
    ]);

    await cancelRemindersForKey(`task:${TASK_ID}`);

    expect(cancelMock).not.toHaveBeenCalled();
  });

  it("is serialized through the reconciliation chain: a cancel issued during a reconcile pass runs after it", async () => {
    const firstSchedule = deferred<string>();
    scheduleMock.mockImplementationOnce(() => firstSchedule.promise);

    const reconcile = applyReminderReconciliation([reminderTask(TASK_ID)]);
    const cancel = cancelRemindersForKey(`task:${TASK_ID}`);

    await vi.waitFor(() => expect(scheduleMock).toHaveBeenCalledTimes(1));
    // The cancel's own store read has NOT happened yet -- it is queued
    // behind the in-flight reconcile.
    expect(getAllMock).toHaveBeenCalledTimes(1);

    firstSchedule.resolve("n1");
    await reconcile;
    await cancel;

    expect(getAllMock).toHaveBeenCalledTimes(2);
  });

  it("a reconcile issued after a cancel waits for the cancel (newest pass runs last)", async () => {
    const cancelGate = deferred<void>();
    getAllMock.mockResolvedValueOnce([
      scheduledEntry("stale", {
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: FUTURE,
      }),
    ]);
    cancelMock.mockImplementationOnce(() => cancelGate.promise);

    const cancel = cancelRemindersForKey(`task:${TASK_ID}`);
    const reconcile = applyReminderReconciliation([reminderTask(TASK_ID)]);

    await vi.waitFor(() => expect(cancelMock).toHaveBeenCalledTimes(1));
    expect(getAllMock).toHaveBeenCalledTimes(1);
    expect(scheduleMock).not.toHaveBeenCalled();

    cancelGate.resolve();
    await cancel;
    await reconcile;

    // The reconcile ran second, read a (now empty) store and scheduled the
    // reminder afresh.
    expect(getAllMock).toHaveBeenCalledTimes(2);
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });

  it("a failing cancel does not poison later passes", async () => {
    getAllMock.mockRejectedValueOnce(new Error("store unavailable"));

    await expect(cancelRemindersForKey(`task:${TASK_ID}`)).rejects.toThrow("store unavailable");
    await expect(applyReminderReconciliation([reminderTask(TASK_ID)])).resolves.toBeUndefined();
    expect(scheduleMock).toHaveBeenCalledTimes(1);
  });
});
