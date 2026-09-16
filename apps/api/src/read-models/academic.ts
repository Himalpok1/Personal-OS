import { captureEffectiveNow } from "@personal-os/core";
import {
  academicTodayWindows,
  bucketAcademicAssignments,
} from "@personal-os/core/academic/buckets";
import {
  deriveCourseStatus,
  deriveGradingStatus,
  derivePercentage,
  isOpenAssignment,
  normalizeReadState,
  normalizeSubmissionStatus,
  type AcademicSubmissionStatus,
} from "@personal-os/core/academic/derive";
import {
  canvasAnnouncements,
  canvasAssignments,
  canvasConnections,
  canvasCourses,
  canvasEvents,
  type Db,
} from "@personal-os/db";
import {
  ACADEMIC_ANNOUNCEMENTS_ITEM_CAP,
  ACADEMIC_ANNOUNCEMENT_LOOKBACK_DAYS,
  ACADEMIC_DUE_THIS_WEEK_ITEM_CAP,
  ACADEMIC_DUE_TODAY_ITEM_CAP,
  ACADEMIC_EVENTS_ITEM_CAP,
  ACADEMIC_OVERDUE_ITEM_CAP,
  ACADEMIC_UPCOMING_DAY_COUNT,
  AcademicCourseDetailResponseSchema,
  AcademicCoursesResponseSchema,
  AcademicTodayResponseSchema,
  type AcademicAnnouncement,
  type AcademicAssignment,
  type AcademicCourse,
  type AcademicCourseDetailResponse,
  type AcademicCourseSummary,
  type AcademicCoursesQuery,
  type AcademicCoursesResponse,
  type AcademicEvent,
  type AcademicTodayQuery,
  type AcademicTodayResponse,
} from "@personal-os/schema";
import { and, asc, eq, gt, gte, inArray, isNull, lt, lte, or, sql } from "drizzle-orm";

// The academic read model (Checkpoint 10.2, ADR-070): a computed,
// never-stored projection over the canvas_* tables Checkpoint 10.1's sync
// writes (ADR-068). There is no academic_* table. Everything here follows the
// shape of read-models/today.ts -- one effectiveNow per build, batched
// queries, honest totals beside capped items, and a final parse through the
// strict wire schema so a stray field can never leak.
//
// Scope rules, applied to every query:
//   * only `canvas_connections.status = 'active'` -- a disconnected
//     institution's rows stay in the tables (a reconnect needs no backfill,
//     ADR-068 §6) but are never surfaced while it is paused;
//   * only `canvas_courses.archived_at IS NULL`, unless a course list asks
//     for archived courses explicitly;
//   * only unarchived assignments / announcements / events.
//
// Every derived fact -- `open`, the grade percentage, the grading status, a
// course's lifecycle, its counts -- is computed through
// packages/core/src/academic/* and nowhere else. Nothing here writes, imports
// `ai`, or logs: a title, a course name, a score, a grade, a preview or a URL
// never reaches a log line from this file (ADR-068a).
//
// `options.now` is an INTERNAL test seam, exactly as on buildTodayResponse:
// no HTTP client can pin the clock these sections bucket against.

const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Row shapes -- the columns each query selects, nothing more.
// ---------------------------------------------------------------------------

interface CourseRow {
  id: string;
  connectionId: string;
  canvasCourseId: number;
  name: string;
  courseCode: string | null;
  termName: string | null;
  termStartAt: Date | null;
  termEndAt: Date | null;
  enrollmentState: string | null;
  workflowState: string | null;
  htmlUrl: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  canvasBaseUrl: string;
}

interface AssignmentRow {
  id: string;
  courseId: string;
  canvasAssignmentId: number;
  title: string;
  dueAt: Date | null;
  pointsPossible: number | null;
  htmlUrl: string | null;
  published: boolean;
  submissionState: string | null;
  submissionMissing: boolean | null;
  submissionLate: boolean | null;
  submittedAt: Date | null;
  score: number | null;
  grade: string | null;
  archivedAt: Date | null;
  courseName: string;
  courseCode: string | null;
  canvasBaseUrl: string;
}

/** An assignment row plus the two derived facts the buckets and counts key on. */
interface DerivedAssignment extends AssignmentRow {
  status: AcademicSubmissionStatus;
  open: boolean;
}

