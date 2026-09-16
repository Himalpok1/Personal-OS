import {
  CANVAS_ANNOUNCEMENT_PREVIEW_MAX_CHARS,
  CANVAS_COURSE_CODE_MAX_CHARS,
  CANVAS_LOCATION_MAX_CHARS,
  CANVAS_TERM_NAME_MAX_CHARS,
  CANVAS_TITLE_MAX_CHARS,
  stripHtmlToPlainText,
  truncateProviderString,
} from "@personal-os/core/canvas/provider-strings";
import type {
  CanvasAnnouncementApiShape,
  CanvasAssignmentApiShape,
  CanvasCalendarEventApiShape,
  CanvasCourseApiShape,
} from "./canvas-client.js";

// Provider API shape -> a storable row. Pure: no clock, no network, no
// database. Mirrors packages/mail-providers/src/translate.ts's contract:
//
//   - EVERY MALFORMED RECORD IS A REJECTION, NEVER A THROW. One bad
//     assignment or announcement must not abort a whole course's sync
//     (ADR-068 §5's per-course/per-item containment, the
//     `expand-window`/mail-per-item precedent).
//   - A REJECTION CARRIES A KEY PATH AND A `typeof`, NEVER THE VALUE. The
//     value in question may be an instructor's assignment title.
//   - EVERY PROVIDER STRING IS BOUNDED HERE, at the boundary, not at the
//     insert -- this project's `text-bounds.ts` convention (truncate what a
//     provider authored, never reject it, because the owner did not type
//     it and cannot be asked to shorten it).
//
// WHAT IS EXCLUDED, ENFORCED BY OMISSION RATHER THAN BY A FILTER:
// `CanvasSubmissionApiShape` genuinely declares `entered_score`/
// `entered_grade`/`attachments` -- Canvas really returns them -- but no
// field on `CanvasAssignmentRow` exists to hold any of them, and
// `CanvasAssignmentApiShape.description` is never read at all. A row shape
// that CANNOT express a student's uploaded work is a stronger guarantee than
// a policy saying not to store it.
//
// `score` and `grade` ARE read since Checkpoint 10.2 (ADR-068a, migration
// 0021) -- the explicit owner decision ADR-068 §3 reserved. They are the
// ONLY two submission fields added: `entered_score`/`entered_grade` are the
// pre-late-policy near-duplicates with no Personal OS consumer, and
// `attachments` is a higher sensitivity tier than a number. See
// packages/db/src/schema/canvas-assignments.ts's header for the full
// storage decision.

/** Bounds this package owns locally: structural/id/enum-shaped fields that
 * `@personal-os/core/canvas/provider-strings` has no opinion on (that module
 * bounds free-text a stranger authored -- titles, course codes, term names,
 * locations, announcement bodies -- not Canvas's own closed vocabularies). */
const CANVAS_EXTERNAL_ID_MAX_CHARS = 64;
const CANVAS_ENROLLMENT_STATE_MAX_CHARS = 64;
const CANVAS_WORKFLOW_STATE_MAX_CHARS = 64;
const CANVAS_READ_STATE_MAX_CHARS = 32;
const CANVAS_HTML_URL_MAX_CHARS = 1024;
const CANVAS_SUBMISSION_TYPE_MAX_CHARS = 64;
const CANVAS_SUBMISSION_TYPES_MAX_COUNT = 20;
/**
 * Canvas's display grade (`submission.grade`): "A", "95", "95%", "complete",
 * "incomplete", "pass" -- a grading-scheme token, not prose, and never longer
 * than a few characters in practice. Bounded here rather than in core because
 * it is Canvas's own vocabulary (a letter-grade scheme is institution-
 * configured but closed), the same reasoning as `CANVAS_WORKFLOW_STATE_MAX_CHARS`.
 * Truncated at the boundary, never rejected: the owner did not type it.
 */
export const CANVAS_GRADE_MAX_CHARS = 64;

/** Why one record could not be translated. Carries no provider value. */
export interface CanvasTranslationRejection {
  /** Dotted path into the provider payload, e.g. `term.start_at`. */
  keyPath: string;
  /** `typeof` the offending value, or "missing"/"null"/"array". Never the value itself. */
  received: string;
}

/** `typeof`, or "missing"/"null"/"array". Never the value. */
function describe(value: unknown): string {
  if (value === undefined) return "missing";
  if (value === null) return "null";
  return Array.isArray(value) ? "array" : typeof value;
}

