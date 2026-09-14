import { ApiClientError } from "@personal-os/api-client";
import { describe, expect, it } from "vitest";
import {
  availableTaskActions,
  canSnoozeTask,
  classifySnoozeError,
  classifyTaskActionError,
  completionTarget,
  describeTaskStatus,
  detailCompletionTarget,
  GENERIC_SNOOZE_MESSAGE,
  GENERIC_TASK_ACTION_MESSAGE,
  isTaskOpen,
  localSnoozeLineVisible,
  nextOccurrenceLine,
  NO_OPEN_OCCURRENCE_MESSAGE,
  NO_UPCOMING_OCCURRENCE_MESSAGE,
  noUpcomingOccurrenceLine,
  canOfferUndo,
  selectUndoableOccurrence,
  snoozeTarget,
  UNDO_ALREADY_UNDONE_MESSAGE,
  UNDO_REOPEN_TASK_FIRST_MESSAGE,
  UNDO_WINDOW_MS,
  undoLabel,
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

// ---------------------------------------------------------------------------
// Checkpoint 9.4: recurring tasks act on their next OCCURRENCE.

const NEXT = { id: OCCURRENCE_ID, effective_at: "2026-09-15T14:00:00.000Z", overdue: false, snoozed: false };

describe("detailCompletionTarget", () => {
  it("prefers the known next occurrence of a recurring task", () => {
    expect(detailCompletionTarget({ id: "task-1", rrule: "FREQ=DAILY" }, NEXT)).toEqual({
      kind: "occurrence",
      occurrenceId: OCCURRENCE_ID,
    });
  });

  it("falls back to the task endpoint when no occurrence is known, or the task is one-off", () => {
    expect(detailCompletionTarget({ id: "task-1", rrule: "FREQ=DAILY" }, null)).toEqual({
      kind: "task",
      taskId: "task-1",
    });
    // A one-off task never targets an occurrence, even if a caller passes one.
    expect(detailCompletionTarget({ id: "task-1", rrule: null }, NEXT)).toEqual({
      kind: "task",
      taskId: "task-1",
    });
  });
});

describe("snoozeTarget", () => {
  it("PATCHes a one-off open task (the 9.3 behaviour)", () => {
    expect(snoozeTarget({ id: "task-1", status: "active", rrule: null }, null)).toEqual({
      kind: "task",
      taskId: "task-1",
    });
    expect(snoozeTarget({ id: "task-1", status: "inbox", rrule: null }, null)).toEqual({
      kind: "task",
      taskId: "task-1",
    });
  });

  it("snoozes the next occurrence of a recurring task, only when it is known", () => {
    expect(snoozeTarget({ id: "task-1", status: "active", rrule: "FREQ=DAILY" }, NEXT)).toEqual({
      kind: "occurrence",
      occurrenceId: OCCURRENCE_ID,
    });
    expect(snoozeTarget({ id: "task-1", status: "active", rrule: "FREQ=DAILY" }, null)).toBeNull();
  });

  it("offers nothing on a closed task", () => {
    expect(snoozeTarget({ id: "task-1", status: "done", rrule: null }, null)).toBeNull();
    expect(snoozeTarget({ id: "task-1", status: "dropped", rrule: "FREQ=DAILY" }, NEXT)).toBeNull();
  });
});

describe("nextOccurrenceLine", () => {
  it("names the effective instant and the overdue tone", () => {
    const line = nextOccurrenceLine(NEXT);
    expect(line).not.toBeNull();
    expect(line!.text.startsWith("Next: ")).toBe(true);
    expect(line!.text).not.toContain("snoozed");
    expect(line!.overdue).toBe(false);

    const overdue = nextOccurrenceLine({ ...NEXT, overdue: true });
    expect(overdue!.overdue).toBe(true);
  });

  it("says so when the instance was snoozed", () => {
    expect(nextOccurrenceLine({ ...NEXT, snoozed: true })!.text.endsWith(" · snoozed")).toBe(true);
  });

  it("is null with no next occurrence, or an instant that will not format", () => {
    expect(nextOccurrenceLine(null)).toBeNull();
    expect(nextOccurrenceLine({ ...NEXT, effective_at: "garbage" })).toBeNull();
  });
});

describe("selectUndoableOccurrence", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();
  const HOUR = 60 * 60 * 1000;
  const DAY = 24 * HOUR;

  it("picks the latest done or skipped row within the window", () => {
    const items = [
      { id: "a", status: "done", completed_at: ago(3 * DAY) },
      { id: "b", status: "skipped", completed_at: ago(2 * HOUR) },
      { id: "c", status: "done", completed_at: ago(1 * DAY) },
      { id: "d", status: "scheduled", completed_at: null },
    ];
    expect(selectUndoableOccurrence(items, now)).toEqual({ id: "b", action: "skipped" });
    expect(undoLabel("skipped")).toBe("Undo last Skip");
    expect(undoLabel("done")).toBe("Undo last Done");
  });

  it("ignores anything older than the window, and rows without completed_at", () => {
    expect(
      selectUndoableOccurrence(
        [
          { id: "old", status: "done", completed_at: ago(UNDO_WINDOW_MS + 1) },
          { id: "no-stamp", status: "done", completed_at: null },
          { id: "scheduled", status: "scheduled", completed_at: null },
        ],
        now,
      ),
    ).toBeNull();
    // The boundary itself is inside.
    expect(
      selectUndoableOccurrence([{ id: "edge", status: "done", completed_at: ago(UNDO_WINDOW_MS) }], now),
    ).toEqual({ id: "edge", action: "done" });
  });

  it("breaks an exact tie by id so the choice is a total order", () => {
    const at = ago(HOUR);
    expect(
      selectUndoableOccurrence(
        [
          { id: "aaa", status: "done", completed_at: at },
          { id: "bbb", status: "skipped", completed_at: at },
        ],
        now,
      ),
    ).toEqual({ id: "bbb", action: "skipped" });
  });

  it("is null for an empty list", () => {
    expect(selectUndoableOccurrence([], now)).toBeNull();
  });
});

