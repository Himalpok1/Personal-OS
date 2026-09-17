import { describe, expect, it } from "vitest";
import { MAX_FOCUS_CHIPS, courseFocusRow } from "./course-focus";
import { academicToday } from "./fixtures.test-support";

function attention(
  overrides: Partial<{
    course_id: string;
    course_name: string;
    course_code: string | null;
    open_total: number;
    overdue_total: number;
    due_within_24h_total: number;
    due_this_week_total: number;
    next_due_at: string | null;
    attention: "high" | "medium" | "low" | "none";
  }> = {},
) {
  return {
    course_id: "10300000-0000-4000-8000-000000000101",
    course_name: "ADVANCED WEB DEVELOPMENT",
    course_code: "INSY-4315",
    open_total: 3,
    overdue_total: 0,
    due_within_24h_total: 0,
    due_this_week_total: 1,
    next_due_at: null,
    attention: "medium" as const,
    ...overrides,
  };
}

describe("courseFocusRow", () => {
  it("is null when the server predates course_attention or nothing needs focus", () => {
    const base = academicToday();
    expect(courseFocusRow({ ...base, course_attention: undefined })).toBeNull();
    expect(courseFocusRow({ ...base, course_attention: { items: [], total: 0 } })).toBeNull();
    expect(
      courseFocusRow({
        ...base,
        course_attention: { items: [attention({ attention: "low" })], total: 1 },
      }),
    ).toBeNull();
  });

  it("chips high as danger and medium as warning, in the server's order, with the reason spoken", () => {
    const row = courseFocusRow({
      ...academicToday(),
      course_attention: {
        items: [
          attention({ course_id: "a", attention: "high", overdue_total: 2 }),
          attention({
            course_id: "b",
            attention: "high",
            due_within_24h_total: 1,
            course_code: null,
          }),
          attention({ course_id: "c", attention: "medium" }),
          attention({ course_id: "d", attention: "low" }),
        ],
        total: 4,
      },
    });
    expect(row).not.toBeNull();
    expect(row!.chips.map((c) => [c.courseId, c.tone, c.reason])).toEqual([
      ["a", "danger", "2 overdue"],
      ["b", "danger", "due in 24h"],
      ["c", "warning", "due this week"],
    ]);
    // The code when Canvas has one, else the full name.
    expect(row!.chips[0]!.label).toBe("INSY-4315");
    expect(row!.chips[1]!.label).toBe("ADVANCED WEB DEVELOPMENT");
    expect(row!.hiddenCount).toBe(0);
  });

  it("caps the chips and counts the rest honestly", () => {
    const items = Array.from({ length: MAX_FOCUS_CHIPS + 2 }, (_, i) =>
      attention({ course_id: `c${i}`, attention: "high", overdue_total: 1 }),
    );
    const row = courseFocusRow({
      ...academicToday(),
      course_attention: { items, total: items.length },
    });
    expect(row!.chips).toHaveLength(MAX_FOCUS_CHIPS);
    expect(row!.hiddenCount).toBe(2);
  });
});
