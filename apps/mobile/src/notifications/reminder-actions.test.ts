import { describe, expect, it } from "vitest";
import {
  REMINDER_ACTIONS,
  REMINDER_ACTION_COMPLETE,
  REMINDER_ACTION_SNOOZE_HOUR,
  REMINDER_ACTION_SNOOZE_TOMORROW,
  REMINDER_CATEGORY_ID,
  buildReminderCategoryActions,
  formatSnoozeTargetLabel,
  isReminderActionIdentifier,
  occurrenceReminderKey,
  readReminderNotificationData,
  taskReminderKey,
} from "./reminder-actions";

const TASK_ID = "11111111-1111-4111-8111-111111111111";
const OCC_ID = "22222222-2222-4222-8222-222222222222";
const AT = "2026-08-18T09:00:00.000Z";

describe("reminder category (Checkpoint 9.4)", () => {
  it("registers exactly Done / Snooze 1h / Tomorrow 9am, in that order", () => {
    expect(buildReminderCategoryActions()).toEqual([
      { identifier: "complete", buttonTitle: "Done", options: { opensAppToForeground: true } },
      {
        identifier: "snooze_hour",
        buttonTitle: "Snooze 1h",
        options: { opensAppToForeground: true },
      },
      {
        identifier: "snooze_tomorrow",
        buttonTitle: "Tomorrow 9am",
        options: { opensAppToForeground: true },
      },
    ]);
  });

  it("EVERY action foregrounds the app -- a background action is lost when the process is dead", () => {
    for (const action of buildReminderCategoryActions()) {
      expect(action.options?.opensAppToForeground).toBe(true);
    }
    // No textInput either: direct reply is the ADR-060 finding, not this feature.
    expect(buildReminderCategoryActions().every((action) => action.textInput === undefined)).toBe(
      true,
    );
  });

  it("the category identifier obeys setNotificationCategoryAsync's documented character restriction", () => {
    expect(REMINDER_CATEGORY_ID).toBe("reminder");
    expect(REMINDER_CATEGORY_ID).not.toMatch(/[:-]/);
  });

  it("the constants and the action list agree", () => {
    expect(REMINDER_ACTIONS.map((action) => action.identifier)).toEqual([
      REMINDER_ACTION_COMPLETE,
      REMINDER_ACTION_SNOOZE_HOUR,
      REMINDER_ACTION_SNOOZE_TOMORROW,
    ]);
    expect(isReminderActionIdentifier("complete")).toBe(true);
    expect(isReminderActionIdentifier("snooze_hour")).toBe(true);
    expect(isReminderActionIdentifier("snooze_tomorrow")).toBe(true);
    expect(isReminderActionIdentifier("expo.modules.notifications.actions.DEFAULT")).toBe(false);
    expect(isReminderActionIdentifier("")).toBe(false);
  });
});

describe("formatSnoozeTargetLabel", () => {
  const now = new Date("2026-08-18T14:05:00.000Z");

  it("formats a same-local-day target as a bare time", () => {
    const label = formatSnoozeTargetLabel("2026-08-18T15:05:00.000Z", now);
    expect(label).toMatch(/^\d{1,2}:\d{2}/);
    expect(label).not.toMatch(/[A-Za-z]{3} \d/);
  });

  it("prefixes the weekday when the target lands on another local day", () => {
    const label = formatSnoozeTargetLabel("2026-08-21T14:00:00.000Z", now);
    expect(label).toMatch(/^[A-Z][a-z]{2} \d{1,2}:\d{2}/);
  });

  it("is empty for an unparseable target rather than throwing", () => {
    expect(formatSnoozeTargetLabel("nope", now)).toBe("");
  });
});

describe("reminder keys", () => {
  it("label a one-off task and an occurrence exactly as the feed does", () => {
    expect(taskReminderKey(TASK_ID)).toBe(`task:${TASK_ID}`);
    expect(occurrenceReminderKey(OCC_ID)).toBe(`occ:${OCC_ID}`);
  });
});

describe("readReminderNotificationData", () => {
  it("reads the 9.4 payload", () => {
    expect(
      readReminderNotificationData({
        key: `occ:${OCC_ID}`,
        taskId: TASK_ID,
        occurrenceId: OCC_ID,
        remindAt: AT,
        exactAlarmCapable: true,
      }),
    ).toEqual({ key: `occ:${OCC_ID}`, taskId: TASK_ID, occurrenceId: OCC_ID, remindAt: AT });
  });

  it("reads a one-off 9.4 payload with a null occurrenceId", () => {
    expect(
      readReminderNotificationData({
        key: `task:${TASK_ID}`,
        taskId: TASK_ID,
        occurrenceId: null,
        remindAt: AT,
      }),
    ).toEqual({ key: `task:${TASK_ID}`, taskId: TASK_ID, occurrenceId: null, remindAt: AT });
  });

  it("reads a legacy (pre-9.4) payload as task:<taskId> with no occurrence", () => {
    expect(readReminderNotificationData({ taskId: TASK_ID, remindAt: AT })).toEqual({
      key: `task:${TASK_ID}`,
      taskId: TASK_ID,
      occurrenceId: null,
      remindAt: AT,
    });
  });

  it("rejects payloads that are not reminder-shaped", () => {
    expect(readReminderNotificationData(null)).toBeNull();
    expect(readReminderNotificationData(undefined)).toBeNull();
    expect(readReminderNotificationData("taskId")).toBeNull();
    expect(readReminderNotificationData({})).toBeNull();
    expect(readReminderNotificationData({ taskId: TASK_ID })).toBeNull();
    expect(readReminderNotificationData({ remindAt: AT })).toBeNull();
    expect(readReminderNotificationData({ taskId: "", remindAt: AT })).toBeNull();
    expect(readReminderNotificationData({ taskId: 42, remindAt: AT })).toBeNull();
    expect(readReminderNotificationData({ inboxId: "x" })).toBeNull();
    expect(readReminderNotificationData({ captureShortcut: true })).toBeNull();
  });

  it("ignores a malformed key or occurrenceId rather than trusting it", () => {
    expect(
      readReminderNotificationData({ key: "", taskId: TASK_ID, occurrenceId: 7, remindAt: AT }),
    ).toEqual({ key: `task:${TASK_ID}`, taskId: TASK_ID, occurrenceId: null, remindAt: AT });
  });
});