interface AnnouncementRow {
  id: string;
  courseId: string;
  canvasAnnouncementId: number;
  title: string;
  messagePreview: string | null;
  postedAt: Date | null;
  htmlUrl: string | null;
  readState: string | null;
  archivedAt: Date | null;
  courseName: string;
  canvasBaseUrl: string;
}

interface EventRow {
  id: string;
  courseId: string | null;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
  locationName: string | null;
  htmlUrl: string | null;
  courseName: string | null;
  canvasBaseUrl: string;
}

const iso = (value: Date | null): string | null => (value ? value.toISOString() : null);

// ---------------------------------------------------------------------------
// Derivation and projection -- one place per shape.
// ---------------------------------------------------------------------------

function deriveAssignment(row: AssignmentRow): DerivedAssignment {
  const status = normalizeSubmissionStatus(row.submissionState);
  return { ...row, status, open: isOpenAssignment(status) };
}

function toAcademicAssignment(row: DerivedAssignment): AcademicAssignment {
  return {
    id: row.id,
    source: "canvas",
    external_id: String(row.canvasAssignmentId),
    course_id: row.courseId,
    course_name: row.courseName,
    course_code: row.courseCode,
    title: row.title,
    due_at: iso(row.dueAt),
    points_possible: row.pointsPossible,
    submission: {
      status: row.status,
      missing: row.submissionMissing ?? false,
      late: row.submissionLate ?? false,
      submitted_at: iso(row.submittedAt),
    },
    grade: {
      status: deriveGradingStatus(row.status),
      score: row.score,
      grade: row.grade,
      percentage: derivePercentage(row.score, row.pointsPossible),
    },
    open: row.open,
    published: row.published,
    html_url: row.htmlUrl,
    source_base_url: row.canvasBaseUrl,
    archived_at: iso(row.archivedAt),
  };
}

function toAcademicCourse(row: CourseRow): AcademicCourse {
  return {
    id: row.id,
    source: "canvas",
    external_id: String(row.canvasCourseId),
    connection_id: row.connectionId,
    name: row.name,
    code: row.courseCode,
    term: {
      name: row.termName,
      starts_at: iso(row.termStartAt),
      ends_at: iso(row.termEndAt),
    },
    status: deriveCourseStatus(row.archivedAt, row.enrollmentState, row.workflowState),
    html_url: row.htmlUrl,
    source_base_url: row.canvasBaseUrl,
    archived_at: iso(row.archivedAt),
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

/**
 * The three computed facts a course list needs, from the course's own open
 * assignments: `overdue` is the instant comparison of rule 2, and
 * `next_due_at` the earliest open due instant at or after effectiveNow.
 */
function toAcademicCourseSummary(
  row: CourseRow,
  assignments: readonly DerivedAssignment[],
  effectiveNow: Date,
): AcademicCourseSummary {
  const nowMs = effectiveNow.getTime();
  let open = 0;
  let overdue = 0;
  let nextDue: Date | null = null;
  for (const assignment of assignments) {
    if (!assignment.open) continue;
    open += 1;
    if (assignment.dueAt === null) continue;
    const dueMs = assignment.dueAt.getTime();
    if (dueMs < nowMs) {
      overdue += 1;
    } else if (nextDue === null || dueMs < nextDue.getTime()) {
      nextDue = assignment.dueAt;
    }
  }
  return {
    ...toAcademicCourse(row),
    open_assignment_count: open,
    overdue_assignment_count: overdue,
    next_due_at: iso(nextDue),
  };
}

function toAcademicAnnouncement(row: AnnouncementRow): AcademicAnnouncement {
  return {
    id: row.id,
    source: "canvas",
    external_id: String(row.canvasAnnouncementId),
    course_id: row.courseId,
    course_name: row.courseName,
    title: row.title,
    preview: row.messagePreview,
    posted_at: iso(row.postedAt),
    read: normalizeReadState(row.readState),
    html_url: row.htmlUrl,
    source_base_url: row.canvasBaseUrl,
    archived_at: iso(row.archivedAt),
  };
}

function toCalendarEvent(row: EventRow): AcademicEvent {
  return {
    kind: "calendar_event",
    id: row.id,
    source: "canvas",
    course_id: row.courseId,
    course_name: row.courseName,
    title: row.title,
    at: iso(row.startsAt),
    ends_at: iso(row.endsAt),
    all_day: row.allDay,
    location: row.locationName,
    html_url: row.htmlUrl,
    source_base_url: row.canvasBaseUrl,
  };
}

// ---------------------------------------------------------------------------
// Ordering -- every comparator ends in `id`, so identical requests are
// byte-identical (the search read model's own rule).
// ---------------------------------------------------------------------------

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Nulls last for an ascending sort; the caller flips the sign for descending. */
function compareNullableInstants(a: Date | null, b: Date | null, direction: 1 | -1): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  const delta = a.getTime() - b.getTime();
  return delta === 0 ? 0 : delta < 0 ? -direction : direction;
}

function compareNullableStrings(a: string | null, b: string | null): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  return compareStrings(a, b);
}

