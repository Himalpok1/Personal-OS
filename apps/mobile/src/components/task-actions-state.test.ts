import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import {
  availableTaskActions,
  canSnoozeTask,
  classifyTaskActionError,
  completionTarget,
  describeTaskStatus,
  GENERIC_TASK_ACTION_MESSAGE,
  isTaskOpen,
  NO_OPEN_OCCURRENCE_MESSAGE,
} from "./task-actions-state";

const OCCURRENCE_ID = "11111111-1111-4111-8111-111111111111";

describe("isTaskOpen", () => {
  it("is true for inbox and active, false for done and dropped", () => {
    expect(isTaskOpen("inbox")).toBe(true);
    expect(isTaskOpen("active")).toBe(true);
    expect(isTaskOpen("done")).toBe(false);
    expect(isTaskOpen("dropped")).toBe(false);
  });
});

describe("availableTaskActions", () => {
  it("offers Start only from inbox -- the API's canActivateTask rule", () => {
    expect(availableTaskActions("inbox")).toEqual(["start", "complete", "drop"]);
    expect(availableTaskActions("active")).not.toContain("start");
  });

  it("offers Complete and Drop from both open states", () => {
    expect(availableTaskActions("active")).toEqual(["complete", "drop"]);
  });

  it("offers only Reopen from done and dropped (contract 1)", () => {
    expect(availableTaskActions("done")).toEqual(["reopen"]);
    expect(availableTaskActions("dropped")).toEqual(["reopen"]);
  });

  it("never offers Reopen on an open task", () => {
    expect(availableTaskActions("inbox")).not.toContain("reopen");
    expect(availableTaskActions("active")).not.toContain("reopen");
  });
});

describe("canSnoozeTask", () => {
  it("allows snoozing an open one-off task", () => {
    expect(canSnoozeTask({ status: "active", rrule: null })).toBe(true);
    expect(canSnoozeTask({ status: "inbox", rrule: null })).toBe(true);
  });

  it("refuses a closed task", () => {
    expect(canSnoozeTask({ status: "done", rrule: null })).toBe(false);
    expect(canSnoozeTask({ status: "dropped", rrule: null })).toBe(false);
  });

  it("refuses a recurring task -- a snooze would move the whole series", () => {
    expect(canSnoozeTask({ status: "active", rrule: "FREQ=DAILY" })).toBe(false);
  });
});

describe("describeTaskStatus", () => {
  it("names each status", () => {
    expect(describeTaskStatus({ status: "inbox", completed_at: null })).toBe("New");
    expect(describeTaskStatus({ status: "active", completed_at: null })).toBe("Active");
    expect(describeTaskStatus({ status: "dropped", completed_at: null })).toBe("Dropped");
  });

  it("appends the completion time to a done task", () => {
    const line = describeTaskStatus({
      status: "done",
      completed_at: "2026-07-10T20:00:00.000Z",
    });
    expect(line.startsWith("Done · completed ")).toBe(true);
    expect(line).not.toContain("Invalid Date");
  });

  it("falls back to the bare label when completed_at is missing or unparseable", () => {
    expect(describeTaskStatus({ status: "done", completed_at: null })).toBe("Done");
    expect(describeTaskStatus({ status: "done", completed_at: "not a date" })).toBe("Done");
  });

  it("ignores completed_at on a task that is not done", () => {
    // A reopened task keeps nothing of its completion (contract 1 clears
    // completed_at), but a stale cache could still carry one.
    expect(
      describeTaskStatus({ status: "active", completed_at: "2026-07-10T20:00:00.000Z" }),
    ).toBe("Active");
  });
});

describe("classifyTaskActionError", () => {
  it("routes recurring_task_use_occurrence with an occurrence id to that occurrence", () => {
    const err = new ApiClientError(409, "recurring_task_use_occurrence", {
      error: "recurring_task_use_occurrence",
      occurrence_id: OCCURRENCE_ID,
    });
    expect(classifyTaskActionError(err)).toEqual({
      kind: "use_occurrence",
      occurrenceId: OCCURRENCE_ID,
    });
  });

  it("shows the no-open-occurrence message for recurring_task_no_open_occurrence (contract 2)", () => {
    const err = new ApiClientError(409, "recurring_task_no_open_occurrence", {
      error: "recurring_task_no_open_occurrence",
    });
    expect(classifyTaskActionError(err)).toEqual({
      kind: "message",
      message: NO_OPEN_OCCURRENCE_MESSAGE,
    });
    expect(NO_OPEN_OCCURRENCE_MESSAGE).toContain("3:00 UTC");
  });

  it("treats the pre-9.3 shape (use_occurrence with a null id) as no open occurrence", () => {
    const err = new ApiClientError(409, "recurring_task_use_occurrence", {
      error: "recurring_task_use_occurrence",
      occurrence_id: null,
    });
    expect(classifyTaskActionError(err)).toEqual({
      kind: "message",
      message: NO_OPEN_OCCURRENCE_MESSAGE,
    });
  });

  it("never follows a non-string occurrence_id", () => {
    const err = new ApiClientError(409, "recurring_task_use_occurrence", {
      error: "recurring_task_use_occurrence",
      occurrence_id: 42,
    });
    expect(classifyTaskActionError(err).kind).toBe("message");
  });

  it("explains task_not_reopenable and invalid_status_transition", () => {
    expect(
      classifyTaskActionError(new ApiClientError(409, "task_not_reopenable", { status: "active" })),
    ).toEqual({ kind: "message", message: "This task can't be reopened from its current state." });
    expect(
      classifyTaskActionError(
        new ApiClientError(409, "invalid_status_transition", { status: "done" }),
      ),
    ).toEqual({ kind: "message", message: "This task can't be started from its current state." });
  });

  it("explains a 404", () => {
    expect(classifyTaskActionError(new ApiClientError(404, "not_found"))).toEqual({
      kind: "message",
      message: "This task couldn't be found.",
    });
  });

  it("falls back to a generic message for anything else, never the raw error text", () => {
    const unknown409 = new ApiClientError(409, "something_else", { error: "something_else" });
    const server = new ApiClientError(500, "internal_error");
    const network = new TypeError("Network request failed");
    for (const err of [unknown409, server, network]) {
      const result = classifyTaskActionError(err);
      expect(result).toEqual({ kind: "message", message: GENERIC_TASK_ACTION_MESSAGE });
      expect(result.kind === "message" && result.message).not.toContain("API error");
      expect(result.kind === "message" && result.message).not.toContain("Network request");
    }
  });
});

describe("completionTarget", () => {
  it("completes the occurrence directly when the row carries one -- one round trip", () => {
    expect(completionTarget({ id: "task-1", occurrence_id: OCCURRENCE_ID })).toEqual({
      kind: "occurrence",
      occurrenceId: OCCURRENCE_ID,
    });
  });

  it("completes the task when the row has no occurrence id", () => {
    expect(completionTarget({ id: "task-1" })).toEqual({ kind: "task", taskId: "task-1" });
    expect(completionTarget({ id: "task-1", occurrence_id: null })).toEqual({
      kind: "task",
      taskId: "task-1",
    });
  });
});
