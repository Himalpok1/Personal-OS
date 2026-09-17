import type { AcademicCourseAttention, AcademicTodayResponse } from "@personal-os/schema";
import { courseLabel } from "./format";
import type { ChipTone } from "@/components/ui";

// "Which courses need focus?" (Checkpoint 10.3) -- the Today card's one-line
// answer, read straight off the server's `course_attention` section. Pure and
// React-free like its siblings: the card only lays out what this returns.
//
// Only `high` and `medium` attention earn a chip; `low` ("something is open,
// nothing is due soon") is every course in a normal week and would make the
// row meaningless. The server never lists `none`. Order is the server's own
// (level, then overdue, then due-within-24h, then next due).

export const MAX_FOCUS_CHIPS = 4;

export interface CourseFocusChip {
  courseId: string;
  label: string;
  tone: ChipTone;
  /** What earned the chip, for the accessibility label: "1 overdue", "due in 24h", "due this week". */
  reason: string;
}

export interface CourseFocusRow {
  chips: CourseFocusChip[];
  /** Courses at high/medium attention beyond the chips shown. */
  hiddenCount: number;
}

function reasonFor(course: AcademicCourseAttention): string {
  if (course.overdue_total > 0) {
    return `${course.overdue_total} overdue`;
  }
  if (course.due_within_24h_total > 0) return "due in 24h";
  return "due this week";
}

/** Null when the key is absent (an older server) or nothing needs focus. */
export function courseFocusRow(data: AcademicTodayResponse): CourseFocusRow | null {
  const items = data.course_attention?.items;
  if (items === undefined) return null;
  const focused = items.filter((c) => c.attention === "high" || c.attention === "medium");
  if (focused.length === 0) return null;
  const chips = focused.slice(0, MAX_FOCUS_CHIPS).map((course) => ({
    courseId: course.course_id,
    label: courseLabel(course.course_code, course.course_name),
    tone: (course.attention === "high" ? "danger" : "warning") as ChipTone,
    reason: reasonFor(course),
  }));
  return { chips, hiddenCount: focused.length - chips.length };
}
