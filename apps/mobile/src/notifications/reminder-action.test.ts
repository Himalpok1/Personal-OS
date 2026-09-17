import { ApiClientError } from "@personal-os/api-client";
import { computeSnoozeTargets } from "@personal-os/core/task-snooze";
import type { Task } from "@personal-os/schema";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { formatSnoozeTargetLabel } from "./reminder-actions";
import {
  REMINDER_ACTION_INVALIDATIONS,
  classifyReminderActionFailure,
  performReminderAction,
  type ReminderActionDeps,
  type ReminderActionInput,
} from "./reminder-action";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";
const OTHER_OCC_ID = "33333333-3333-4333-8333-333333333333";
const AT = "2026-08-18T09:00:00.000Z";
const NOW = new Date("2026-08-18T09:05:00.000Z");
const TZ = "America/Chicago";

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: TASK_ID,
    title: "Call the insurance guy",
    body: null,
    status: "active",
    due_at: AT,
    remind_at: AT,
    timezone: TZ,
    priority: null,
    project_id: null,
    canvas_assignment_id: null,
    completed_at: null,
    rrule: null,
    recurrence_anchor: null,
    recurrence_timezone: null,
    recurrence_until: null,
    recurrence_count: null,
    recurrence_exdates: null,
    archived_at: null,
    created_at: "2026-08-01T00:00:00.000Z",
    updated_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

function makeDeps() {
  const api = {
    completeOccurrence: vi.fn().mockResolvedValue({ id: OCC_ID, status: "done" }),
    completeTask: vi.fn().mockResolvedValue(task({ status: "done" })),
    snoozeOccurrence: vi.fn().mockResolvedValue({}),
    getTask: vi.fn().mockResolvedValue(task()),
    updateTask: vi.fn().mockResolvedValue(task()),
  };
  const deps: ReminderActionDeps = {
    api,
    invalidateQueries: vi.fn().mockResolvedValue(undefined),
    dismissNotification: vi.fn().mockResolvedValue(undefined),
    cancelRemindersForKey: vi.fn().mockResolvedValue(undefined),
    now: () => NOW,
    timezone: () => TZ,
  };
  return { api, deps };
}

function oneOff(action: ReminderActionInput["action"]): ReminderActionInput {
  return {
    identifier: `reminder:task:${TASK_ID}:${AT}`,
    action,
    data: { key: `task:${TASK_ID}`, taskId: TASK_ID, occurrenceId: null, remindAt: AT },
  };
}

function occurrence(action: ReminderActionInput["action"]): ReminderActionInput {
  return {
    identifier: `reminder:occ:${OCC_ID}:${AT}`,
    action,
    data: { key: `occ:${OCC_ID}`, taskId: TASK_ID, occurrenceId: OCC_ID, remindAt: AT },
  };
}

function invalidatedKeys(deps: ReminderActionDeps): unknown[] {
  return (deps.invalidateQueries as ReturnType<typeof vi.fn>).mock.calls.map(([key]) => key);
}

