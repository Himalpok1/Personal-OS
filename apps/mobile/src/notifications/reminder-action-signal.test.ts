import { beforeEach, describe, expect, it } from "vitest";
import {
  consumeReminderActionOutcome,
  publishReminderActionOutcome,
  resetReminderActionSignalForTest,
  subscribeReminderActionOutcome,
  type ReminderActionOutcome,
} from "./reminder-action-signal";

function outcome(taskId = "task-1"): ReminderActionOutcome {
  return { taskId, action: "complete", status: "done", label: "" };
}

function failed(taskId: string): ReminderActionOutcome {
  return { taskId, action: "complete", status: "failed", label: "", reason: "network" };
}

describe("reminder-action-signal (Checkpoint 9.4)", () => {
  beforeEach(() => {
    resetReminderActionSignalForTest();
  });

  it("delivers a published outcome to a live subscriber", () => {
    const received: ReminderActionOutcome[] = [];
    subscribeReminderActionOutcome((value) => received.push(value));

    publishReminderActionOutcome(outcome());

    expect(received).toEqual([outcome()]);
  });

  it("delivers the pending outcome immediately on subscribe (the cold-start case: published before the task screen mounted)", () => {
    publishReminderActionOutcome(outcome());

    const received: ReminderActionOutcome[] = [];
    subscribeReminderActionOutcome((value) => received.push(value));

    expect(received).toEqual([outcome()]);
  });

  it("subscribe does NOT clear the pending outcome; consume does", () => {
    publishReminderActionOutcome(outcome());
    subscribeReminderActionOutcome(() => undefined);

    expect(consumeReminderActionOutcome("task-1")).toEqual(outcome());
    expect(consumeReminderActionOutcome("task-1")).toBeNull();
  });

  it("consume returns null and leaves the outcome in place for a different task", () => {
    publishReminderActionOutcome(outcome("task-2"));

    expect(consumeReminderActionOutcome("task-1")).toBeNull();
    expect(consumeReminderActionOutcome("task-2")).toEqual(outcome("task-2"));
  });

  it("the most recent outcome wins (exactly one can be pending)", () => {
    publishReminderActionOutcome(outcome("task-1"));
    publishReminderActionOutcome(failed("task-2"));

    expect(consumeReminderActionOutcome("task-1")).toBeNull();
    expect(consumeReminderActionOutcome("task-2")).toEqual(
      failed("task-2"),
    );
  });

  it("unsubscribe stops delivery", () => {
    const received: ReminderActionOutcome[] = [];
    const unsubscribe = subscribeReminderActionOutcome((value) => received.push(value));
    unsubscribe();

    publishReminderActionOutcome(outcome());

    expect(received).toEqual([]);
  });

  it("a subscriber that consumed the outcome is not re-delivered it by a later subscribe", () => {
    publishReminderActionOutcome(outcome());
    expect(consumeReminderActionOutcome("task-1")).toEqual(outcome());

    const received: ReminderActionOutcome[] = [];
    subscribeReminderActionOutcome((value) => received.push(value));

    expect(received).toEqual([]);
  });
});
