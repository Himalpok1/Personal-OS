import { canvasAssignments, canvasConnections, canvasCourses, type Db } from "@personal-os/db";
import {
  CanvasUpcomingAssignmentsQuerySchema,
  CanvasUpcomingAssignmentsResponseSchema,
} from "@personal-os/schema";
import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

// GET /canvas-assignments/upcoming (ADR-068, Checkpoint 10.1) -- the read
// endpoint the mobile Canvas integration needs and that connection-lifecycle
// routes alone can never provide: canvas-connections.ts manages CONNECTIONS,
// never the courses/assignments/announcements/events the worker syncs into
// their own tables. Read-only, Tailscale-perimeter-only, like every other
// route in this integration.
//
// RETAINED FOR THE versionCode-22 CLIENT; SUPERSEDED FOR NEW CLIENTS
// (Checkpoint 10.2, ADR-070). The Rabbit R1 build shipped at 10.1B reads this
// route for its Today "upcoming assignments" card, so it stays registered
// with its wire shape BYTE-IDENTICAL to 10.1: that build parses the response
// through the 10.1 `CanvasUpcomingAssignmentSchema`, which is `.strict()`, so
// the `score`/`grade` columns migration 0021 added (ADR-068a) are deliberately
// NOT selected or emitted here -- an added key would make the deployed client
// reject the payload and its Canvas card vanish. The schema `.omit()`s them
// for the same reason. New clients read `GET /academic/today`
// (routes/academic.ts, read-models/academic.ts), which carries the normalized
// submission/grade projection and the frozen overdue/due-today/due-this-week
// buckets. Remove this route once versionCode 23 is installed on the device.
//
// Scoped to ASSIGNMENTS ONLY for this checkpoint, matching the mobile Today
// card's actual ask ("up to 5 upcoming assignments due within 7 days") rather
// than opening a full course/announcement/event browsing surface with no
// consumer yet. A `GET /canvas-courses` or `.../events/upcoming` route is a
// strictly additive follow-up, not a redesign, if a future screen needs one.
//
// Denormalizes the course name onto each row (CanvasUpcomingAssignmentSchema)
// so the client never needs a second round trip per assignment -- the same
// reasoning Today/Agenda already apply to project names on task rows.
export default function canvasAssignmentsRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>(
    "/canvas-assignments/upcoming",
    async (request) => {
      const query = CanvasUpcomingAssignmentsQuerySchema.parse(request.query);
      const items = await listUpcomingCanvasAssignments(app.db, query.within_days, new Date());
      return CanvasUpcomingAssignmentsResponseSchema.parse({ items });
    },
  );
}

/**
 * Assignments due in `[now, now + withinDays]`, across every ACTIVE
 * connection's unarchived courses, excluding archived assignments -- an
 * assignment or course a sync has archived (removed on the Canvas side, or
 * the connection disconnected and later reconnected to a fresh institution)
 * is not "coming up" by definition. Ordered by `due_at` ascending; the
 * caller (today the mobile Today card) decides how many of the sorted list
 * to actually render.
 *
 * A disconnected connection's rows are excluded via the `canvas_connections`
 * join rather than by cascading an archive down to every child row on
 * disconnect -- disconnect intentionally leaves the cache intact (ADR-068
 * §6/`disconnectCanvasConnection`'s own doc comment) so a reconnect needs no
 * backfill; this query is simply never asked to surface a paused
 * institution's assignments while it is paused.
 */
export async function listUpcomingCanvasAssignments(
  db: Db,
  withinDays: number,
  now: Date,
): Promise<Array<Record<string, unknown>>> {
  const horizon = new Date(now.getTime() + withinDays * 24 * 60 * 60 * 1000);

  const rows = await db
    .select({
      id: canvasAssignments.id,
      courseId: canvasAssignments.courseId,
      canvasAssignmentId: canvasAssignments.canvasAssignmentId,
      title: canvasAssignments.title,
      dueAt: canvasAssignments.dueAt,
      pointsPossible: canvasAssignments.pointsPossible,
      submissionTypes: canvasAssignments.submissionTypes,
      htmlUrl: canvasAssignments.htmlUrl,
      published: canvasAssignments.published,
      submissionState: canvasAssignments.submissionState,
      submissionMissing: canvasAssignments.submissionMissing,
      submissionLate: canvasAssignments.submissionLate,
      submittedAt: canvasAssignments.submittedAt,
      archivedAt: canvasAssignments.archivedAt,
      courseName: canvasCourses.name,
      canvasBaseUrl: canvasConnections.canvasBaseUrl,
    })
    .from(canvasAssignments)
    .innerJoin(canvasCourses, eq(canvasAssignments.courseId, canvasCourses.id))
    .innerJoin(canvasConnections, eq(canvasAssignments.connectionId, canvasConnections.id))
    .where(
      and(
        eq(canvasConnections.status, "active"),
        isNull(canvasCourses.archivedAt),
        isNull(canvasAssignments.archivedAt),
        gte(canvasAssignments.dueAt, now),
        lte(canvasAssignments.dueAt, horizon),
      ),
    )
    .orderBy(asc(canvasAssignments.dueAt));

  return rows.map((row) => ({
    id: row.id,
    course_id: row.courseId,
    canvas_assignment_id: row.canvasAssignmentId,
    title: row.title,
    due_at: row.dueAt?.toISOString() ?? null,
    points_possible: row.pointsPossible,
    submission_types: row.submissionTypes,
    html_url: row.htmlUrl,
    published: row.published,
    submission_state: row.submissionState,
    submission_missing: row.submissionMissing,
    submission_late: row.submissionLate,
    submitted_at: row.submittedAt?.toISOString() ?? null,
    archived_at: row.archivedAt?.toISOString() ?? null,
    course_name: row.courseName,
    canvas_base_url: row.canvasBaseUrl,
  }));
}