describe("performReminderAction (Checkpoint 9.4)", () => {
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  describe("complete", () => {
    it("completes the OCCURRENCE directly when the payload carries one", async () => {
      const { api, deps } = makeDeps();

      const outcome = await performReminderAction(occurrence("complete"), deps);

      expect(api.completeOccurrence).toHaveBeenCalledWith(OCC_ID);
      expect(api.completeTask).not.toHaveBeenCalled();
      expect(outcome).toEqual({ taskId: TASK_ID, action: "complete", status: "done", label: "" });
    });

    it("completes the TASK for a one-off reminder", async () => {
      const { api, deps } = makeDeps();

      const outcome = await performReminderAction(oneOff("complete"), deps);

      expect(api.completeTask).toHaveBeenCalledWith(TASK_ID);
      expect(api.completeOccurrence).not.toHaveBeenCalled();
      expect(outcome.status).toBe("done");
    });

    it("falls back to the occurrence a 409 recurring_task_use_occurrence names (a legacy alarm on a task that became recurring)", async () => {
      const { api, deps } = makeDeps();
      api.completeTask.mockRejectedValue(
        new ApiClientError(409, "recurring_task_use_occurrence", {
          error: "recurring_task_use_occurrence",
          occurrence_id: OTHER_OCC_ID,
        }),
      );

      const outcome = await performReminderAction(oneOff("complete"), deps);

      expect(api.completeTask).toHaveBeenCalledTimes(1);
      expect(api.completeOccurrence).toHaveBeenCalledWith(OTHER_OCC_ID);
      expect(outcome.status).toBe("done");
    });

    it("a 409 with no open occurrence is a failure, not a retry loop", async () => {
      const { api, deps } = makeDeps();
      api.completeTask.mockRejectedValue(
        new ApiClientError(409, "recurring_task_no_open_occurrence", {
          error: "recurring_task_no_open_occurrence",
        }),
      );

      const outcome = await performReminderAction(oneOff("complete"), deps);

      expect(api.completeOccurrence).not.toHaveBeenCalled();
      expect(outcome.status).toBe("failed");
    });
  });

  describe("snooze target selection", () => {
    it("snooze_hour targets now + 60 minutes, and the outcome label is that target formatted device-locally", async () => {
      const { api, deps } = makeDeps();

      const outcome = await performReminderAction(occurrence("snooze_hour"), deps);

      expect(api.snoozeOccurrence).toHaveBeenCalledWith(OCC_ID, {
        until: "2026-08-18T10:05:00.000Z",
      });
      expect(outcome.status).toBe("done");
      // Formatted in the test machine's own zone -- whichever that is, the
      // label is the target's device-local rendering, never a sentence.
      expect(outcome.label).toBe(formatSnoozeTargetLabel("2026-08-18T10:05:00.000Z", NOW));
      expect(outcome.label).toMatch(/\d{1,2}:\d{2}/);
    });

    it("snooze_tomorrow targets 09:00 tomorrow in the DEVICE zone (Chicago, CDT = UTC-5)", async () => {
      const { api, deps } = makeDeps();

      const outcome = await performReminderAction(occurrence("snooze_tomorrow"), deps);

      expect(api.snoozeOccurrence).toHaveBeenCalledWith(OCC_ID, {
        until: "2026-08-19T14:00:00.000Z",
      });
      // ... which is exactly what the detail screen's own chips compute.
      expect(computeSnoozeTargets(NOW, TZ).tomorrowMorning).toBe("2026-08-19T14:00:00.000Z");
      // A different local day than `now`, so the label carries the weekday.
      expect(outcome.label).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2}/);
    });

    it("uses the injected zone, not a hardcoded one", async () => {
      const { api, deps } = makeDeps();
      deps.timezone = () => "Pacific/Auckland";

      await performReminderAction(occurrence("snooze_tomorrow"), deps);

      expect(api.snoozeOccurrence).toHaveBeenCalledWith(OCC_ID, {
        until: computeSnoozeTargets(NOW, "Pacific/Auckland").tomorrowMorning,
      });
    });
  });

  describe("snooze routing", () => {
    it("snoozes the OCCURRENCE when the payload carries one -- never PATCHes the parent", async () => {
      const { api, deps } = makeDeps();

      await performReminderAction(occurrence("snooze_hour"), deps);

      expect(api.snoozeOccurrence).toHaveBeenCalledTimes(1);
      expect(api.getTask).not.toHaveBeenCalled();
      expect(api.updateTask).not.toHaveBeenCalled();
    });

    it("a one-off reminder fetches the task, then PATCHes due_at AND remind_at (the task has a reminder)", async () => {
      const { api, deps } = makeDeps();

      await performReminderAction(oneOff("snooze_hour"), deps);

      expect(api.getTask).toHaveBeenCalledWith(TASK_ID);
      expect(api.updateTask).toHaveBeenCalledWith(TASK_ID, {
        due_at: "2026-08-18T10:05:00.000Z",
        remind_at: "2026-08-18T10:05:00.000Z",
      });
      expect(api.snoozeOccurrence).not.toHaveBeenCalled();
    });

    it("a one-off task that (by now) has no remind_at gets due_at only -- a snooze never creates a reminder", async () => {
      const { api, deps } = makeDeps();
      api.getTask.mockResolvedValue(task({ remind_at: null }));

      await performReminderAction(oneOff("snooze_tomorrow"), deps);

      expect(api.updateTask).toHaveBeenCalledWith(TASK_ID, { due_at: "2026-08-19T14:00:00.000Z" });
    });
  });

  describe("after success", () => {
    it("dismisses the notification, cancels the alarm for the key, and then starts the tasks/today/occurrences/reminders invalidations without waiting on them", async () => {
      const { deps } = makeDeps();
      const order: string[] = [];
      (deps.dismissNotification as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("dismiss");
      });
      (deps.cancelRemindersForKey as ReturnType<typeof vi.fn>).mockImplementation(async () => {
        order.push("cancel");
      });
      // A refetch that never settles: the outcome must not wait on it.
      (deps.invalidateQueries as ReturnType<typeof vi.fn>).mockImplementation(() => {
        order.push("invalidate");
        return new Promise(() => undefined);
      });

      await performReminderAction(occurrence("complete"), deps);

      expect(deps.dismissNotification).toHaveBeenCalledWith(`reminder:occ:${OCC_ID}:${AT}`);
      expect(deps.cancelRemindersForKey).toHaveBeenCalledWith(`occ:${OCC_ID}`);
      expect(invalidatedKeys(deps)).toEqual([["tasks"], ["today"], ["occurrences"], ["reminders"]]);
      expect(REMINDER_ACTION_INVALIDATIONS).toEqual([
        ["tasks"],
        ["today"],
        ["occurrences"],
        ["reminders"],
      ]);
      expect(order).toEqual(["dismiss", "cancel", "invalidate", "invalidate", "invalidate", "invalidate"]);
    });

    it("a failing dismiss does not skip the cancel or the invalidation, and the outcome stays done", async () => {
      const { deps } = makeDeps();
      (deps.dismissNotification as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("gone"));

      const outcome = await performReminderAction(oneOff("complete"), deps);

      expect(deps.cancelRemindersForKey).toHaveBeenCalledWith(`task:${TASK_ID}`);
      expect(invalidatedKeys(deps)).toHaveLength(4);
      expect(outcome.status).toBe("done");
      expect(warn).toHaveBeenCalled();
    });

    it("a failing cancel does not skip the invalidation", async () => {
      const { deps } = makeDeps();
      (deps.cancelRemindersForKey as ReturnType<typeof vi.fn>).mockRejectedValue(
        new Error("store unavailable"),
      );

      const outcome = await performReminderAction(oneOff("complete"), deps);

      expect(invalidatedKeys(deps)).toHaveLength(4);
      expect(outcome.status).toBe("done");
    });
  });

  describe("failure", () => {
    it("a network failure yields a failed outcome, never throws, and leaves the notification and alarm in place", async () => {
      const { api, deps } = makeDeps();
      api.completeOccurrence.mockRejectedValue(new TypeError("Network request failed"));

      const outcome = await performReminderAction(occurrence("complete"), deps);

      expect(outcome).toEqual({
        taskId: TASK_ID,
        action: "complete",
        status: "failed",
        label: "",
        reason: "network",
      });
      expect(deps.dismissNotification).not.toHaveBeenCalled();
      expect(deps.cancelRemindersForKey).not.toHaveBeenCalled();
      expect(deps.invalidateQueries).not.toHaveBeenCalled();
    });

    it("a 409 (the state moved on) is `not_open`, and the stale notification IS dismissed -- nothing is left to act on", async () => {
      const { api, deps } = makeDeps();
      api.snoozeOccurrence.mockRejectedValue(
        new ApiClientError(409, "occurrence_not_open", { error: "occurrence_not_open" }),
      );

      const outcome = await performReminderAction(occurrence("snooze_hour"), deps);

      expect(outcome).toEqual({
        taskId: TASK_ID,
        action: "snooze_hour",
        status: "failed",
        label: "",
        reason: "not_open",
      });
      expect(deps.dismissNotification).toHaveBeenCalledWith(`reminder:occ:${OCC_ID}:${AT}`);
      // Dismissed, but not otherwise treated as a success.
      expect(deps.cancelRemindersForKey).not.toHaveBeenCalled();
      expect(deps.invalidateQueries).not.toHaveBeenCalled();
    });

    it("a 404 is `not_found` and also dismisses; a failed one-off snooze can fail at the fetch step", async () => {
      const { api, deps } = makeDeps();
      api.getTask.mockRejectedValue(new ApiClientError(404, "not_found"));

      const outcome = await performReminderAction(oneOff("snooze_tomorrow"), deps);

      expect(api.updateTask).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: "failed", reason: "not_found" });
      expect(deps.dismissNotification).toHaveBeenCalledWith(`reminder:task:${TASK_ID}:${AT}`);
    });

    it("a one-off snooze on a task that is no longer open is refused CLIENT-side as `not_open` -- the PATCH never happens", async () => {
      const { api, deps } = makeDeps();
      api.getTask.mockResolvedValue(task({ status: "done", completed_at: AT }));

      const outcome = await performReminderAction(oneOff("snooze_hour"), deps);

      expect(api.updateTask).not.toHaveBeenCalled();
      expect(outcome).toMatchObject({ status: "failed", reason: "not_open" });
      expect(deps.dismissNotification).toHaveBeenCalledTimes(1);
    });

    it("a one-off snooze on an inbox task is still open and proceeds", async () => {
      const { api, deps } = makeDeps();
      api.getTask.mockResolvedValue(task({ status: "inbox" }));

      const outcome = await performReminderAction(oneOff("snooze_hour"), deps);

      expect(api.updateTask).toHaveBeenCalledTimes(1);
      expect(outcome.status).toBe("done");
    });

    it("a failing dismiss on the stale path still yields the failed outcome", async () => {
      const { api, deps } = makeDeps();
      api.completeOccurrence.mockRejectedValue(new ApiClientError(404, "not_found"));
      (deps.dismissNotification as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("gone"));

      const outcome = await performReminderAction(occurrence("complete"), deps);

      expect(outcome).toMatchObject({ status: "failed", reason: "not_found" });
    });

    it("classifyReminderActionFailure: no ApiClientError -> network, 404 -> not_found, any 409 -> not_open, else unknown", () => {
      expect(classifyReminderActionFailure(new TypeError("Network request failed"))).toBe("network");
      expect(classifyReminderActionFailure("string")).toBe("network");
      expect(classifyReminderActionFailure(new ApiClientError(404, "not_found"))).toBe("not_found");
      for (const code of [
        "occurrence_not_open",
        "task_not_open",
        "occurrence_not_reopenable",
        "task_not_reopenable",
        "recurring_task_no_open_occurrence",
        "invalid_status_transition",
      ]) {
        expect(classifyReminderActionFailure(new ApiClientError(409, code))).toBe("not_open");
      }
      expect(classifyReminderActionFailure(new ApiClientError(500, "internal"))).toBe("unknown");
      expect(classifyReminderActionFailure(new ApiClientError(400, "validation_failed"))).toBe(
        "unknown",
      );
    });

    it("the warning line carries the action, reason and error class only -- never task text or ids", async () => {
      const { api, deps } = makeDeps();
      api.completeTask.mockRejectedValue(new Error("boom"));

      await performReminderAction(oneOff("complete"), deps);

      expect(warn).toHaveBeenCalledWith("Reminder notification action failed", {
        action: "complete",
        reason: "network",
        status: "Error",
      });
      const logged = JSON.stringify(warn.mock.calls);
      expect(logged).not.toContain(TASK_ID);
      expect(logged).not.toContain("insurance");
    });
  });
});