/** Term start desc (nulls last), code, name, id -- AcademicCoursesResponseSchema's documented order. */
function compareCoursesForList(a: CourseRow, b: CourseRow): number {
  return (
    compareNullableInstants(a.termStartAt, b.termStartAt, -1) ||
    compareNullableStrings(a.courseCode, b.courseCode) ||
    compareStrings(a.name, b.name) ||
    compareIds(a.id, b.id)
  );
}

/** due_at asc (nulls last), title, id -- the course-detail assignment order. */
function compareAssignmentsForDetail(a: AssignmentRow, b: AssignmentRow): number {
  return (
    compareNullableInstants(a.dueAt, b.dueAt, 1) ||
    compareStrings(a.title, b.title) ||
    compareIds(a.id, b.id)
  );
}

/** posted_at desc (nulls last), id -- "newest first". */
function compareAnnouncementsNewestFirst(a: AnnouncementRow, b: AnnouncementRow): number {
  return compareNullableInstants(a.postedAt, b.postedAt, -1) || compareIds(a.id, b.id);
}

/**
 * Unread first (read=false, then unknown, then read=true), then newest,
 * then id -- the Today announcements order.
 */
function compareAnnouncementsUnreadFirst(a: AnnouncementRow, b: AnnouncementRow): number {
  const rank = (row: AnnouncementRow): number => {
    const read = normalizeReadState(row.readState);
    return read === false ? 0 : read === null ? 1 : 2;
  };
  return rank(a) - rank(b) || compareAnnouncementsNewestFirst(a, b);
}

/** starts_at asc (nulls last), title, id. */
function compareEventsByStart(a: EventRow, b: EventRow): number {
  return (
    compareNullableInstants(a.startsAt, b.startsAt, 1) ||
    compareStrings(a.title, b.title) ||
    compareIds(a.id, b.id)
  );
}

// ---------------------------------------------------------------------------
// Queries -- each is one batched statement over the scope rules above.
// ---------------------------------------------------------------------------

const ASSIGNMENT_SELECT = {
  id: canvasAssignments.id,
  courseId: canvasAssignments.courseId,
  canvasAssignmentId: canvasAssignments.canvasAssignmentId,
  title: canvasAssignments.title,
  dueAt: canvasAssignments.dueAt,
  pointsPossible: canvasAssignments.pointsPossible,
  htmlUrl: canvasAssignments.htmlUrl,
  published: canvasAssignments.published,
  submissionState: canvasAssignments.submissionState,
  submissionMissing: canvasAssignments.submissionMissing,
  submissionLate: canvasAssignments.submissionLate,
  submittedAt: canvasAssignments.submittedAt,
  score: canvasAssignments.score,
  grade: canvasAssignments.grade,
  archivedAt: canvasAssignments.archivedAt,
  courseName: canvasCourses.name,
  courseCode: canvasCourses.courseCode,
  canvasBaseUrl: canvasConnections.canvasBaseUrl,
};

const COURSE_SELECT = {
  id: canvasCourses.id,
  connectionId: canvasCourses.connectionId,
  canvasCourseId: canvasCourses.canvasCourseId,
  name: canvasCourses.name,
  courseCode: canvasCourses.courseCode,
  termName: canvasCourses.termName,
  termStartAt: canvasCourses.termStartAt,
  termEndAt: canvasCourses.termEndAt,
  enrollmentState: canvasCourses.enrollmentState,
  workflowState: canvasCourses.workflowState,
  htmlUrl: canvasCourses.htmlUrl,
  archivedAt: canvasCourses.archivedAt,
  createdAt: canvasCourses.createdAt,
  updatedAt: canvasCourses.updatedAt,
  canvasBaseUrl: canvasConnections.canvasBaseUrl,
};

