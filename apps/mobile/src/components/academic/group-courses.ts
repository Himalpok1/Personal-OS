import type { AcademicCourseSummary } from "@personal-os/schema";

// Groups the course list by term for the /academic screen (Checkpoint 10.2).
// Pure and React-free.
//
// Grouping is in ENCOUNTER order, deliberately: AcademicCoursesResponseSchema
// already orders items by term start descending (nulls last), then code,
// then name, then id, so walking the list and opening a new group each time
// the term name changes yields "most recent term first" without this client
// holding a second copy of the sort rule. A course with no term lands under
// one trailing "No term" group -- shown, never hidden, the same
// absence-is-shown posture health/index.tsx takes for an unknown metric.

/** The label a course with `term.name === null` groups under. */
export const NO_TERM_LABEL = "No term";

export interface CourseTermGroup {
  /** The term name, or NO_TERM_LABEL. Unique across the returned groups. */
  title: string;
  courses: AcademicCourseSummary[];
}

export function groupCoursesByTerm(courses: readonly AcademicCourseSummary[]): CourseTermGroup[] {
  const byTitle = new Map<string, CourseTermGroup>();
  for (const course of courses) {
    const name = course.term.name?.trim() ?? "";
    const title = name.length > 0 ? name : NO_TERM_LABEL;
    let group = byTitle.get(title);
    if (group === undefined) {
      group = { title, courses: [] };
      byTitle.set(title, group);
    }
    group.courses.push(course);
  }
  // A Map preserves insertion order, so the first course of each term fixes
  // that term's position -- the server's own order. The one exception is the
  // no-term bucket, which is not a term and always trails, whatever position
  // its first course happened to arrive in.
  const groups = [...byTitle.values()];
  const noTerm = byTitle.get(NO_TERM_LABEL);
  return noTerm === undefined ? groups : [...groups.filter((g) => g !== noTerm), noTerm];
}
