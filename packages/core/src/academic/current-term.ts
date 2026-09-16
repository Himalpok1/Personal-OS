// The "current term" rule for the academic surfaces (Checkpoint 10.2, owner
// decision 2026-09-16, ADR-070a): Today's academic card, the course list and
// everything derived from them show ONLY courses in the current term -- the
// owner's account carries Spring 2026 courses and undated "Default Term"
// compliance trainings whose long-overdue assignments were crowding out the
// Fall 2026 work that actually matters.
//
// DETERMINISTIC AND DATE-DRIVEN, NEVER A HARD-CODED NAME. The current term is
// the most recently STARTED term: among the courses' `term_start_at` values
// that are at or before `effectiveNow`, the latest instant. A course belongs
// to the current term iff its `term_start_at` equals that instant (identity is
// the start instant, not the name, so two Canvas terms that genuinely start
// together both count). Consequences, all intended:
//   - a course with no `term_start_at` (Canvas's "Default Term") is never
//     current, whatever its name;
//   - a term that has ENDED stays current until the next one STARTS (the gap
//     between Fall and Spring shows Fall's courses, not nothing);
//   - the rule rolls over on its own the day the next term starts; nothing
//     needs editing each semester;
//   - when NO course carries a started term (an institution that sets no term
//     dates), there is no basis to filter and every course is treated as
//     current -- `selectCurrentTerm` returns null and `isInCurrentTerm` is
//     then true for every course.
//
// Pure and client-safe: no clock read (the caller passes the build's one
// `effectiveNow`), no I/O.

export interface AcademicTermSource {
  termName: string | null;
  termStartAt: Date | null;
}

export interface CurrentTerm {
  /** The name of the first course (in input order) found in the term; informational only. */
  name: string | null;
  startsAt: Date;
}

/**
 * The most recently started term across `courses`, or null when no course
 * carries a `term_start_at` at or before `effectiveNow`.
 */
export function selectCurrentTerm(
  courses: readonly AcademicTermSource[],
  effectiveNow: Date,
): CurrentTerm | null {
  let best: CurrentTerm | null = null;
  for (const course of courses) {
    const start = course.termStartAt;
    if (start === null || start.getTime() > effectiveNow.getTime()) continue;
    if (best === null || start.getTime() > best.startsAt.getTime()) {
      best = { name: course.termName, startsAt: start };
    }
  }
  return best;
}

/**
 * Whether `course` is in `current`. With no current term (null) every course
 * is current -- see the module comment for why that is the honest default.
 */
export function isInCurrentTerm(course: AcademicTermSource, current: CurrentTerm | null): boolean {
  if (current === null) return true;
  return course.termStartAt !== null && course.termStartAt.getTime() === current.startsAt.getTime();
}
