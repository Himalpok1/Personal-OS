import { canvasAssignments, canvasCourses, canvasSyncRuns, type Db } from "@personal-os/db";
import {
  CanvasApiError,
  createFakeCanvasClient,
  type FakeCanvasClient,
} from "@personal-os/canvas-providers";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestDb } from "../test/build-test-db.js";
import { runCanvasConnectionSync } from "./orchestrate.js";
import { seedCanvasConnection, truncateCanvasTestTables } from "./test-fixtures.js";

const db: Db = buildTestDb();
let client: FakeCanvasClient;

const NOW = new Date("2026-09-16T12:00:00.000Z");

function deps() {
  return { db, client, now: () => NOW };
}

function course(id: number, name: string) {
  return {
    id,
    name,
    course_code: `CS-${id}`,
    workflow_state: "available",
    html_url: `https://x/${id}`,
  };
}

async function coursesFor(connectionId: string) {
  return await db
    .select({
      canvasCourseId: canvasCourses.canvasCourseId,
      name: canvasCourses.name,
      archivedAt: canvasCourses.archivedAt,
    })
    .from(canvasCourses)
    .where(eq(canvasCourses.connectionId, connectionId))
    .orderBy(asc(canvasCourses.canvasCourseId));
}

async function runsFor(connectionId: string) {
  return await db
    .select({
      status: canvasSyncRuns.status,
      coursesSynced: canvasSyncRuns.coursesSynced,
      assignmentsSynced: canvasSyncRuns.assignmentsSynced,
      failureClass: canvasSyncRuns.failureClass,
    })
    .from(canvasSyncRuns)
    .where(eq(canvasSyncRuns.connectionId, connectionId))
    .orderBy(asc(canvasSyncRuns.startedAt), asc(canvasSyncRuns.id));
}

beforeEach(async () => {
  await truncateCanvasTestTables(db);
  client = createFakeCanvasClient();
});

afterAll(async () => {
  await truncateCanvasTestTables(db);
  await db.$client.end();
});

