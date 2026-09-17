import { FOCUS_NOW_SOURCES } from "@personal-os/core/focus-now/explain";
import { describe, expect, it } from "vitest";
import {
  FOCUS_NOW_SOURCE_LABEL,
  FOCUS_NOW_SOURCE_TONE,
  focusNowSourceLabel,
} from "./focus-now-source-label";

describe("FOCUS_NOW_SOURCE_LABEL / FOCUS_NOW_SOURCE_TONE", () => {
  it("cover every closed core source plus the briefing's `health`, and nothing else", () => {
    const expected = [...FOCUS_NOW_SOURCES, "health"].sort();
    expect(Object.keys(FOCUS_NOW_SOURCE_LABEL).sort()).toEqual(expected);
    expect(Object.keys(FOCUS_NOW_SOURCE_TONE).sort()).toEqual(expected);
  });

  it("names a saved memory 'Memory' in the primary tone (ADR-077 §5)", () => {
    expect(focusNowSourceLabel("memory")).toBe("Memory");
    expect(FOCUS_NOW_SOURCE_TONE.memory).toBe("primary");
  });

  it("keeps the 10.6 words for the pre-existing sources", () => {
    expect(FOCUS_NOW_SOURCE_LABEL).toMatchObject({
      task: "Task",
      reminder: "Reminder",
      project: "Project",
      canvas_assignment: "Canvas assignment",
      course: "Course",
      calendar: "Calendar",
      health: "Health",
    });
  });
});
