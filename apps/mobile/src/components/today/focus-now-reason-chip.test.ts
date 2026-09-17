import { ACADEMIC_PRIORITY_REASONS } from "@personal-os/core/academic/urgency";
import { FOCUS_NOW_REASON_LABEL } from "@personal-os/core/focus-now/explain";
import {
  FOCUS_NOW_CONTEXT_REASONS,
  FOCUS_NOW_REASON_ORDER,
} from "@personal-os/core/focus-now/score";
import { describe, expect, it } from "vitest";
import { FOCUS_NOW_REASON_CHIP, focusNowReasonChips } from "./focus-now-reason-chip";

describe("FOCUS_NOW_REASON_CHIP", () => {
  it("covers every academic reason, the task-only reason, the six context reasons (ADR-075) and the two memory reasons (ADR-077)", () => {
    const keys = Object.keys(FOCUS_NOW_REASON_CHIP).sort();
    expect(keys).toEqual(
      [...ACADEMIC_PRIORITY_REASONS, "top_priority", ...FOCUS_NOW_CONTEXT_REASONS].sort(),
    );
    expect(keys).toEqual([...FOCUS_NOW_REASON_ORDER].sort());
  });

  it("uses core's own label for every reason, so the chip and the sheet never disagree", () => {
    for (const reason of FOCUS_NOW_REASON_ORDER) {
      expect(FOCUS_NOW_REASON_CHIP[reason].label).toBe(FOCUS_NOW_REASON_LABEL[reason]);
    }
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

  it("tones the six context reasons as ADR-075 §2 reads them", () => {
    expect(FOCUS_NOW_REASON_CHIP.linked_assignment).toEqual({
      tone: "primary",
      label: "Linked assignment",
    });
    expect(FOCUS_NOW_REASON_CHIP.project_stalled).toEqual({
      tone: "warning",
      label: "Project stalled",
    });
    expect(FOCUS_NOW_REASON_CHIP.course_attention_high).toEqual({
      tone: "warning",
      label: "Course needs attention",
    });
    expect(FOCUS_NOW_REASON_CHIP.no_submission).toEqual({
      tone: "neutral",
      label: "Not submitted",
    });
    expect(FOCUS_NOW_REASON_CHIP.reminder_set).toEqual({ tone: "neutral", label: "Reminder set" });
    expect(FOCUS_NOW_REASON_CHIP.snoozed).toEqual({ tone: "info", label: "Snoozed" });
  });

  it("tones the two memory reasons as a nudge and an affirmation, never an urgency (ADR-077 §5)", () => {
    expect(FOCUS_NOW_REASON_CHIP.matches_preference).toEqual({
      tone: "primary",
      label: "Matches your preference",
    });
    expect(FOCUS_NOW_REASON_CHIP.supports_goal).toEqual({
      tone: "success",
      label: "Supports a goal",
    });
  });
});

describe("focusNowReasonChips", () => {
  it("maps reasons to chips in order", () => {
    expect(focusNowReasonChips(["overdue", "top_priority", "linked_assignment"])).toEqual([
      { tone: "danger", label: "Overdue" },
      { tone: "primary", label: "P1" },
      { tone: "primary", label: "Linked assignment" },
    ]);
  });

  it("is empty for no reasons", () => {
    expect(focusNowReasonChips([])).toEqual([]);
  });
});
