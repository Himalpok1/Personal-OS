import type { AcademicGrade, AcademicSubmission } from "@personal-os/schema";

// Pure, React-free presentation formatting for the academic surfaces
// (Checkpoint 10.2, ADR-070) -- the same split as health/format.ts and
// brief/brief-card-state.ts: every formatting decision gets real vitest
// coverage here, and the .tsx files stay thin.
//
// Nothing here derives a fact. `open`, `grade.status`, `grade.percentage`
// and the overdue/due-today bucketing are all computed ONCE, server-side
// (packages/schema/src/academic.ts); this module only chooses words for
// values it is handed. In particular it never re-derives "is this graded"
// from a score, and never re-derives "is this late" from a due instant.

/**
 * Locale and zone are injectable so tests can pin them; every component
 * caller passes nothing and gets the device's own locale and zone, exactly as
 * `toLocaleTimeString(undefined, ...)` on the Today screen does.
 */
export interface FormatOptions {
  locale?: string;
  timeZone?: string;
}

/** What an unreadable instant renders as. Never the raw string, never "Invalid Date". */
const UNREADABLE = "—";

function parseInstant(iso: string): Date | null {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Sep 22" -- month and day in the caller's zone, no year (the horizon is days, not years). */
export function formatDateLabel(iso: string, options: FormatOptions = {}): string {
  const date = parseInstant(iso);
  if (date === null) return UNREADABLE;
  return date.toLocaleDateString(options.locale, {
    month: "short",
    day: "numeric",
    timeZone: options.timeZone,
  });
}

/** "11:59 PM" (or "23:59" under a 24-hour locale). */
export function formatTimeLabel(iso: string, options: FormatOptions = {}): string {
  const date = parseInstant(iso);
  if (date === null) return UNREADABLE;
  return date.toLocaleTimeString(options.locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: options.timeZone,
  });
}

/**
 * "Sep 22 · 11:59 PM", or "No due date" for an assignment with no `due_at`.
 * The exact shape the retired 10.1 card rendered, so the Today card reads the
 * same before and after the move.
 */
export function formatDueLabel(iso: string | null, options: FormatOptions = {}): string {
  if (iso === null) return "No due date";
  const date = formatDateLabel(iso, options);
  if (date === UNREADABLE) return UNREADABLE;
  return `${date} · ${formatTimeLabel(iso, options)}`;
}

/**
 * When a calendar event happens, in one line:
 *   all-day, one day      "Sep 22"
 *   all-day, spanning     "Sep 22 – Sep 24"
 *   timed, one day        "Sep 22 · 3:00 PM – 4:00 PM"
 *   timed, spanning       "Sep 22 · 3:00 PM – Sep 23 · 4:00 PM"
 *   no start              "No date"
 * An end that is not after the start is ignored rather than rendered as a
 * zero-length or negative range.
 */
export function formatWhenLabel(
  event: { at: string | null; ends_at: string | null; all_day: boolean },
  options: FormatOptions = {},
): string {
  if (event.at === null) return "No date";
  const start = parseInstant(event.at);
  if (start === null) return UNREADABLE;
  const end = event.ends_at === null ? null : parseInstant(event.ends_at);
  const hasEnd = end !== null && end.getTime() > start.getTime();

  const startDate = formatDateLabel(event.at, options);
  const endDate = hasEnd ? formatDateLabel(event.ends_at as string, options) : null;
  const sameDay = endDate === null || endDate === startDate;

  if (event.all_day) {
    return sameDay ? startDate : `${startDate} – ${endDate}`;
  }
  const startLabel = `${startDate} · ${formatTimeLabel(event.at, options)}`;
  if (!hasEnd) return startLabel;
  const endTime = formatTimeLabel(event.ends_at as string, options);
  return sameDay ? `${startLabel} – ${endTime}` : `${startLabel} – ${endDate} · ${endTime}`;
}

/** At most two decimals, no trailing zeros: 97 → "97", 9.5 → "9.5", 33.333 → "33.33". */
export function formatPoints(value: number): string {
  if (!Number.isFinite(value)) return UNREADABLE;
  return String(Number(value.toFixed(2)));
}

/** At most one decimal, no trailing zero: 97 → "97", 96.67 → "96.7". */
export function formatPercentage(value: number): string {
  if (!Number.isFinite(value)) return UNREADABLE;
  return String(Number(value.toFixed(1)));
}

/**
 * A `grade` string that merely repeats the score ("97", "97.0", "97%") adds
 * nothing next to the points; a letter or word grade ("A", "complete",
 * "excused") is the only thing worth appending.
 */
function isNumericGradeString(grade: string): boolean {
  const trimmed = grade.trim().replace(/%$/, "");
  return trimmed.length > 0 && /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(trimmed);
}

/**
 * The one line a graded assignment shows:
 *   "97 / 100 · 97%"        score with points possible and the server's percentage
 *   "97 / 100 · 97% · A"    ...plus a non-numeric grade string when Canvas sent one
 *   "97"                    score with no points possible (so no percentage)
 *   "A"                     a grade string with no score (letter/complete/excused)
 *   "Graded"                graded, but neither a score nor a grade string
 *   "—"                     not graded (including pending review)
 *
 * `percentage` is taken from the server, never recomputed here (ADR-068a: it
 * is derived once from the two stored columns so it can never disagree with
 * them). A grade string is provider-authored text and lands in <Text> only.
 */
export function formatGradeLabel(grade: AcademicGrade, pointsPossible: number | null): string {
  if (grade.status !== "graded") return UNREADABLE;

  const parts: string[] = [];
  if (grade.score !== null) {
    parts.push(
      pointsPossible !== null
        ? `${formatPoints(grade.score)} / ${formatPoints(pointsPossible)}`
        : formatPoints(grade.score),
    );
    if (grade.percentage !== null) parts.push(`${formatPercentage(grade.percentage)}%`);
  }
  const gradeText = grade.grade?.trim() ?? "";
  if (gradeText.length > 0 && !isNumericGradeString(gradeText)) parts.push(gradeText);

  return parts.length === 0 ? "Graded" : parts.join(" · ");
}

export type SubmissionBadgeTone = "red" | "amber" | "green" | "neutral";

export interface SubmissionBadge {
  text: "Missing" | "Late" | "Submitted" | "Graded";
  tone: SubmissionBadgeTone;
}

/**
 * The short status word beside an assignment, by precedence: Canvas's own
 * `missing` flag first (red), then `late` (amber), then the normalized
 * submission status. An open assignment that is neither missing nor late
 * carries no badge at all -- the section it sits in already says what it
 * is. `unknown` (a status this client has never heard of, ADR-050) also
 * yields nothing: guessing "Submitted" would be the one wrong answer.
 */
export function submissionBadge(submission: AcademicSubmission): SubmissionBadge | null {
  if (submission.missing) return { text: "Missing", tone: "red" };
  if (submission.late) return { text: "Late", tone: "amber" };
  switch (submission.status) {
    case "graded":
      return { text: "Graded", tone: "green" };
    case "submitted":
    case "pending_review":
      return { text: "Submitted", tone: "neutral" };
    case "unsubmitted":
    case "unknown":
      return null;
  }
}

/** The short course name for a row: its code when Canvas has one, else its full name. */
export function courseLabel(code: string | null, name: string): string {
  const trimmed = code?.trim() ?? "";
  return trimmed.length > 0 ? trimmed : name;
}

/** "1 unread announcement" / "3 unread announcements". */
export function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}
