import { ACADEMIC_PRIORITY_REASONS } from "@personal-os/core/academic/urgency";
import { describe, expect, it } from "vitest";
import { FOCUS_NOW_REASON_CHIP, focusNowReasonChips } from "./focus-now-reason-chip";

describe("FOCUS_NOW_REASON_CHIP", () => {
  it("covers every academic reason plus the one task-only reason", () => {
    const keys = Object.keys(FOCUS_NOW_REASON_CHIP).sort();
    expect(keys).toEqual([...ACADEMIC_PRIORITY_REASONS, "top_priority"].sort());
  });

  it("matches the Academics card's own words for every reason the two share", () => {
    // components/academic/urgency-chip.ts's urgencyChip() vocabulary.
    expect(FOCUS_NOW_REASON_CHIP.overdue).toEqual({ tone: "danger", label: "Overdue" });
    expect(FOCUS_NOW_REASON_CHIP.due_within_24h).toEqual({ tone: "warning", label: "Due <24h" });
    expect(FOCUS_NOW_REASON_CHIP.due_this_week).toEqual({ tone: "info", label: "This week" });
  });

  it("has a distinct chip for the task-only reason", () => {
    expect(FOCUS_NOW_REASON_CHIP.top_priority).toEqual({ tone: "primary", label: "P1" });
  });
});

describe("focusNowReasonChips", () => {
  it("maps reasons to chips in order", () => {
    expect(focusNowReasonChips(["overdue", "top_priority"])).toEqual([
      { tone: "danger", label: "Overdue" },
      { tone: "primary", label: "P1" },
    ]);
  });

  it("is empty for no reasons", () => {
    expect(focusNowReasonChips([])).toEqual([]);
  });
});
