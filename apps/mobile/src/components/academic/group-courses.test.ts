import { describe, expect, it } from "vitest";
import { course } from "./fixtures.test-support";
import { NO_TERM_LABEL, groupCoursesByTerm } from "./group-courses";

describe("groupCoursesByTerm", () => {
  it("groups by term name in encounter order -- the server's most-recent-first order", () => {
    const groups = groupCoursesByTerm([
      course({
        id: "a",
        term: { name: "Fall 2026", starts_at: "2026-08-24T05:00:00Z", ends_at: null },
      }),
      course({
        id: "b",
        term: { name: "Fall 2026", starts_at: "2026-08-24T05:00:00Z", ends_at: null },
      }),
      course({
        id: "c",
        term: { name: "Summer 2026", starts_at: "2026-06-01T05:00:00Z", ends_at: null },
      }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Fall 2026", "Summer 2026"]);
    expect(groups[0]!.courses.map((c) => c.id)).toEqual(["a", "b"]);
    expect(groups[1]!.courses.map((c) => c.id)).toEqual(["c"]);
  });

  it("does not re-sort: a term's position is fixed by its first course", () => {
    // If the server ever interleaves, the client reflects the server rather
    // than inventing a second ordering rule.
    const groups = groupCoursesByTerm([
      course({ id: "a", term: { name: "Spring 2026", starts_at: null, ends_at: null } }),
      course({ id: "b", term: { name: "Fall 2026", starts_at: null, ends_at: null } }),
      course({ id: "c", term: { name: "Spring 2026", starts_at: null, ends_at: null } }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Spring 2026", "Fall 2026"]);
    expect(groups[0]!.courses.map((c) => c.id)).toEqual(["a", "c"]);
  });

  it("puts courses with no term under one trailing 'No term' group, shown rather than dropped", () => {
    const groups = groupCoursesByTerm([
      course({ id: "n1", term: { name: null, starts_at: null, ends_at: null } }),
      course({ id: "a", term: { name: "Fall 2026", starts_at: null, ends_at: null } }),
      course({ id: "n2", term: { name: "   ", starts_at: null, ends_at: null } }),
    ]);
    expect(groups.map((g) => g.title)).toEqual(["Fall 2026", NO_TERM_LABEL]);
    expect(groups[1]!.courses.map((c) => c.id)).toEqual(["n1", "n2"]);
  });

  it("returns no groups for no courses", () => {
    expect(groupCoursesByTerm([])).toEqual([]);
  });
});