/** Canvas ids arrive as either a JSON number or a numeric string. Both are accepted; nothing else is. */
function externalId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return truncateProviderString(String(raw), CANVAS_EXTERNAL_ID_MAX_CHARS);
  }
  if (typeof raw === "string" && raw !== "") {
    return truncateProviderString(raw, CANVAS_EXTERNAL_ID_MAX_CHARS);
  }
  return null;
}

/**
 * Parses a Canvas ISO-8601 timestamp (`due_at`, `start_at`, `posted_at`,
 * `submission.submitted_at`...).
 *
 * Canvas returns `null`/absent for "no date set", which is a real,
 * meaningful fact -- an undated assignment, an ungraded submission -- and
 * must round-trip as `null` rather than being rejected. A present-but-
 * unparsable string (a defect in Canvas or in the fixture, not a fact about
 * the world) is distinguished as `"invalid"` so the caller can reject the
 * whole record instead of silently storing a wrong date that reads exactly
 * like a right one.
 */
function parseNullableTimestamp(raw: unknown): Date | null | "invalid" {
  if (raw === null || raw === undefined) return null;
  if (typeof raw !== "string" || raw === "") return "invalid";
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? "invalid" : parsed;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/** A course row, ready for `canvas_courses`. */
export interface CanvasCourseRow {
  externalId: string;
  name: string | null;
  courseCode: string | null;
  termName: string | null;
  termStartAt: Date | null;
  termEndAt: Date | null;
  enrollmentState: string | null;
  workflowState: string | null;
  htmlUrl: string | null;
}

export type CanvasCourseTranslationResult =
  { ok: true; row: CanvasCourseRow } | { ok: false; rejection: CanvasTranslationRejection };

export function translateCanvasCourse(
  payload: CanvasCourseApiShape,
): CanvasCourseTranslationResult {
  const id = externalId(payload?.id);
  if (id === null) {
    return { ok: false, rejection: { keyPath: "id", received: describe(payload?.id) } };
  }

  const term = payload.term ?? null;
  const termStartAt = parseNullableTimestamp(term?.start_at);
  if (termStartAt === "invalid") {
    return {
      ok: false,
      rejection: { keyPath: "term.start_at", received: describe(term?.start_at) },
    };
  }
  const termEndAt = parseNullableTimestamp(term?.end_at);
  if (termEndAt === "invalid") {
    return { ok: false, rejection: { keyPath: "term.end_at", received: describe(term?.end_at) } };
  }

  // Enrollment state comes from the FIRST enrollment only (ADR-068): this
  // integration reads a single student's own state, not a roster, and a
  // course response can in principle carry multiple enrollments.
  const enrollments = Array.isArray(payload.enrollments) ? payload.enrollments : [];
  const rawEnrollmentState = enrollments[0]?.enrollment_state;

  const row: CanvasCourseRow = {
    externalId: id,
    name: truncateProviderString(payload.name ?? null, CANVAS_TITLE_MAX_CHARS),
    courseCode: truncateProviderString(payload.course_code ?? null, CANVAS_COURSE_CODE_MAX_CHARS),
    termName: truncateProviderString(term?.name ?? null, CANVAS_TERM_NAME_MAX_CHARS),
    termStartAt,
    termEndAt,
    enrollmentState: truncateProviderString(
      typeof rawEnrollmentState === "string" ? rawEnrollmentState : null,
      CANVAS_ENROLLMENT_STATE_MAX_CHARS,
    ),
    workflowState: truncateProviderString(
      payload.workflow_state ?? null,
      CANVAS_WORKFLOW_STATE_MAX_CHARS,
    ),
    htmlUrl: truncateProviderString(payload.html_url ?? null, CANVAS_HTML_URL_MAX_CHARS),
  };

  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/**
 * An assignment row, ready for `canvas_assignments`.
 *
 * NOTE WHAT IS ABSENT: no `entered_score`, `entered_grade` or `attachments`
 * field exists here, although `CanvasSubmissionApiShape` declares all three
 * and Canvas genuinely returns them (ADR-068 §3, reaffirmed by ADR-068a).
 * What survives from the submission sub-object: the three coarse facts
 * (`submissionState`, `submissionMissing`, `submissionLate`), `submittedAt`,
 * and -- since Checkpoint 10.2 -- `score` and `grade`.
 *
 * `score` is the raw points awarded (matching `pointsPossible`'s unit) and
 * `grade` is Canvas's display grade; both are `null` until Canvas has graded
 * the submission. No percentage field: it is derived at read time from
 * `score / pointsPossible` so the two can never disagree.
 */
export interface CanvasAssignmentRow {
  externalId: string;
  courseExternalId: string;
  title: string | null;
  dueAt: Date | null;
  pointsPossible: number | null;
  submissionTypes: string[];
  htmlUrl: string | null;
  published: boolean;
  workflowState: string | null;
  submissionState: string | null;
  submissionMissing: boolean;
  submissionLate: boolean;
  submittedAt: Date | null;
  /** `submission.score` when it is a finite number; otherwise null (ADR-068a). */
  score: number | null;
  /** `submission.grade` when it is a string, bounded to CANVAS_GRADE_MAX_CHARS; otherwise null (ADR-068a). */
  grade: string | null;
}

export type CanvasAssignmentTranslationResult =
  { ok: true; row: CanvasAssignmentRow } | { ok: false; rejection: CanvasTranslationRejection };

export function translateCanvasAssignment(
  payload: CanvasAssignmentApiShape,
  courseId: string | number,
): CanvasAssignmentTranslationResult {
  const id = externalId(payload?.id);
  if (id === null) {
    return { ok: false, rejection: { keyPath: "id", received: describe(payload?.id) } };
  }
  const courseExternalId = externalId(courseId);
  if (courseExternalId === null) {
    return { ok: false, rejection: { keyPath: "courseId", received: describe(courseId) } };
  }

  const dueAt = parseNullableTimestamp(payload.due_at);
  if (dueAt === "invalid") {
    return { ok: false, rejection: { keyPath: "due_at", received: describe(payload.due_at) } };
  }

  const pointsPossible =
    typeof payload.points_possible === "number" && Number.isFinite(payload.points_possible)
      ? payload.points_possible
      : null;

  const rawTypes = Array.isArray(payload.submission_types) ? payload.submission_types : [];
  const submissionTypes = rawTypes
    .filter((t): t is string => typeof t === "string" && t !== "")
    .map((t) => truncateProviderString(t, CANVAS_SUBMISSION_TYPE_MAX_CHARS) ?? "")
    .filter((t) => t !== "")
    .slice(0, CANVAS_SUBMISSION_TYPES_MAX_COUNT);

  // Six submission facts survive translation: workflow_state, missing, late,
  // submitted_at, and (since Checkpoint 10.2, ADR-068a) score and grade.
  // `entered_score`, `entered_grade` and `attachments` are never read here,
  // even though `CanvasSubmissionApiShape` declares them -- the omission IS
  // the enforcement.
  const submission = payload.submission ?? null;
  const submittedAt = parseNullableTimestamp(submission?.submitted_at);
  if (submittedAt === "invalid") {
    return {
      ok: false,
      rejection: {
        keyPath: "submission.submitted_at",
        received: describe(submission?.submitted_at),
      },
    };
  }

  // A grade is a FACT ABOUT THE WORLD when present and "not yet graded" when
  // absent, so a malformed value (a string score, a NaN, an object grade) is
  // treated as absent rather than rejecting the whole assignment: the due
  // date and submission state are still worth having even if Canvas's
  // grading payload is odd. Mirrors `pointsPossible`'s own finite-number
  // guard above.
  const score =
    typeof submission?.score === "number" && Number.isFinite(submission.score)
      ? submission.score
      : null;
  const grade = truncateProviderString(
    typeof submission?.grade === "string" ? submission.grade : null,
    CANVAS_GRADE_MAX_CHARS,
  );

  const row: CanvasAssignmentRow = {
    externalId: id,
    courseExternalId,
    title: truncateProviderString(payload.name ?? null, CANVAS_TITLE_MAX_CHARS),
    dueAt,
    pointsPossible,
    submissionTypes,
    htmlUrl: truncateProviderString(payload.html_url ?? null, CANVAS_HTML_URL_MAX_CHARS),
    published: payload.published === true,
    workflowState: truncateProviderString(
      payload.workflow_state ?? null,
      CANVAS_WORKFLOW_STATE_MAX_CHARS,
    ),
    submissionState: truncateProviderString(
      typeof submission?.workflow_state === "string" ? submission.workflow_state : null,
      CANVAS_WORKFLOW_STATE_MAX_CHARS,
    ),
    submissionMissing: submission?.missing === true,
    submissionLate: submission?.late === true,
    submittedAt,
    score,
    grade,
  };

  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

/** An announcement row, ready for `canvas_announcements`. */
export interface CanvasAnnouncementRow {
  externalId: string;
  courseExternalId: string;
  title: string | null;
  /** Tag-stripped, truncated plain text -- never the raw HTML Canvas returns. */
  messagePreview: string | null;
  postedAt: Date | null;
  htmlUrl: string | null;
  readState: string | null;
}

export type CanvasAnnouncementTranslationResult =
  { ok: true; row: CanvasAnnouncementRow } | { ok: false; rejection: CanvasTranslationRejection };

export function translateCanvasAnnouncement(
  payload: CanvasAnnouncementApiShape,
  courseId: string | number,
): CanvasAnnouncementTranslationResult {
  const id = externalId(payload?.id);
  if (id === null) {
    return { ok: false, rejection: { keyPath: "id", received: describe(payload?.id) } };
  }
  const courseExternalId = externalId(courseId);
  if (courseExternalId === null) {
    return { ok: false, rejection: { keyPath: "courseId", received: describe(courseId) } };
  }

  const postedAt = parseNullableTimestamp(payload.posted_at);
  if (postedAt === "invalid") {
    return {
      ok: false,
      rejection: { keyPath: "posted_at", received: describe(payload.posted_at) },
    };
  }

  // The raw HTML is never stored (ADR-068 §3): `message` is instructor-
  // authored rich HTML of unbounded upstream size, this project has no HTML
  // sanitizer or renderer, and React Native's <Text> interprets no markup
  // anyway (the same reasoning ADR-059 §5 applies to search results). Strip
  // tags to plain text FIRST, then bound -- so the character budget is spent
  // on content, not on markup that would otherwise eat most of it.
  const plainMessage =
    typeof payload.message === "string" ? stripHtmlToPlainText(payload.message) : null;

  const row: CanvasAnnouncementRow = {
    externalId: id,
    courseExternalId,
    title: truncateProviderString(payload.title ?? null, CANVAS_TITLE_MAX_CHARS),
    messagePreview: truncateProviderString(plainMessage, CANVAS_ANNOUNCEMENT_PREVIEW_MAX_CHARS),
    postedAt,
    htmlUrl: truncateProviderString(payload.html_url ?? null, CANVAS_HTML_URL_MAX_CHARS),
    readState: truncateProviderString(payload.read_state ?? null, CANVAS_READ_STATE_MAX_CHARS),
  };

  return { ok: true, row };
}

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

/**
 * A calendar event row, ready for `canvas_events`.
 *
 * Assignment due dates are NOT translated into a row here (ADR-068 §3): the
 * assignment row is the one source of a due instant, mirroring this
 * project's standing rule against a second source of truth for calendar
 * data. This function only ever sees genuine `calendar_events` resources.
 */
export interface CanvasCalendarEventRow {
  externalId: string;
  courseExternalId: string;
  title: string | null;
  startAt: Date | null;
  endAt: Date | null;
  allDay: boolean;
  locationName: string | null;
  htmlUrl: string | null;
}

export type CanvasCalendarEventTranslationResult =
  { ok: true; row: CanvasCalendarEventRow } | { ok: false; rejection: CanvasTranslationRejection };

export function translateCanvasCalendarEvent(
  payload: CanvasCalendarEventApiShape,
  courseId: string | number,
): CanvasCalendarEventTranslationResult {
  const id = externalId(payload?.id);
  if (id === null) {
    return { ok: false, rejection: { keyPath: "id", received: describe(payload?.id) } };
  }
  const courseExternalId = externalId(courseId);
  if (courseExternalId === null) {
    return { ok: false, rejection: { keyPath: "courseId", received: describe(courseId) } };
  }

  const startAt = parseNullableTimestamp(payload.start_at);
  if (startAt === "invalid") {
    return { ok: false, rejection: { keyPath: "start_at", received: describe(payload.start_at) } };
  }
  const endAt = parseNullableTimestamp(payload.end_at);
  if (endAt === "invalid") {
    return { ok: false, rejection: { keyPath: "end_at", received: describe(payload.end_at) } };
  }

  const row: CanvasCalendarEventRow = {
    externalId: id,
    courseExternalId,
    title: truncateProviderString(payload.title ?? null, CANVAS_TITLE_MAX_CHARS),
    startAt,
    endAt,
    allDay: payload.all_day === true,
    locationName: truncateProviderString(payload.location_name ?? null, CANVAS_LOCATION_MAX_CHARS),
    htmlUrl: truncateProviderString(payload.html_url ?? null, CANVAS_HTML_URL_MAX_CHARS),
  };

  return { ok: true, row };
}
