import { describe, expect, it } from "vitest";
import {
  actionsHeroCounts,
  actionsHeroGradient,
  actionsHeroHeadline,
  buildUndoRequest,
  capabilitiesAllowedLine,
  coerceActionTabParam,
  groupHistoryByDay,
  historyItems,
  pendingRowSpoken,
  pendingRowSubtitle,
  undoAvailability,
} from "./action-center-state";
import {
  TARGET_ID,
  completeTaskRequest,
  createEventRequest,
  createTaskRequest,
  summary,
} from "./fixtures.test-support";

describe("the hero", () => {
  it("names the pending count, singular and plural, and is calm at zero", () => {
    expect(actionsHeroHeadline(0)).toBe("Nothing waiting");
    expect(actionsHeroHeadline(1)).toBe("1 action needs you");
    expect(actionsHeroHeadline(3)).toBe("3 actions need you");
    expect(actionsHeroGradient(0)).toBe("calm");
    expect(actionsHeroGradient(2)).toBe("warm");
  });

  it("lists pending, done this week and allowed, in order", () => {
    expect(actionsHeroCounts(summary())).toEqual([
      { key: "pending", label: "Pending", value: 2 },
      { key: "completed", label: "Done this week", value: 5 },
      { key: "allowed", label: "Allowed", value: 2 },
    ]);
  });

  it("counts capabilities honestly", () => {
    expect(capabilitiesAllowedLine({ permissions_granted: 1, permissions_total: 2 })).toBe(
      "1 of 2 capabilities allowed",
    );
    expect(capabilitiesAllowedLine({ permissions_granted: 1, permissions_total: 1 })).toBe(
      "1 of 1 capability allowed",
    );
  });
});

describe("tabs", () => {
  it("coerces a ?tab= param to a known tab, defaulting to pending", () => {
    expect(coerceActionTabParam("history")).toBe("history");
    expect(coerceActionTabParam("permissions")).toBe("permissions");
    expect(coerceActionTabParam("nope")).toBe("pending");
    expect(coerceActionTabParam(undefined)).toBe("pending");
    expect(coerceActionTabParam(["history"])).toBe("pending");
  });
});

describe("pending rows", () => {
  it("subtitle is the reason, else the source", () => {
    expect(pendingRowSubtitle(createTaskRequest())).toBe("Track this assignment as a task");
    expect(pendingRowSubtitle(completeTaskRequest())).toBe("From You");
    expect(pendingRowSubtitle(createEventRequest({ reason: null }))).toBe("From Focus Now");
  });

  it("is spoken with its summary, reason and what a tap does", () => {
    expect(pendingRowSpoken(completeTaskRequest())).toBe(
      "Complete task: Call the insurance guy. You asked for this. Opens the approval sheet",
    );
  });
});

describe("history", () => {
  const now = Date.UTC(2026, 8, 17, 20, 0, 0); // 15:00 America/Chicago

  it("keeps only the rows no longer waiting on the owner", () => {
    const items = [
      createTaskRequest({
        id: "1".repeat(8) + "-1111-4111-8111-111111111111",
        status: "completed",
      }),
      createTaskRequest({ id: "2".repeat(8) + "-2222-4222-8222-222222222222" }),
      createTaskRequest({
        id: "3".repeat(8) + "-3333-4333-8333-333333333333",
        status: "executing",
      }),
      createTaskRequest({ id: "4".repeat(8) + "-4444-4444-8444-444444444444", status: "expired" }),
    ];
    expect(historyItems(items).map((item) => item.status)).toEqual(["completed", "expired"]);
  });

  it("groups by the local day the row finished (else was requested), labelled Today / Yesterday / a date, newest first", () => {
    const today = createTaskRequest({
      id: "11111111-1111-4111-8111-111111111111",
      status: "completed",
      finished_at: "2026-09-17T18:30:00Z",
    });
    const yesterday = createEventRequest({
      id: "22222222-2222-4222-8222-222222222222",
      status: "cancelled",
      finished_at: "2026-09-17T03:30:00Z", // 22:30 on the 16th in Chicago
    });
    const older = completeTaskRequest({
      id: "33333333-3333-4333-8333-333333333333",
      status: "expired",
      finished_at: null,
      requested_at: "2026-09-10T15:00:00Z",
    });
    const groups = groupHistoryByDay([today, yesterday, older], {
      timeZone: "America/Chicago",
      now,
    });
    expect(groups.map((group) => [group.date, group.label, group.items.length])).toEqual([
      ["2026-09-17", "Today", 1],
      ["2026-09-16", "Yesterday", 1],
      ["2026-09-10", "Sep 10", 1],
    ]);
  });
});

describe("undo", () => {
  it("is available only for a completed, reversible request with a target that has not been reversed", () => {
    expect(undoAvailability(createTaskRequest({ status: "completed", target_id: TARGET_ID }))).toBe(
      "available",
    );
    expect(
      undoAvailability(
        createTaskRequest({
          status: "completed",
          target_id: TARGET_ID,
          reversed_by_request_id: "99999999-9999-4999-8999-999999999999",
        }),
      ),
    ).toBe("undone");
    expect(undoAvailability(createTaskRequest({ status: "completed", target_id: null }))).toBe(
      "none",
    );
    expect(undoAvailability(createTaskRequest({ status: "failed", target_id: TARGET_ID }))).toBe(
      "none",
    );
    expect(
      undoAvailability(
        createTaskRequest({ action_id: "archive_task", status: "completed", target_id: TARGET_ID }),
      ),
    ).toBe("none");
  });

  it("builds the reversal request over the completed request's target, manual, reasoned, linked back", () => {
    const request = buildUndoRequest(
      createTaskRequest({ status: "completed", target_id: TARGET_ID }),
    );
    expect(request).toEqual({
      action_id: "archive_task",
      input: { task_id: TARGET_ID },
      source: "manual",
      reason: "Undo: Create task: Project milestone 2",
      reverses_request_id: createTaskRequest().id,
    });
    const event = buildUndoRequest(
      createEventRequest({ status: "completed", target_id: TARGET_ID }),
    );
    expect(event).toMatchObject({
      action_id: "archive_calendar_event",
      input: { event_id: TARGET_ID },
    });
    const complete = buildUndoRequest(
      completeTaskRequest({ status: "completed", target_id: TARGET_ID }),
    );
    expect(complete).toMatchObject({ action_id: "reopen_task", input: { task_id: TARGET_ID } });
  });

  it("builds nothing when no undo is available, and bounds the reason", () => {
    expect(buildUndoRequest(createTaskRequest())).toBeNull();
    const long = buildUndoRequest(
      createTaskRequest({
        status: "completed",
        target_id: TARGET_ID,
        input_summary: "x".repeat(300),
      }),
    );
    expect(long?.reason?.length).toBe(160);
  });
});
