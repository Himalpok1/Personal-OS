import type { AcademicCourseSummary } from "@personal-os/schema";

// The /academic hero's figures (Checkpoint 10.3). Pure and React-free.
//
// Sums only. Each course's `open_assignment_count`,
// `overdue_assignment_count` and `next_due_at` are the server's own computed
// facts (AcademicCourseSummarySchema); this adds them up across the courses
// the screen was handed and picks the earliest next-due instant. It never
// looks at an assignment, so it cannot disagree with the per-course rows.

export interface SemesterOverview {
  courseCount: number;
  openTotal: number;
  overdueTotal: number;
  /** The earliest `next_due_at` across the courses, or null when none has one. */
  nextDueAt: string | null;
}

export function semesterOverview(courses: readonly AcademicCourseSummary[]): SemesterOverview {
  let openTotal = 0;
  let overdueTotal = 0;
  let nextDueAt: string | null = null;
  let nextDueMs = Number.POSITIVE_INFINITY;
  for (const course of courses) {
    openTotal += course.open_assignment_count;
    overdueTotal += course.overdue_assignment_count;
    if (course.next_due_at !== null) {
      const ms = Date.parse(course.next_due_at);
      if (Number.isFinite(ms) && ms < nextDueMs) {
        nextDueMs = ms;
        nextDueAt = course.next_due_at;
      }
    }
  }
  return { courseCount: courses.length, openTotal, overdueTotal, nextDueAt };
}
