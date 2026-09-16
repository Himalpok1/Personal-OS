import {
  canvasAnnouncements,
  canvasAssignments,
  canvasCourses,
  canvasEvents,
  type Db,
} from "@personal-os/db";
import type {
  CanvasAnnouncementRow,
  CanvasAssignmentRow,
  CanvasCalendarEventRow,
  CanvasCourseRow,
} from "@personal-os/canvas-providers";
import { and, eq, isNull, notInArray, sql } from "drizzle-orm";

// Hash-gated persistence for Canvas rows (ADR-068 §5).
//
// ============================================================================
// THE PROPERTY THIS FILE EXISTS TO GUARANTEE:
//   TWO IDENTICAL CONSECUTIVE SYNCS WRITE ZERO ROWS.
// ============================================================================
//
// The mechanism and the reasons are apps/worker/src/mail/persist.ts's,
// copied verbatim (which itself credits health/persist.ts):
//
//   1. `updated_at` is the only signal for "when did this actually change".
//   2. Rewriting every row every hour is dead tuples for autovacuum, forever,
//      for nothing.
//   3. It is what makes an idempotency test possible at all: a re-run that is
//      observably a no-op lets a test assert row equality across two passes.
//
//   on conflict (...) do update set ..., updated_at = now()
//   where <table>.<col> is distinct from excluded.<col> [or ...]
//
// When every predicate is false the row is not written AT ALL -- no new
// tuple, no updated_at bump -- and the statement returns NO ROW for it.
// `is distinct from`, never `<>`, because `<>` yields NULL against a NULL and
// silently stops updating.
//
// ============================================================================
// ARCHIVAL IS "ONLY TOMBSTONE ON A FULLY-FETCHED, AUTHORITATIVE PASS"
// (ADR-046a/047a), TIGHTENED TO ADR-047a's STRICTER, SESSION-LIKE RULE.
// ============================================================================
//
// Every `archiveMissing*` function below refuses to act when its "seen" id
// set is empty -- exactly `tombstoneMissingSessions`'s guard in
// apps/worker/src/health/persist.ts, and for the identical reason stated
// there: "in Postgres, `x <> ALL('{}'::text[])` is TRUE -- an empty 'not in'
// set matches EVERYTHING." ADR-046a's looser rule (an authoritative empty
// RESULT may still densify) governs daily-metric BUCKETS, a different shape
// of evidence; ADR-047a is explicit that "an empty session key set still
// cannot trigger tombstoning" for anything identity-keyed, which is what a
// course/assignment/announcement/event row is. The caller (../canvas/
// orchestrate.ts) already restricts every call here to a course whose OWN
// fetch succeeded THIS pass -- these functions add the second, independent
// guard rather than trusting the caller alone.

const WAS_INSERT = sql<boolean>`(xmax = 0)`;

export interface UpsertCounts {
  inserted: number;
  updated: number;
  unchanged: number;
}

const EMPTY_COUNTS: UpsertCounts = { inserted: 0, updated: 0, unchanged: 0 };

/**
 * Canvas ids arrive from `@personal-os/canvas-providers` translation as a
 * bounded, truncated STRING (`CanvasCourseRow.externalId` etc.) -- the
 * package's own external-id bound, applied before any id ever reaches this
 * file. The `canvas_*_id` columns are `bigint` (Drizzle `mode: "number"`),
 * so every id is converted back to a number at the one boundary that needs
 * to write it.
 */
