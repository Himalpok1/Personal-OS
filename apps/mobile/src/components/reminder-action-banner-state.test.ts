import { describe, expect, it } from "vitest";
import { reminderActionBannerText } from "./reminder-action-banner-state";
import { OCCURRENCE_NOT_OPEN_MESSAGE } from "./task-actions-state";

const TASK_ID = "11111111-1111-4111-8111-111111111111";

describe("reminderActionBannerText", () => {
  it("reports a completion", () => {
    expect(
      reminderActionBannerText({ taskId: TASK_ID, action: "complete", status: "done", label: "" }),
    ).toBe("Completed from reminder");
  });

  it("reports a snooze with its target label, or without one", () => {
    expect(
      reminderActionBannerText({
        taskId: TASK_ID,
        action: "snooze_tomorrow",
        status: "done",
        label: "Sep 15, 2026, 9:00 AM",
      }),
    ).toBe("Snoozed until Sep 15, 2026, 9:00 AM from reminder");
    expect(
      reminderActionBannerText({ taskId: TASK_ID, action: "snooze_hour", status: "done", label: "" }),
    ).toBe("Snoozed from reminder");
  });

  it("reports a network failure with the verb and 'try again', never the task's text", () => {
    expect(
      reminderActionBannerText({
        taskId: TASK_ID,
        action: "complete",
        status: "failed",
        label: "",
        reason: "network",
      }),
    ).toBe("Couldn't complete from the reminder — try again");
    expect(
      reminderActionBannerText({
        taskId: TASK_ID,
        action: "snooze_hour",
        status: "failed",
        label: "x",
        reason: "unknown",
      }),
    ).toBe("Couldn't snooze from the reminder — try again");
  });

  it("a 409 says the state moved on, in the same words the detail screen's snooze chips use", () => {
    expect(
      reminderActionBannerText({
        taskId: TASK_ID,
        action: "complete",
        status: "failed",
        label: "",
        reason: "not_open",
      }),
    ).toBe(OCCURRENCE_NOT_OPEN_MESSAGE);
    expect(OCCURRENCE_NOT_OPEN_MESSAGE).toBe("That one has already been completed or skipped.");
  });

  it("a 404 says the task is gone", () => {
    expect(
      reminderActionBannerText({
        taskId: TASK_ID,
        action: "snooze_tomorrow",
        status: "failed",
        label: "",
        reason: "not_found",
      }),
    ).toBe("That task no longer exists.");
  });
});