describe("runCanvasConnectionSync", () => {
  it("syncs 2+ courses end to end: courses, assignments, announcements, events", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(101, "Intro to Widgets"), course(102, "Advanced Widgets")]);
    client.queueAssignments([{ id: 1, name: "HW1", due_at: "2026-09-20T00:00:00Z" }]);
    client.queueAnnouncements([{ id: 10, title: "Welcome", message: "<p>Hi</p>" }]);
    client.queueCalendarEvents([]);
    client.queueAssignments([{ id: 2, name: "HW2" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([
      { id: 20, title: "Office hours", start_at: "2026-09-21T00:00:00Z" },
    ]);

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.skipped).toBeNull();
    expect(result.coursesSeen).toBe(2);
    expect(result.coursesFailed).toBe(0);
    expect(result.assignmentsSynced).toBe(2);
    expect(result.announcementsSynced).toBe(1);
    expect(result.eventsSynced).toBe(1);

    const stored = await coursesFor(connection.id);
    expect(stored.map((c) => c.canvasCourseId)).toEqual([101, 102]);

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("succeeded");
    expect(runs[0]?.coursesSynced).toBe(2);
    expect(runs[0]?.assignmentsSynced).toBe(2);

    // Every queued response was consumed -- nobody made a call nobody intended.
    expect(client.pending()).toEqual({
      getSelf: 0,
      listActiveCourses: 0,
      listAssignments: 0,
      listAnnouncements: 0,
      listCalendarEvents: 0,
    });
  });

  it("contains one course's fetch failure -- the OTHER course still syncs fully", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(201, "Failing Course"), course(202, "Healthy Course")]);
    // Course 201's assignments call throws.
    client.queueAssignments(new CanvasApiError(500, "provider_error"));
    // Course 202 succeeds fully.
    client.queueAssignments([{ id: 3, name: "HW3" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.coursesSeen).toBe(2);
    expect(result.coursesFailed).toBe(1);
    expect(result.assignmentsSynced).toBe(1);

    const stored = await coursesFor(connection.id);
    // BOTH course rows exist (course-level upsert happens before the child
    // fetch that fails) and NEITHER is archived -- a failed course must not be
    // treated as evidence of anything, including its own absence.
    expect(stored).toHaveLength(2);
    expect(stored.every((c) => c.archivedAt === null)).toBe(true);

    const assignmentRows = await db
      .select({ courseId: canvasAssignments.courseId })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    // Only course 202's assignment landed; course 201 has none.
    expect(assignmentRows).toHaveLength(1);

    // The run as a WHOLE still succeeded -- containment, not failure
    // propagation.
    const runs = await runsFor(connection.id);
    expect(runs[0]?.status).toBe("succeeded");
  });

  it("an unchanged second pass writes zero new/updated rows (the setWhere idempotency gate)", async () => {
    const connection = await seedCanvasConnection(db);
    const payload = () => {
      client.queueActiveCourses([course(301, "Stable Course")]);
      client.queueAssignments([{ id: 5, name: "HW5", due_at: "2026-09-22T00:00:00Z" }]);
      client.queueAnnouncements([{ id: 50, title: "Reminder", message: "text" }]);
      client.queueCalendarEvents([]);
    };

    payload();
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    const [courseRowBefore] = await db
      .select({ id: canvasCourses.id, updatedAt: canvasCourses.updatedAt })
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, connection.id));
    const [assignmentRowBefore] = await db
      .select({ id: canvasAssignments.id, updatedAt: canvasAssignments.updatedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));

    payload();
    const secondResult = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(secondResult.coursesSeen).toBe(1);
    expect(secondResult.assignmentsSynced).toBe(1); // "seen" count, not "changed"

    const [courseRowAfter] = await db
      .select({ id: canvasCourses.id, updatedAt: canvasCourses.updatedAt })
      .from(canvasCourses)
      .where(eq(canvasCourses.connectionId, connection.id));
    const [assignmentRowAfter] = await db
      .select({ id: canvasAssignments.id, updatedAt: canvasAssignments.updatedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));

    // Identical `updated_at`: the hash-gated upsert wrote NOTHING the second
    // time, which is the property this file exists to guarantee.
    expect(courseRowAfter?.updatedAt.getTime()).toBe(courseRowBefore?.updatedAt.getTime());
    expect(assignmentRowAfter?.updatedAt.getTime()).toBe(assignmentRowBefore?.updatedAt.getTime());
  });

  it("archives a course removed from Canvas on the NEXT authoritative pass", async () => {
    const connection = await seedCanvasConnection(db);

    client.queueActiveCourses([course(401, "Course A"), course(402, "Course B")]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    // Course B drops off the list (dropped, term ended, etc).
    client.queueActiveCourses([course(401, "Course A")]);
    client.queueAssignments([]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });

    expect(result.coursesArchived).toBe(1);
    const stored = await coursesFor(connection.id);
    const courseA = stored.find((c) => c.canvasCourseId === 401);
    const courseB = stored.find((c) => c.canvasCourseId === 402);
    expect(courseA?.archivedAt).toBeNull();
    expect(courseB?.archivedAt).not.toBeNull();
  });

  it("does NOT archive a course's assignments when that course's OWN fetch failed this round", async () => {
    const connection = await seedCanvasConnection(db);

    // First pass: course 501 has one assignment, fully authoritative.
    client.queueActiveCourses([course(501, "Course With Homework")]);
    client.queueAssignments([{ id: 7, name: "HW7" }]);
    client.queueAnnouncements([]);
    client.queueCalendarEvents([]);
    await runCanvasConnectionSync(deps(), { connectionId: connection.id, kind: "cron" });

    const [before] = await db
      .select({ archivedAt: canvasAssignments.archivedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    expect(before?.archivedAt).toBeNull();

    // Second pass: the course is still listed, but its assignments call
    // throws (a transient provider error) -- Canvas never actually said the
    // assignment is gone.
    client.queueActiveCourses([course(501, "Course With Homework")]);
    client.queueAssignments(new CanvasApiError(503, "provider_error"));

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.coursesFailed).toBe(1);
    expect(result.assignmentsArchived).toBe(0);

    const [after] = await db
      .select({ archivedAt: canvasAssignments.archivedAt })
      .from(canvasAssignments)
      .where(eq(canvasAssignments.connectionId, connection.id));
    // Still NOT archived: a failed fetch is not evidence of absence.
    expect(after?.archivedAt).toBeNull();
  });

  it("skips a non-active connection and writes no run row", async () => {
    const connection = await seedCanvasConnection(db, { status: "disconnected" });
    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.skipped).toBe("connection_not_active");
    expect(result.runWritten).toBe(false);
    expect(await runsFor(connection.id)).toHaveLength(0);
  });

  it("closes the run as failed, and never as succeeded, when the course LIST itself fails", async () => {
    const connection = await seedCanvasConnection(db);
    client.queueActiveCourses(new CanvasApiError(401, "auth_failed"));

    const result = await runCanvasConnectionSync(deps(), {
      connectionId: connection.id,
      kind: "cron",
    });
    expect(result.failureClass).toBe("auth_failed");

    const runs = await runsFor(connection.id);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("failed");
    expect(runs[0]?.failureClass).toBe("auth_failed");
  });
});
