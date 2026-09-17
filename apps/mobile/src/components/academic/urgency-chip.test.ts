import { describe, expect, it } from "vitest";
import { badgeChipTone, courseStatusChip, urgencyChip } from "./urgency-chip";

describe("urgencyChip", () => {
  it("maps the four urgencies to a tone and a word", () => {
    expect(urgencyChip("critical")).toEqual({ tone: "danger", label: "Overdue" });
    expect(urgencyChip("high")).toEqual({ tone: "warning", label: "Due <24h" });
    expect(urgencyChip("medium")).toEqual({ tone: "info", label: "This week" });
    expect(urgencyChip("low")).toEqual({ tone: "neutral", label: "Later" });
  });
});

describe("badgeChipTone", () => {
  it("maps format.ts's badge tones onto StatusChip tones", () => {
    expect(badgeChipTone("red")).toBe("danger");
    expect(badgeChipTone("amber")).toBe("warning");
    expect(badgeChipTone("green")).toBe("success");
    expect(badgeChipTone("neutral")).toBe("neutral");
  });
});

describe("courseStatusChip", () => {
  it("gives active no chip and the other two a word", () => {
    expect(courseStatusChip("active")).toBeNull();
    expect(courseStatusChip("completed")).toEqual({ tone: "info", label: "Completed" });
    expect(courseStatusChip("archived")).toEqual({ tone: "neutral", label: "Archived" });
  });
});