function toCanvasId(externalId: string): number {
  return Number(externalId);
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

export interface UpsertCourseResult extends UpsertCounts {
  /** The row's local uuid -- returned even when unchanged, because assignments/
   *  announcements/events reference it as a foreign key. */
  id: string;
}

/**
 * Upserts one course and returns its local id.
 *
 * SINGLE-ROW, NOT BATCHED, unlike the child entities below -- and
 * deliberately so. `setWhere` means an UNCHANGED row returns NOTHING from
 * `RETURNING` (see the file header), but this pass needs the course's local
 * uuid regardless of whether anything changed, to persist that course's
 * assignments/announcements/events against the right foreign key. A batched
 * multi-course insert would lose exactly the unchanged rows' ids with no way
 * to recover them from the same statement, so each course is upserted (and,
 * on an unchanged result, re-selected for its id) one at a time.
 */
export async function upsertCanvasCourse(
  db: Db,
  params: { connectionId: string; row: CanvasCourseRow },
): Promise<UpsertCourseResult> {
  const canvasCourseId = toCanvasId(params.row.externalId);
  const values = {
    connectionId: params.connectionId,
    canvasCourseId,
    name: params.row.name ?? "",
    courseCode: params.row.courseCode,
    termName: params.row.termName,
    termStartAt: params.row.termStartAt,
    termEndAt: params.row.termEndAt,
    enrollmentState: params.row.enrollmentState,
    workflowState: params.row.workflowState,
    htmlUrl: params.row.htmlUrl,
  };

  const returned = await db
    .insert(canvasCourses)
    .values(values)
    .onConflictDoUpdate({
      target: [canvasCourses.connectionId, canvasCourses.canvasCourseId],
      set: {
        name: sql`excluded.name`,
        courseCode: sql`excluded.course_code`,
        termName: sql`excluded.term_name`,
        termStartAt: sql`excluded.term_start_at`,
        termEndAt: sql`excluded.term_end_at`,
        enrollmentState: sql`excluded.enrollment_state`,
        workflowState: sql`excluded.workflow_state`,
        htmlUrl: sql`excluded.html_url`,
        // A course Canvas is returning again is, by construction, no longer
        // missing -- reversible, exactly like every other tombstone axis in
        // this codebase (ADR-047a's "reappearance clears deleted_at").
        archivedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${canvasCourses.name} is distinct from excluded.name
        or ${canvasCourses.courseCode} is distinct from excluded.course_code
        or ${canvasCourses.termName} is distinct from excluded.term_name
        or ${canvasCourses.termStartAt} is distinct from excluded.term_start_at
        or ${canvasCourses.termEndAt} is distinct from excluded.term_end_at
        or ${canvasCourses.enrollmentState} is distinct from excluded.enrollment_state
        or ${canvasCourses.workflowState} is distinct from excluded.workflow_state
        or ${canvasCourses.htmlUrl} is distinct from excluded.html_url
        or ${canvasCourses.archivedAt} is not null`,
    })
    .returning({ id: canvasCourses.id, inserted: WAS_INSERT });

  const first = returned[0];
  if (first) {
    return {
      id: first.id,
      inserted: first.inserted ? 1 : 0,
      updated: first.inserted ? 0 : 1,
      unchanged: 0,
    };
  }

  const [existing] = await db
    .select({ id: canvasCourses.id })
    .from(canvasCourses)
    .where(
      and(
        eq(canvasCourses.connectionId, params.connectionId),
        eq(canvasCourses.canvasCourseId, canvasCourseId),
      ),
    )
    .limit(1);
  return { id: existing!.id, inserted: 0, updated: 0, unchanged: 1 };
}

/** Archives courses for this connection not present in `seenCanvasCourseIds`. */
export async function archiveMissingCanvasCourses(
  db: Db,
  params: { connectionId: string; seenCanvasCourseIds: readonly number[]; now?: Date },
): Promise<number> {
  if (params.seenCanvasCourseIds.length === 0) return 0;
  const now = params.now ?? new Date();
  const updated = await db
    .update(canvasCourses)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(canvasCourses.connectionId, params.connectionId),
        isNull(canvasCourses.archivedAt),
        notInArray(canvasCourses.canvasCourseId, [...params.seenCanvasCourseIds]),
      ),
    )
    .returning({ id: canvasCourses.id });
  return updated.length;
}

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

export async function upsertCanvasAssignments(
  db: Db,
  params: { connectionId: string; courseId: string; rows: readonly CanvasAssignmentRow[] },
): Promise<UpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY_COUNTS };

  const values = params.rows.map((row) => ({
    connectionId: params.connectionId,
    courseId: params.courseId,
    canvasAssignmentId: toCanvasId(row.externalId),
    title: row.title ?? "",
    dueAt: row.dueAt,
    pointsPossible: row.pointsPossible,
    submissionTypes: row.submissionTypes,
    htmlUrl: row.htmlUrl,
    published: row.published,
    submissionState: row.submissionState,
    submissionMissing: row.submissionMissing,
    submissionLate: row.submissionLate,
    submittedAt: row.submittedAt,
  }));

  const returned = await db
    .insert(canvasAssignments)
    .values(values)
    .onConflictDoUpdate({
      target: [canvasAssignments.connectionId, canvasAssignments.canvasAssignmentId],
      set: {
        courseId: sql`excluded.course_id`,
        title: sql`excluded.title`,
        dueAt: sql`excluded.due_at`,
        pointsPossible: sql`excluded.points_possible`,
        submissionTypes: sql`excluded.submission_types`,
        htmlUrl: sql`excluded.html_url`,
        published: sql`excluded.published`,
        submissionState: sql`excluded.submission_state`,
        submissionMissing: sql`excluded.submission_missing`,
        submissionLate: sql`excluded.submission_late`,
        submittedAt: sql`excluded.submitted_at`,
        archivedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${canvasAssignments.courseId} is distinct from excluded.course_id
        or ${canvasAssignments.title} is distinct from excluded.title
        or ${canvasAssignments.dueAt} is distinct from excluded.due_at
        or ${canvasAssignments.pointsPossible} is distinct from excluded.points_possible
        or ${canvasAssignments.submissionTypes} is distinct from excluded.submission_types
        or ${canvasAssignments.htmlUrl} is distinct from excluded.html_url
        or ${canvasAssignments.published} is distinct from excluded.published
        or ${canvasAssignments.submissionState} is distinct from excluded.submission_state
        or ${canvasAssignments.submissionMissing} is distinct from excluded.submission_missing
        or ${canvasAssignments.submissionLate} is distinct from excluded.submission_late
        or ${canvasAssignments.submittedAt} is distinct from excluded.submitted_at
        or ${canvasAssignments.archivedAt} is not null`,
    })
    .returning({ inserted: WAS_INSERT });

  const inserted = returned.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: values.length - returned.length,
  };
}

export async function archiveMissingCanvasAssignments(
  db: Db,
  params: {
    connectionId: string;
    courseId: string;
    seenCanvasAssignmentIds: readonly number[];
    now?: Date;
  },
): Promise<number> {
  if (params.seenCanvasAssignmentIds.length === 0) return 0;
  const now = params.now ?? new Date();
  const updated = await db
    .update(canvasAssignments)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(canvasAssignments.connectionId, params.connectionId),
        eq(canvasAssignments.courseId, params.courseId),
        isNull(canvasAssignments.archivedAt),
        notInArray(canvasAssignments.canvasAssignmentId, [...params.seenCanvasAssignmentIds]),
      ),
    )
    .returning({ id: canvasAssignments.id });
  return updated.length;
}

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export async function upsertCanvasAnnouncements(
  db: Db,
  params: { connectionId: string; courseId: string; rows: readonly CanvasAnnouncementRow[] },
): Promise<UpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY_COUNTS };

  const values = params.rows.map((row) => ({
    connectionId: params.connectionId,
    courseId: params.courseId,
    canvasAnnouncementId: toCanvasId(row.externalId),
    title: row.title ?? "",
    messagePreview: row.messagePreview,
    postedAt: row.postedAt,
    htmlUrl: row.htmlUrl,
    readState: row.readState,
  }));

  const returned = await db
    .insert(canvasAnnouncements)
    .values(values)
    .onConflictDoUpdate({
      target: [canvasAnnouncements.connectionId, canvasAnnouncements.canvasAnnouncementId],
      set: {
        courseId: sql`excluded.course_id`,
        title: sql`excluded.title`,
        messagePreview: sql`excluded.message_preview`,
        postedAt: sql`excluded.posted_at`,
        htmlUrl: sql`excluded.html_url`,
        readState: sql`excluded.read_state`,
        archivedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${canvasAnnouncements.courseId} is distinct from excluded.course_id
        or ${canvasAnnouncements.title} is distinct from excluded.title
        or ${canvasAnnouncements.messagePreview} is distinct from excluded.message_preview
        or ${canvasAnnouncements.postedAt} is distinct from excluded.posted_at
        or ${canvasAnnouncements.htmlUrl} is distinct from excluded.html_url
        or ${canvasAnnouncements.readState} is distinct from excluded.read_state
        or ${canvasAnnouncements.archivedAt} is not null`,
    })
    .returning({ inserted: WAS_INSERT });

  const inserted = returned.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: values.length - returned.length,
  };
}

export async function archiveMissingCanvasAnnouncements(
  db: Db,
  params: {
    connectionId: string;
    courseId: string;
    seenCanvasAnnouncementIds: readonly number[];
    now?: Date;
  },
): Promise<number> {
  if (params.seenCanvasAnnouncementIds.length === 0) return 0;
  const now = params.now ?? new Date();
  const updated = await db
    .update(canvasAnnouncements)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(canvasAnnouncements.connectionId, params.connectionId),
        eq(canvasAnnouncements.courseId, params.courseId),
        isNull(canvasAnnouncements.archivedAt),
        notInArray(canvasAnnouncements.canvasAnnouncementId, [...params.seenCanvasAnnouncementIds]),
      ),
    )
    .returning({ id: canvasAnnouncements.id });
  return updated.length;
}

// ---------------------------------------------------------------------------
// Calendar events
// ---------------------------------------------------------------------------

export async function upsertCanvasCalendarEvents(
  db: Db,
  params: { connectionId: string; courseId: string; rows: readonly CanvasCalendarEventRow[] },
): Promise<UpsertCounts> {
  if (params.rows.length === 0) return { ...EMPTY_COUNTS };

  const values = params.rows.map((row) => ({
    connectionId: params.connectionId,
    courseId: params.courseId,
    canvasEventId: toCanvasId(row.externalId),
    title: row.title ?? "",
    startsAt: row.startAt,
    endsAt: row.endAt,
    allDay: row.allDay,
    locationName: row.locationName,
    htmlUrl: row.htmlUrl,
  }));

  const returned = await db
    .insert(canvasEvents)
    .values(values)
    .onConflictDoUpdate({
      target: [canvasEvents.connectionId, canvasEvents.canvasEventId],
      set: {
        courseId: sql`excluded.course_id`,
        title: sql`excluded.title`,
        startsAt: sql`excluded.starts_at`,
        endsAt: sql`excluded.ends_at`,
        allDay: sql`excluded.all_day`,
        locationName: sql`excluded.location_name`,
        htmlUrl: sql`excluded.html_url`,
        archivedAt: sql`null`,
        updatedAt: sql`now()`,
      },
      setWhere: sql`${canvasEvents.courseId} is distinct from excluded.course_id
        or ${canvasEvents.title} is distinct from excluded.title
        or ${canvasEvents.startsAt} is distinct from excluded.starts_at
        or ${canvasEvents.endsAt} is distinct from excluded.ends_at
        or ${canvasEvents.allDay} is distinct from excluded.all_day
        or ${canvasEvents.locationName} is distinct from excluded.location_name
        or ${canvasEvents.htmlUrl} is distinct from excluded.html_url
        or ${canvasEvents.archivedAt} is not null`,
    })
    .returning({ inserted: WAS_INSERT });

  const inserted = returned.filter((r) => r.inserted).length;
  return {
    inserted,
    updated: returned.length - inserted,
    unchanged: values.length - returned.length,
  };
}

export async function archiveMissingCanvasEvents(
  db: Db,
  params: {
    connectionId: string;
    courseId: string;
    seenCanvasEventIds: readonly number[];
    now?: Date;
  },
): Promise<number> {
  if (params.seenCanvasEventIds.length === 0) return 0;
  const now = params.now ?? new Date();
  const updated = await db
    .update(canvasEvents)
    .set({ archivedAt: now, updatedAt: now })
    .where(
      and(
        eq(canvasEvents.connectionId, params.connectionId),
        eq(canvasEvents.courseId, params.courseId),
        isNull(canvasEvents.archivedAt),
        notInArray(canvasEvents.canvasEventId, [...params.seenCanvasEventIds]),
      ),
    )
    .returning({ id: canvasEvents.id });
  return updated.length;
}
