import type { AcademicAssignment } from "@personal-os/schema";

// Partitions a course's assignments into the four sections the course screen
// renders (Checkpoint 10.2). Pure and React-free so the rule is tested here,
// not in the screen.
//
// THE ONLY DERIVATION THIS CLIENT MAKES. `open` is the server's fact
// (packages/schema/src/academic.ts: `open ⟺ submission.status ∈
// {unsubmitted, unknown}`) and is never re-derived here. What this function
// adds is one instant comparison -- `due_at < now` -- applied ONLY to already
// open rows, to split them into overdue / upcoming, which docs/ARCHITECTURE.md
// "Today & agenda read models" rule 2 defines as an instant comparison anyway.
// The Today card does NOT do this; it renders the server's own overdue /
// due-today / due-this-week buckets verbatim.
//
// One `now` per build (rule 1): the screen captures `Date.now()` once and
// passes it in, so no two sections can disagree about which side of "now" an
// assignment falls on.

export interface AssignmentPartition {
  /** Open, `due_at` before `now`. */
  overdue: AcademicAssignment[];
  /** Open, `due_at` at or after `now`. */
  upcoming: AcademicAssignment[];
  /** Open, no `due_at`. */
  undated: AcademicAssignment[];
  /** Not open: submitted, graded or pending review, whatever the due instant. */
  closed: AcademicAssignment[];
}

/**
 * Server order is preserved inside every partition (`due_at` ascending, nulls
 * last, then title, then id -- AcademicCourseDetailResponseSchema), so the
 * screen never re-sorts. An unreadable `due_at` on an open row is treated as
 * undated rather than silently landing in "upcoming" or "overdue".
 */
export function partitionAssignments(
  assignments: readonly AcademicAssignment[],
  nowMs: number,
): AssignmentPartition {
  const result: AssignmentPartition = { overdue: [], upcoming: [], undated: [], closed: [] };
  for (const assignment of assignments) {
    if (!assignment.open) {
      result.closed.push(assignment);
      continue;
    }
    const dueMs = assignment.due_at === null ? Number.NaN : Date.parse(assignment.due_at);
    if (Number.isNaN(dueMs)) {
      result.undated.push(assignment);
    } else if (dueMs < nowMs) {
      result.overdue.push(assignment);
    } else {
      result.upcoming.push(assignment);
    }
  }
  return result;
}