const ANNOUNCEMENT_SELECT = {
  id: canvasAnnouncements.id,
  courseId: canvasAnnouncements.courseId,
  canvasAnnouncementId: canvasAnnouncements.canvasAnnouncementId,
  title: canvasAnnouncements.title,
  messagePreview: canvasAnnouncements.messagePreview,
  postedAt: canvasAnnouncements.postedAt,
  htmlUrl: canvasAnnouncements.htmlUrl,
  readState: canvasAnnouncements.readState,
  archivedAt: canvasAnnouncements.archivedAt,
  courseName: canvasCourses.name,
  canvasBaseUrl: canvasConnections.canvasBaseUrl,
};

const EVENT_SELECT = {
  id: canvasEvents.id,
  courseId: canvasEvents.courseId,
  title: canvasEvents.title,
  startsAt: canvasEvents.startsAt,
  endsAt: canvasEvents.endsAt,
  allDay: canvasEvents.allDay,
  locationName: canvasEvents.locationName,
  htmlUrl: canvasEvents.htmlUrl,
  courseName: canvasCourses.name,
  canvasBaseUrl: canvasConnections.canvasBaseUrl,
};

const ACTIVE_CONNECTION = eq(canvasConnections.status, "active");
const UNARCHIVED_COURSE = isNull(canvasCourses.archivedAt);

async function countActiveConnections(db: Db): Promise<number> {
  const rows = await db
    .select({ id: canvasConnections.id })
    .from(canvasConnections)
    .where(ACTIVE_CONNECTION);
  return rows.length;
}

/**
 * Every unarchived assignment across active connections' unarchived courses
 * (optionally one course only). Fetched whole rather than pre-filtered by
 * due window because `missing_total` is windowless and `open` is derived
 * in TypeScript -- restating the open rule in SQL would be a second source
 * of truth for it. At a single-user course load this is a few hundred rows.
 */
async function fetchAssignments(db: Db, courseId?: string): Promise<DerivedAssignment[]> {
  const rows = await db
    .select(ASSIGNMENT_SELECT)
    .from(canvasAssignments)
    .innerJoin(canvasCourses, eq(canvasAssignments.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasAssignments.connectionId, canvasConnections.id))
    .where(
      and(
        ACTIVE_CONNECTION,
        UNARCHIVED_COURSE,
        isNull(canvasAssignments.archivedAt),
        courseId === undefined ? undefined : eq(canvasAssignments.courseId, courseId),
      ),
    )
    .orderBy(
      sql`${canvasAssignments.dueAt} asc nulls last`,
      asc(canvasAssignments.title),
      asc(canvasAssignments.id),
    );
  return rows.map(deriveAssignment);
}

// ---------------------------------------------------------------------------
// GET /academic/today
// ---------------------------------------------------------------------------

