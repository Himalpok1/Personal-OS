import { ACTION_ERROR_CLASSES, ACTION_REGISTRY, ACTION_SOURCES } from "@personal-os/schema";
import { describe, expect, it } from "vitest";
import {
  ACTION_REASON_FALLBACK,
  ACTION_SOURCE_LABEL,
  actionChipStrip,
  actionErrorLabel,
  actionReasonText,
  actionSourceChip,
  actionStatusChip,
  reversibilityChip,
  riskChip,
  whatWillChangeRows,
  whatWillChangeSpoken,
} from "./action-approval-sheet-state";
import {
  completeTaskRequest,
  createEventRequest,
  createTaskRequest,
} from "./fixtures.test-support";

describe("the chip strip", () => {
  it("leads with capability, then reversibility, then risk, all from the registry", () => {
    const chips = actionChipStrip(ACTION_REGISTRY.create_calendar_event);
    expect(chips.map((chip) => chip.label)).toEqual(["Calendar", "Reversible", "Medium risk"]);
    expect(chips[0]?.icon).toBe("calendar-month");
    expect(chips[1]?.tone).toBe("success");
    expect(chips[2]?.tone).toBe("warning");
  });

  it("says Hard to undo for an action the registry marks irreversible", () => {
    expect(reversibilityChip(ACTION_REGISTRY.archive_task)).toMatchObject({
      label: "Hard to undo",
      tone: "warning",
    });
    expect(reversibilityChip(ACTION_REGISTRY.complete_task)).toMatchObject({
      label: "Reversible",
      tone: "success",
    });
  });

  it("names every risk level with a tone that reads as its weight", () => {
    expect(riskChip("low")).toEqual({ label: "Low risk", tone: "neutral" });
    expect(riskChip("medium")).toEqual({ label: "Medium risk", tone: "warning" });
    expect(riskChip("high")).toEqual({ label: "High risk", tone: "danger" });
  });
});

describe("why", () => {
  it("labels every closed source, and only a manual request reads as You", () => {
    for (const source of ACTION_SOURCES) {
      expect(ACTION_SOURCE_LABEL[source]).toBeTruthy();
    }
    expect(actionSourceChip("focus_now")).toEqual({ label: "Focus Now", tone: "info" });
    expect(actionSourceChip("briefing")).toEqual({ label: "Briefing", tone: "info" });
    expect(actionSourceChip("academic")).toEqual({ label: "Academics", tone: "info" });
    expect(actionSourceChip("manual")).toEqual({ label: "You", tone: "neutral" });
  });

  it("renders the client-authored reason verbatim, and the honest fallback when there is none", () => {
    expect(actionReasonText({ reason: "  Due tomorrow  " })).toBe("Due tomorrow");
    expect(actionReasonText({ reason: null })).toBe(ACTION_REASON_FALLBACK);
    expect(actionReasonText({ reason: "   " })).toBe("You asked for this");
  });
});

describe("status and error words", () => {
  it("has a chip for every lifecycle state", () => {
    expect(actionStatusChip("pending").tone).toBe("warning");
    expect(actionStatusChip("completed")).toEqual({ label: "Completed", tone: "success" });
    expect(actionStatusChip("failed")).toEqual({ label: "Failed", tone: "danger" });
    expect(actionStatusChip("cancelled")).toEqual({ label: "Cancelled", tone: "neutral" });
    expect(actionStatusChip("expired")).toEqual({ label: "Expired", tone: "neutral" });
  });

  it("has a friendly line for every known error class and names an unknown one", () => {
    for (const errorClass of ACTION_ERROR_CLASSES) {
      const line = actionErrorLabel(errorClass);
      expect(line).not.toContain(errorClass);
      expect(line.length).toBeGreaterThan(10);
    }
    expect(actionErrorLabel("something_new")).toBe("The action failed (something_new).");
    expect(actionErrorLabel(null)).toBe("The action failed.");
  });
});

describe("what will change", () => {
  it("lists a create_calendar_event's title, when (in the input's own zone) and calendar link, never an id", () => {
    const rows = whatWillChangeRows(
      createEventRequest({
        input: {
          title: "Study: Project milestone 2",
          starts_at: "2026-09-17T15:00:00-05:00",
          ends_at: "2026-09-17T16:00:00-05:00",
          timezone: "America/Chicago",
          location: "Library",
          project_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        },
      }),
    );
    expect(rows.map((row) => row.label)).toEqual(["Title", "When", "Calendar", "Where", "Project"]);
    const when = rows[1]!.value;
    expect(when).toContain("Sep 17");
    expect(when).toMatch(/3:00/);
    expect(when).toMatch(/4:00/);
    expect(rows[2]!.value).toBe("Not linked");
    expect(rows[4]!.value).toBe("Linked to a project");
    expect(JSON.stringify(rows)).not.toContain("dddddddd");
  });

  it("resolves a naive datetime in the input's zone rather than the host's", () => {
    const rows = whatWillChangeRows(
      createEventRequest({
        input: {
          title: "x",
          starts_at: "2026-09-17T09:00:00",
          ends_at: "2026-09-17T10:00:00",
          timezone: "Pacific/Auckland",
        },
      }),
    );
    expect(rows[1]!.value).toMatch(/9:00/);
    expect(rows[1]!.value).toMatch(/10:00/);
  });

  it("lists a create_task's title, due, reminder, priority and the assignment link as a fact", () => {
    const rows = whatWillChangeRows(
      createTaskRequest({
        input: {
          title: "Project milestone 2",
          due_at: "2026-09-23T04:59:00Z",
          remind_at: "2026-09-22T14:00:00Z",
          priority: 1,
          canvas_assignment_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          timezone: "America/Chicago",
        },
      }),
    );
    expect(rows.map((row) => row.label)).toEqual([
      "Title",
      "Due",
      "Reminder",
      "Priority",
      "Assignment",
    ]);
    expect(rows[1]!.value).toBe("Sep 22 · 11:59 PM");
    expect(rows[3]!.value).toBe("P1");
    expect(rows[4]!.value).toBe("Linked to an assignment");
    expect(JSON.stringify(rows)).not.toContain("cccccccc");
  });

  it("says No due date for an undated task", () => {
    const rows = whatWillChangeRows(
      createTaskRequest({ input: { title: "x", timezone: "America/Chicago" } }),
    );
    expect(rows).toEqual([
      { label: "Title", value: "x" },
      { label: "Due", value: "No due date" },
    ]);
  });

  it("falls back to the input_summary alone when a frozen input no longer parses", () => {
    expect(
      whatWillChangeRows(createTaskRequest({ input: { title: "", timezone: "Nowhere/Zone" } })),
    ).toEqual([{ label: "Task", value: "Create task: Project milestone 2" }]);
    expect(whatWillChangeRows(createEventRequest({ input: { not: "an event" } }))).toEqual([
      { label: "Event", value: "Create event: Study: Project milestone 2" },
    ]);
  });

  it("shows the server's input_summary for a target action", () => {
    expect(whatWillChangeRows(completeTaskRequest())).toEqual([
      { label: "Task", value: "Complete task: Call the insurance guy" },
    ]);
  });

  it("speaks every row as label: value", () => {
    expect(
      whatWillChangeSpoken([
        { label: "Title", value: "x" },
        { label: "Due", value: "No due date" },
      ]),
    ).toBe("Title: x. Due: No due date");
  });
});