describe("canOfferUndo", () => {
  it("offers Undo only on an open recurring parent -- never on a done or dropped one", () => {
    expect(canOfferUndo({ status: "active", rrule: "FREQ=DAILY" })).toBe(true);
    expect(canOfferUndo({ status: "inbox", rrule: "FREQ=DAILY" })).toBe(true);
    expect(canOfferUndo({ status: "done", rrule: "FREQ=DAILY" })).toBe(false);
    expect(canOfferUndo({ status: "dropped", rrule: "FREQ=DAILY" })).toBe(false);
    expect(canOfferUndo({ status: "active", rrule: null })).toBe(false);
  });
});

describe("noUpcomingOccurrenceLine", () => {
  it("names a recurring task whose scheduled query has loaded empty", () => {
    expect(
      noUpcomingOccurrenceLine({ rrule: "FREQ=DAILY", scheduledLoaded: true, scheduledCount: 0 }),
    ).toBe(NO_UPCOMING_OCCURRENCE_MESSAGE);
    expect(NO_UPCOMING_OCCURRENCE_MESSAGE).toBe("No upcoming occurrence — check the repeat rule");
  });

  it("stays quiet while loading, when a row exists, and for a one-off", () => {
    expect(
      noUpcomingOccurrenceLine({ rrule: "FREQ=DAILY", scheduledLoaded: false, scheduledCount: 0 }),
    ).toBeNull();
    expect(
      noUpcomingOccurrenceLine({ rrule: "FREQ=DAILY", scheduledLoaded: true, scheduledCount: 3 }),
    ).toBeNull();
    expect(noUpcomingOccurrenceLine({ rrule: null, scheduledLoaded: true, scheduledCount: 0 })).toBeNull();
  });
});

describe("localSnoozeLineVisible", () => {
  const AT = "2026-09-15T14:00:00.000Z";

  it("is hidden with nothing snoozed locally", () => {
    expect(localSnoozeLineVisible({ snoozedUntil: null, recurring: false, next: null })).toBe(false);
  });

  it("always shows for a one-off task (the only feedback there is)", () => {
    expect(localSnoozeLineVisible({ snoozedUntil: AT, recurring: false, next: null })).toBe(true);
  });

  it("for a recurring task, yields to the Next line once it reports the snooze", () => {
    // Before the refetch: the Next line still shows the pre-snooze instant.
    expect(
      localSnoozeLineVisible({ snoozedUntil: AT, recurring: true, next: { snoozed: false } }),
    ).toBe(true);
    expect(localSnoozeLineVisible({ snoozedUntil: AT, recurring: true, next: null })).toBe(true);
    // After: "Next: … · snoozed" says it, so the local line would say it twice.
    expect(
      localSnoozeLineVisible({ snoozedUntil: AT, recurring: true, next: { snoozed: true } }),
    ).toBe(false);
  });
});

describe("classifyTaskActionError (9.4 occurrence codes)", () => {
  it("tells the two reopen 409s apart: already undone vs. reopen the task first", () => {
    expect(
      classifyTaskActionError(
        new ApiClientError(409, "occurrence_not_reopenable", { error: "occurrence_not_reopenable" }),
      ),
    ).toEqual({ kind: "message", message: UNDO_ALREADY_UNDONE_MESSAGE });
    expect(
      classifyTaskActionError(new ApiClientError(409, "task_not_open", { error: "task_not_open" })),
    ).toEqual({ kind: "message", message: UNDO_REOPEN_TASK_FIRST_MESSAGE });
    expect(UNDO_ALREADY_UNDONE_MESSAGE).toBe("Already undone.");
    expect(UNDO_REOPEN_TASK_FIRST_MESSAGE).toBe("Reopen the task first.");
  });

  it("explains a snooze on a terminal occurrence", () => {
    const result = classifyTaskActionError(
      new ApiClientError(409, "occurrence_not_open", { error: "occurrence_not_open" }),
    );
    expect(result.kind).toBe("message");
    expect(result.kind === "message" && result.message).not.toContain("API error");
  });
});

describe("classifySnoozeError", () => {
  it("names an out-of-range target, reuses the 404/409 wording, and is generic otherwise", () => {
    expect(classifySnoozeError(new ApiClientError(400, "validation_failed"))).toBe(
      "Couldn't snooze to that time.",
    );
    expect(classifySnoozeError(new ApiClientError(404, "not_found"))).toBe(
      "This task couldn't be found.",
    );
    expect(classifySnoozeError(new ApiClientError(409, "occurrence_not_open"))).toBe(
      "That one has already been completed or skipped.",
    );
    for (const err of [new ApiClientError(500, "internal_error"), new TypeError("Network")]) {
      expect(classifySnoozeError(err)).toBe(GENERIC_SNOOZE_MESSAGE);
    }
  });
});