export async function buildAcademicTodayResponse(
  db: Db,
  query: AcademicTodayQuery,
  options?: { now?: Date },
): Promise<AcademicTodayResponse> {
  // Frozen semantics item 1: exactly one effectiveNow per build.
  const effectiveNow = captureEffectiveNow(options?.now);
  const { today, horizonEndUtc } = academicTodayWindows(
    query.tz,
    effectiveNow,
    ACADEMIC_UPCOMING_DAY_COUNT,
  );
  const generatedAt = effectiveNow.toISOString();

  const configured = (await countActiveConnections(db)) > 0;
  if (!configured) {
    return AcademicTodayResponseSchema.parse({
      generated_at: generatedAt,
      effective_now: generatedAt,
      tz: query.tz,
      local_date: today.localDate,
      configured: false,
      summary: {
        overdue_total: 0,
        due_today_total: 0,
        due_this_week_total: 0,
        missing_total: 0,
        unread_announcements_total: 0,
      },
      overdue: { items: [], total: 0 },
      due_today: { items: [], total: 0 },
      due_this_week: { items: [], total: 0 },
      announcements: { items: [], total: 0 },
      events: { items: [], total: 0 },
    });
  }

  const assignments = await fetchAssignments(db);
  const buckets = bucketAcademicAssignments({
    assignments,
    effectiveNow,
    tz: query.tz,
    upcomingDayCount: ACADEMIC_UPCOMING_DAY_COUNT,
  });
  // Canvas's own `missing` flag over every open assignment, windowless
  // (AcademicTodayResponseSchema's doc comment): reported beside
  // overdue_total, never reconciled with it.
  const missingTotal = assignments.filter((a) => a.open && a.submissionMissing === true).length;

  // Announcements posted within the lookback, as instant arithmetic from
  // effectiveNow: [now - N days, now]. A posted_at in the future (Canvas's
  // delayed posting) is not yet "posted" and is excluded; a null posted_at
  // cannot be placed in any window and is excluded too.
  const lookbackStart = new Date(
    effectiveNow.getTime() - ACADEMIC_ANNOUNCEMENT_LOOKBACK_DAYS * DAY_MS,
  );
  const announcementRows: AnnouncementRow[] = await db
    .select(ANNOUNCEMENT_SELECT)
    .from(canvasAnnouncements)
    .innerJoin(canvasCourses, eq(canvasAnnouncements.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasAnnouncements.connectionId, canvasConnections.id))
    .where(
      and(
        ACTIVE_CONNECTION,
        UNARCHIVED_COURSE,
        isNull(canvasAnnouncements.archivedAt),
        gte(canvasAnnouncements.postedAt, lookbackStart),
        lte(canvasAnnouncements.postedAt, effectiveNow),
      ),
    );
  announcementRows.sort(compareAnnouncementsUnreadFirst);
  // Unread within the SAME window the section shows, so the count and the
  // list can never disagree (missing_total is the one windowless count, and
  // the schema says so explicitly).
  const unreadTotal = announcementRows.filter(
    (r) => normalizeReadState(r.readState) === false,
  ).length;

  // Calendar events that are UPCOMING OR IN PROGRESS within the same local-day
  // horizon `due_this_week` uses (the end of local day + ACADEMIC_UPCOMING_
  // DAY_COUNT), so one card never carries two notions of "this week" (10.2
  // review finding): an event starts before the horizon end AND has not
  // finished -- `ends_at > now`, or no `ends_at` and `starts_at >= now`. That
  // also keeps an event that started ten minutes ago on the card (the 8.2
  // latent Today debt, not repeated here). A personal (course-less) event
  // carries no course row; a course-scoped one must belong to an unarchived
  // course.
  const eventRows: EventRow[] = await db
    .select(EVENT_SELECT)
    .from(canvasEvents)
    .leftJoin(canvasCourses, eq(canvasEvents.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasEvents.connectionId, canvasConnections.id))
    .where(
      and(
        ACTIVE_CONNECTION,
        or(isNull(canvasEvents.courseId), UNARCHIVED_COURSE),
        isNull(canvasEvents.archivedAt),
        lt(canvasEvents.startsAt, horizonEndUtc),
        or(
          gt(canvasEvents.endsAt, effectiveNow),
          and(isNull(canvasEvents.endsAt), gte(canvasEvents.startsAt, effectiveNow)),
        ),
      ),
    );
  eventRows.sort(compareEventsByStart);

  return AcademicTodayResponseSchema.parse({
    generated_at: generatedAt,
    effective_now: generatedAt,
    tz: query.tz,
    local_date: today.localDate,
    configured: true,
    summary: {
      overdue_total: buckets.overdue.length,
      due_today_total: buckets.dueToday.length,
      due_this_week_total: buckets.dueThisWeek.length,
      missing_total: missingTotal,
      unread_announcements_total: unreadTotal,
    },
    overdue: {
      items: buckets.overdue.slice(0, ACADEMIC_OVERDUE_ITEM_CAP).map(toAcademicAssignment),
      total: buckets.overdue.length,
    },
    due_today: {
      items: buckets.dueToday.slice(0, ACADEMIC_DUE_TODAY_ITEM_CAP).map(toAcademicAssignment),
      total: buckets.dueToday.length,
    },
    due_this_week: {
      items: buckets.dueThisWeek
        .slice(0, ACADEMIC_DUE_THIS_WEEK_ITEM_CAP)
        .map(toAcademicAssignment),
      total: buckets.dueThisWeek.length,
    },
    announcements: {
      items: announcementRows.slice(0, ACADEMIC_ANNOUNCEMENTS_ITEM_CAP).map(toAcademicAnnouncement),
      total: announcementRows.length,
    },
    events: {
      items: eventRows.slice(0, ACADEMIC_EVENTS_ITEM_CAP).map(toCalendarEvent),
      total: eventRows.length,
    },
  });
}

// ---------------------------------------------------------------------------
// GET /academic/courses
// ---------------------------------------------------------------------------

