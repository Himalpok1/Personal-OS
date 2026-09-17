import { describe, expect, it } from "vitest";
import { course } from "./fixtures.test-support";
import { semesterOverview } from "./semester-overview";

describe("semesterOverview", () => {
  it("sums the server's per-course counts and picks the earliest next due", () => {
    const overview = semesterOverview([
      course({
        id: "a",
        open_assignment_count: 3,
        overdue_assignment_count: 1,
        next_due_at: "2026-09-23T04:59:00Z",
      }),
      course({
        id: "b",
        open_assignment_count: 2,
        overdue_assignment_count: 0,
        next_due_at: "2026-09-20T04:59:00Z",
      }),
      course({ id: "c", open_assignment_count: 0, overdue_assignment_count: 2, next_due_at: null }),
    ]);
    expect(overview).toEqual({
      courseCount: 3,
      openTotal: 5,
      overdueTotal: 3,
      nextDueAt: "2026-09-20T04:59:00Z",
    });
  });

  it("has no next due when no course has one, and zeros for no courses", () => {
    expect(semesterOverview([course({ next_due_at: null })]).nextDueAt).toBeNull();
    expect(semesterOverview([])).toEqual({
      courseCount: 0,
      openTotal: 0,
      overdueTotal: 0,
      nextDueAt: null,
    });
  });

  it("ignores an unreadable next_due_at rather than picking it", () => {
    const overview = semesterOverview([
      course({ id: "a", next_due_at: "not-a-date" as string }),
      course({ id: "b", next_due_at: "2026-09-20T04:59:00Z" }),
    ]);
    expect(overview.nextDueAt).toBe("2026-09-20T04:59:00Z");
  });
});