export async function listAcademicCourses(
  db: Db,
  query: AcademicCoursesQuery,
  options?: { now?: Date },
): Promise<AcademicCoursesResponse> {
  const effectiveNow = captureEffectiveNow(options?.now);

  const configured = (await countActiveConnections(db)) > 0;
  if (!configured) {
    return AcademicCoursesResponseSchema.parse({ configured: false, items: [] });
  }

  const courseRows: CourseRow[] = await db
    .select(COURSE_SELECT)
    .from(canvasCourses)
    .innerJoin(canvasConnections, eq(canvasCourses.connectionId, canvasConnections.id))
    .where(and(ACTIVE_CONNECTION, query.include_archived ? undefined : UNARCHIVED_COURSE));
  courseRows.sort(compareCoursesForList);

  // One batched fetch of every listed course's unarchived assignments -- an
  // archived course's counts are computed the same way, from whatever
  // unarchived assignments it still has, rather than zeroed by fiat.
  const courseIds = courseRows.map((row) => row.id);
  const assignmentsByCourse = new Map<string, DerivedAssignment[]>();
  if (courseIds.length > 0) {
    const rows = await db
      .select(ASSIGNMENT_SELECT)
      .from(canvasAssignments)
      .innerJoin(canvasCourses, eq(canvasAssignments.courseId, canvasCourses.id))
      .innerJoin(canvasConnections, eq(canvasAssignments.connectionId, canvasConnections.id))
      .where(
        and(inArray(canvasAssignments.courseId, courseIds), isNull(canvasAssignments.archivedAt)),
      );
    for (const row of rows) {
      const derived = deriveAssignment(row);
      const existing = assignmentsByCourse.get(derived.courseId);
      if (existing) existing.push(derived);
      else assignmentsByCourse.set(derived.courseId, [derived]);
    }
  }

  return AcademicCoursesResponseSchema.parse({
    configured: true,
    items: courseRows.map((row) =>
      toAcademicCourseSummary(row, assignmentsByCourse.get(row.id) ?? [], effectiveNow),
    ),
  });
}

// ---------------------------------------------------------------------------
// GET /academic/courses/:id
// ---------------------------------------------------------------------------

/**
 * Null when the course is unknown or belongs to a connection that is not
 * active -- "a paused institution is never surfaced", the rule the
 * upcoming-assignments route documents, so the route answers 404 for both
 * alike and never confirms which. An ARCHIVED course is NOT refused: the list
 * can surface it under `include_archived=true` with `status: "archived"`, and
 * a course a client can list must be a course it can open (10.2 review
 * finding). Its child rows were never archived by the course tombstone
 * (persist.ts archives per entity kind), so they read back unchanged.
 */
export async function getAcademicCourseDetail(
  db: Db,
  id: string,
  options?: { now?: Date },
): Promise<AcademicCourseDetailResponse | null> {
  const effectiveNow = captureEffectiveNow(options?.now);

  const [courseRow] = await db
    .select(COURSE_SELECT)
    .from(canvasCourses)
    .innerJoin(canvasConnections, eq(canvasCourses.connectionId, canvasConnections.id))
    .where(and(eq(canvasCourses.id, id), ACTIVE_CONNECTION))
    .limit(1);
  if (!courseRow) return null;

  const assignments = await fetchAssignments(db, courseRow.id);
  assignments.sort(compareAssignmentsForDetail);

  const announcementRows: AnnouncementRow[] = await db
    .select(ANNOUNCEMENT_SELECT)
    .from(canvasAnnouncements)
    .innerJoin(canvasCourses, eq(canvasAnnouncements.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasAnnouncements.connectionId, canvasConnections.id))
    .where(
      and(eq(canvasAnnouncements.courseId, courseRow.id), isNull(canvasAnnouncements.archivedAt)),
    );
  announcementRows.sort(compareAnnouncementsNewestFirst);

  const eventRows: EventRow[] = await db
    .select(EVENT_SELECT)
    .from(canvasEvents)
    .leftJoin(canvasCourses, eq(canvasEvents.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasEvents.connectionId, canvasConnections.id))
    .where(and(eq(canvasEvents.courseId, courseRow.id), isNull(canvasEvents.archivedAt)));
  eventRows.sort(compareEventsByStart);

  return AcademicCourseDetailResponseSchema.parse({
    course: toAcademicCourseSummary(courseRow, assignments, effectiveNow),
    assignments: assignments.map(toAcademicAssignment),
    announcements: announcementRows.map(toAcademicAnnouncement),
    events: eventRows.map(toCalendarEvent),
  });
}
