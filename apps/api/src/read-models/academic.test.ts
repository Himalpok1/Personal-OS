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
  ACADEMIC_EVENTS_ITEM_CAP,
  ACADEMIC_OVERDUE_ITEM_CAP,
  AcademicCourseDetailResponseSchema,
  AcademicCoursesResponseSchema,
  AcademicTodayResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../test/build-test-app.js";
import {
  buildAcademicTodayResponse,
  getAcademicCourseDetail,
  listAcademicCourses,
} from "./academic.js";

// The academic read model (Checkpoint 10.2, ADR-070), exercised directly with
// a pinned `now` so every bucket boundary is deterministic -- the same seam
// today.9-5-semantics.test.ts uses on buildTodayResponse. The HTTP contract
// (400/404 shapes, route registration) is routes/academic.test.ts.

let app: FastifyInstance;

const TZ = "America/Chicago";
// 2026-09-16 14:00 CDT. Today's local window is [05:00Z 09-16, 05:00Z 09-17);
// the 7-day horizon ends at 05:00Z 09-24 (start of local 09-24).
const NOW = new Date("2026-09-16T19:00:00Z");
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const at = (value: string): Date => new Date(value);
const plus = (ms: number): Date => new Date(NOW.getTime() + ms);

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // Every canvas_* child table cascades from canvas_connections
  // (canvas-connections.test.ts's own beforeEach reasoning).
  await app.db.delete(canvasConnections);
});

let seq = 0;
const nextSeq = (): number => {
  seq += 1;
  return seq;
};

async function seedConnection(
  db: Db,
  overrides: Partial<typeof canvasConnections.$inferInsert> = {},
) {
  const [row] = await db
    .insert(canvasConnections)
    .values({
      canvasBaseUrl: `https://${crypto.randomUUID()}.instructure.com`,
      canvasUserId: 1,
      canvasUserName: "Test Student",
      status: "active",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedCourse(
  db: Db,
  connectionId: string,
  overrides: Partial<typeof canvasCourses.$inferInsert> = {},
) {
  const [row] = await db
    .insert(canvasCourses)
    .values({
      connectionId,
      canvasCourseId: nextSeq(),
      name: "Intro to Testing",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedAssignment(
  db: Db,
  connectionId: string,
  courseId: string,
  overrides: Partial<typeof canvasAssignments.$inferInsert> = {},
) {
  const [row] = await db
    .insert(canvasAssignments)
    .values({
      connectionId,
      courseId,
      canvasAssignmentId: nextSeq(),
      title: `Assignment ${seq}`,
      dueAt: plus(2 * DAY),
      published: true,
      submissionState: "unsubmitted",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedAnnouncement(
  db: Db,
  connectionId: string,
  courseId: string,
  overrides: Partial<typeof canvasAnnouncements.$inferInsert> = {},
) {
  const [row] = await db
    .insert(canvasAnnouncements)
    .values({
      connectionId,
      courseId,
      canvasAnnouncementId: nextSeq(),
      title: `Announcement ${seq}`,
      messagePreview: "Preview text",
      postedAt: plus(-1 * DAY),
      readState: "unread",
      ...overrides,
    })
    .returning();
  return row!;
}

async function seedEvent(
  db: Db,
  connectionId: string,
  courseId: string | null,
  overrides: Partial<typeof canvasEvents.$inferInsert> = {},
) {
  const [row] = await db
    .insert(canvasEvents)
    .values({
      connectionId,
      courseId,
      canvasEventId: nextSeq(),
      title: `Event ${seq}`,
      startsAt: plus(1 * DAY),
      endsAt: plus(1 * DAY + HOUR),
      allDay: false,
      ...overrides,
    })
    .returning();
  return row!;
}

const today = () => buildAcademicTodayResponse(app.db, { tz: TZ }, { now: NOW });
const ids = (items: ReadonlyArray<{ id: string }>): string[] => items.map((i) => i.id);

describe("buildAcademicTodayResponse -- configuration and scope", () => {
  it("answers configured:false with empty sections and zero totals when no connection exists", async () => {
    const res = await today();
    expect(res.configured).toBe(false);
    expect(res.tz).toBe(TZ);
    expect(res.local_date).toBe("2026-09-16");
    expect(res.effective_now).toBe(NOW.toISOString());
    expect(res.generated_at).toBe(NOW.toISOString());
    expect(res.summary).toEqual({
      overdue_total: 0,
      due_today_total: 0,
      due_this_week_total: 0,
      missing_total: 0,
      unread_announcements_total: 0,
    });
    for (const section of [
      "overdue",
      "due_today",
      "due_this_week",
      "announcements",
      "events",
    ] as const) {
      expect(res[section]).toEqual({ items: [], total: 0 });
    }
    expect(AcademicTodayResponseSchema.parse(res)).toEqual(res);
  });

  it("a disconnected connection alone is not configured, and its rows never surface", async () => {
    const paused = await seedConnection(app.db, { status: "disconnected" });
    const course = await seedCourse(app.db, paused.id);
    await seedAssignment(app.db, paused.id, course.id, { dueAt: plus(-1 * DAY) });
    await seedAnnouncement(app.db, paused.id, course.id);
    await seedEvent(app.db, paused.id, course.id);

    const res = await today();
    expect(res.configured).toBe(false);
    expect(res.summary.overdue_total).toBe(0);
  });

  it("excludes a disconnected connection's rows while an active one is configured", async () => {
    const active = await seedConnection(app.db);
    const paused = await seedConnection(app.db, { status: "disconnected" });
    const liveCourse = await seedCourse(app.db, active.id, { name: "Live" });
    const pausedCourse = await seedCourse(app.db, paused.id, { name: "Paused" });
    const live = await seedAssignment(app.db, active.id, liveCourse.id, { dueAt: plus(-HOUR) });
    await seedAssignment(app.db, paused.id, pausedCourse.id, { dueAt: plus(-HOUR) });
    await seedAnnouncement(app.db, paused.id, pausedCourse.id);
    await seedEvent(app.db, paused.id, pausedCourse.id);

    const res = await today();
    expect(res.configured).toBe(true);
    expect(ids(res.overdue.items)).toEqual([live.id]);
    expect(res.overdue.total).toBe(1);
    expect(res.announcements.total).toBe(0);
    expect(res.events.total).toBe(0);
  });

  it("excludes an archived course's rows and an archived assignment", async () => {
    const connection = await seedConnection(app.db);
    const liveCourse = await seedCourse(app.db, connection.id);
    const deadCourse = await seedCourse(app.db, connection.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    const kept = await seedAssignment(app.db, connection.id, liveCourse.id, { dueAt: plus(-HOUR) });
    await seedAssignment(app.db, connection.id, liveCourse.id, {
      dueAt: plus(-HOUR),
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    await seedAssignment(app.db, connection.id, deadCourse.id, { dueAt: plus(-HOUR) });
    await seedAnnouncement(app.db, connection.id, deadCourse.id);
    await seedAnnouncement(app.db, connection.id, liveCourse.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    await seedEvent(app.db, connection.id, deadCourse.id);
    await seedEvent(app.db, connection.id, liveCourse.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });

    const res = await today();
    expect(ids(res.overdue.items)).toEqual([kept.id]);
    expect(res.overdue.total).toBe(1);
    expect(res.announcements.total).toBe(0);
    expect(res.events.total).toBe(0);
  });
});

describe("buildAcademicTodayResponse -- the three assignment buckets", () => {
  it("overdue takes precedence over due_today for an item due earlier today", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const earlierToday = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-16T14:00:00Z"), // 09:00 CDT today
    });
    const laterToday = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-16T23:00:00Z"), // 18:00 CDT today
    });
    const lastInstantToday = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-17T04:59:59Z"),
    });

    const res = await today();
    expect(ids(res.overdue.items)).toEqual([earlierToday.id]);
    expect(ids(res.due_today.items)).toEqual([laterToday.id, lastInstantToday.id]);
    expect(res.due_this_week.items).toEqual([]);
    expect(res.summary.overdue_total).toBe(1);
    expect(res.summary.due_today_total).toBe(2);
  });

  it("due_this_week excludes today and stops at the end of the seventh local day", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const tomorrowMidnight = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-17T05:00:00Z"), // 00:00 CDT 09-17
    });
    const dayPlus7Last = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-24T04:59:59Z"), // 23:59:59 CDT 09-23
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-24T05:00:00Z"), // 00:00 CDT 09-24 -> beyond the horizon
    });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: at("2026-09-16T23:00:00Z") }); // today

    const res = await today();
    expect(ids(res.due_this_week.items)).toEqual([tomorrowMidnight.id, dayPlus7Last.id]);
    expect(res.summary.due_this_week_total).toBe(2);
    expect(res.summary.due_today_total).toBe(1);
  });

  it("never buckets a submitted, graded or pending_review assignment; unknown and null states stay open", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    for (const state of ["submitted", "graded", "pending_review"]) {
      await seedAssignment(app.db, connection.id, course.id, {
        dueAt: plus(-HOUR),
        submissionState: state,
      });
      await seedAssignment(app.db, connection.id, course.id, {
        dueAt: plus(3 * HOUR),
        submissionState: state,
      });
      await seedAssignment(app.db, connection.id, course.id, {
        dueAt: plus(2 * DAY),
        submissionState: state,
      });
    }
    const excused = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-HOUR),
      submissionState: "excused",
    });
    const nullState = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-2 * HOUR),
      submissionState: null,
    });

    const res = await today();
    expect(ids(res.overdue.items)).toEqual([nullState.id, excused.id]);
    expect(res.due_today.items).toEqual([]);
    expect(res.due_this_week.items).toEqual([]);
    const statuses = res.overdue.items.map((i) => i.submission.status);
    expect(statuses).toEqual(["unknown", "unknown"]);
    expect(res.overdue.items.every((i) => i.open)).toBe(true);
  });

  it("never buckets an undated assignment", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null });

    const res = await today();
    expect(
      res.summary.overdue_total + res.summary.due_today_total + res.summary.due_this_week_total,
    ).toBe(0);
  });

  it("orders a bucket by due_at, then title, then id", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const late = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-1 * DAY),
      title: "B",
    });
    const earlyB = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-2 * DAY),
      title: "B",
    });
    const earlyA = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-2 * DAY),
      title: "A",
    });

    const res = await today();
    expect(ids(res.overdue.items)).toEqual([earlyA.id, earlyB.id, late.id]);
  });

  it("reports an honest total above the item cap", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    for (let i = 0; i < ACADEMIC_OVERDUE_ITEM_CAP + 1; i += 1) {
      await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(-(i + 1) * HOUR) });
    }

    const res = await today();
    expect(res.overdue.items).toHaveLength(ACADEMIC_OVERDUE_ITEM_CAP);
    expect(res.overdue.total).toBe(ACADEMIC_OVERDUE_ITEM_CAP + 1);
    expect(res.summary.overdue_total).toBe(ACADEMIC_OVERDUE_ITEM_CAP + 1);
    expect(AcademicTodayResponseSchema.parse(res)).toEqual(res);
  });

  it("counts missing_total windowless over open assignments only", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-30 * DAY),
      submissionMissing: true,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(30 * DAY),
      submissionMissing: true,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: null,
      submissionMissing: true,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-30 * DAY),
      submissionMissing: true,
      submissionState: "graded",
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-30 * DAY),
      submissionMissing: false,
    });

    const res = await today();
    expect(res.summary.missing_total).toBe(3);
    // Only the two dated open ones reach overdue/this-week; missing is wider.
    expect(res.summary.overdue_total).toBe(2);
  });
});

describe("buildAcademicTodayResponse -- projection", () => {
  it("projects grade facts: percentage from score/points, status from the submission state", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, {
      name: "Real Analysis",
      courseCode: "MATH-3300",
    });
    const graded = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-HOUR),
      submissionState: "excused", // stays open so it surfaces; grade facts are independent of open
      score: 97,
      grade: "A",
      pointsPossible: 100,
    });
    const extraCredit = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-2 * HOUR),
      score: 110,
      grade: "110%",
      pointsPossible: 100,
    });
    const unscored = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-3 * HOUR),
      score: null,
      grade: null,
      pointsPossible: 100,
    });
    const zeroPoints = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-4 * HOUR),
      score: 5,
      grade: "complete",
      pointsPossible: 0,
    });

    const res = await today();
    const byId = new Map(res.overdue.items.map((i) => [i.id, i]));
    expect(byId.get(graded.id)?.grade).toEqual({
      status: "not_graded",
      score: 97,
      grade: "A",
      percentage: 97,
    });
    expect(byId.get(extraCredit.id)?.grade.percentage).toBe(110);
    expect(byId.get(unscored.id)?.grade).toEqual({
      status: "not_graded",
      score: null,
      grade: null,
      percentage: null,
    });
    expect(byId.get(zeroPoints.id)?.grade).toEqual({
      status: "not_graded",
      score: 5,
      grade: "complete",
      percentage: null,
    });
    expect(byId.get(graded.id)).toMatchObject({
      source: "canvas",
      external_id: String(graded.canvasAssignmentId),
      course_id: course.id,
      course_name: "Real Analysis",
      course_code: "MATH-3300",
      source_base_url: connection.canvasBaseUrl,
      open: true,
    });
    expect(typeof byId.get(graded.id)?.external_id).toBe("string");
  });

  it("derives grade.status from the submission state through the course detail (closed rows)", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const graded = await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: 8.5,
      pointsPossible: 10,
    });
    const pending = await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "pending_review",
    });
    const submitted = await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "submitted",
      submissionMissing: null,
      submissionLate: null,
    });

    const detail = await getAcademicCourseDetail(app.db, course.id, { now: NOW });
    const byId = new Map(detail!.assignments.map((i) => [i.id, i]));
    expect(byId.get(graded.id)?.grade).toMatchObject({ status: "graded", percentage: 85 });
    expect(byId.get(graded.id)?.open).toBe(false);
    expect(byId.get(pending.id)?.grade.status).toBe("pending_review");
    expect(byId.get(submitted.id)?.grade.status).toBe("not_graded");
    // A null Canvas flag reads as false on the wire, never as absent.
    expect(byId.get(submitted.id)?.submission).toEqual({
      status: "submitted",
      missing: false,
      late: false,
      submitted_at: null,
    });
  });
});

describe("buildAcademicTodayResponse -- announcements", () => {
  it("keeps announcements posted within the lookback, unread first, then newest", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { name: "Course" });
    const readRecent = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-1 * HOUR),
      readState: "read",
    });
    const unreadOld = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-6 * DAY),
      readState: "unread",
    });
    const unreadRecent = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-2 * DAY),
      readState: "unread",
    });
    const unknownState = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-3 * DAY),
      readState: null,
    });
    await seedAnnouncement(app.db, connection.id, course.id, { postedAt: plus(-8 * DAY) });
    await seedAnnouncement(app.db, connection.id, course.id, { postedAt: plus(HOUR) });
    await seedAnnouncement(app.db, connection.id, course.id, { postedAt: null });

    const res = await today();
    expect(ids(res.announcements.items)).toEqual([
      unreadRecent.id,
      unreadOld.id,
      unknownState.id,
      readRecent.id,
    ]);
    expect(res.announcements.total).toBe(4);
    expect(res.summary.unread_announcements_total).toBe(2);
    expect(res.announcements.items[0]).toMatchObject({
      source: "canvas",
      external_id: String(unreadRecent.canvasAnnouncementId),
      course_name: "Course",
      preview: "Preview text",
      read: false,
      source_base_url: connection.canvasBaseUrl,
    });
    expect(res.announcements.items[2]?.read).toBeNull();
    expect(res.announcements.items[3]?.read).toBe(true);
  });

  it("caps announcement items while keeping the total honest", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    for (let i = 0; i < ACADEMIC_ANNOUNCEMENTS_ITEM_CAP + 1; i += 1) {
      await seedAnnouncement(app.db, connection.id, course.id, { postedAt: plus(-(i + 1) * HOUR) });
    }
    const res = await today();
    expect(res.announcements.items).toHaveLength(ACADEMIC_ANNOUNCEMENTS_ITEM_CAP);
    expect(res.announcements.total).toBe(ACADEMIC_ANNOUNCEMENTS_ITEM_CAP + 1);
  });
});

describe("buildAcademicTodayResponse -- events", () => {
  it("keeps events upcoming or in progress before the end of local day + 7, ordered by start", async () => {
    // NOW is 2026-09-16T19:00Z = 14:00 America/Chicago; the horizon end shared
    // with due_this_week is the start of local 2026-09-24 (05:00Z).
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { name: "Course" });
    // Started an hour ago, still running: IN PROGRESS, kept (the 8.2 Today
    // debt is not repeated here).
    const inProgress = await seedEvent(app.db, connection.id, course.id, {
      startsAt: plus(-HOUR),
      endsAt: plus(HOUR),
    });
    // Started and ENDED before now: gone.
    await seedEvent(app.db, connection.id, course.id, {
      startsAt: plus(-3 * HOUR),
      endsAt: plus(-2 * HOUR),
    });
    // No ends_at: kept only when it starts at/after now.
    const atNow = await seedEvent(app.db, connection.id, course.id, {
      startsAt: NOW,
      endsAt: null,
    });
    await seedEvent(app.db, connection.id, course.id, { startsAt: plus(-HOUR), endsAt: null });
    const soon = await seedEvent(app.db, connection.id, course.id, { startsAt: plus(HOUR) });
    const personal = await seedEvent(app.db, connection.id, null, {
      startsAt: plus(6 * DAY),
      locationName: "Library",
      allDay: true,
    });
    // Day + 7 at 14:00 local is still BEFORE the local horizon end -- the same
    // day-based "this week" due_this_week applies, not 7 x 24h from now.
    const dayPlusSeven = await seedEvent(app.db, connection.id, course.id, {
      startsAt: plus(7 * DAY),
      endsAt: plus(7 * DAY + HOUR),
    });
    // Local 2026-09-24 00:00 (05:00Z) is the exclusive horizon end.
    await seedEvent(app.db, connection.id, course.id, {
      startsAt: at("2026-09-24T05:00:00Z"),
      endsAt: at("2026-09-24T06:00:00Z"),
    });
    await seedEvent(app.db, connection.id, course.id, { startsAt: null, endsAt: null });

    const res = await today();
    expect(ids(res.events.items)).toEqual([
      inProgress.id,
      atNow.id,
      soon.id,
      personal.id,
      dayPlusSeven.id,
    ]);
    expect(res.events.total).toBe(5);
    expect(res.events.items[3]).toEqual({
      kind: "calendar_event",
      id: personal.id,
      source: "canvas",
      course_id: null,
      course_name: null,
      title: personal.title,
      at: personal.startsAt!.toISOString(),
      ends_at: personal.endsAt!.toISOString(),
      all_day: true,
      location: "Library",
      html_url: null,
      source_base_url: connection.canvasBaseUrl,
    });
    expect(res.events.items[0]?.course_name).toBe("Course");
  });

  it("caps event items while keeping the total honest", async () => {
    const connection = await seedConnection(app.db);
    for (let i = 0; i < ACADEMIC_EVENTS_ITEM_CAP + 1; i += 1) {
      await seedEvent(app.db, connection.id, null, { startsAt: plus((i + 1) * HOUR) });
    }
    const res = await today();
    expect(res.events.items).toHaveLength(ACADEMIC_EVENTS_ITEM_CAP);
    expect(res.events.total).toBe(ACADEMIC_EVENTS_ITEM_CAP + 1);
  });
});

describe("listAcademicCourses", () => {
  const list = (includeArchived = false) =>
    listAcademicCourses(app.db, { include_archived: includeArchived }, { now: NOW });

  it("answers configured:false with no items when no active connection exists", async () => {
    await seedConnection(app.db, { status: "disconnected" });
    const res = await list();
    expect(res).toEqual({ configured: false, items: [] });
    expect(AcademicCoursesResponseSchema.parse(res)).toEqual(res);
  });

  it("orders by term start desc (nulls last), then code, then name, then id", async () => {
    const connection = await seedConnection(app.db);
    const noTerm = await seedCourse(app.db, connection.id, { name: "No term", termStartAt: null });
    const fallB = await seedCourse(app.db, connection.id, {
      name: "Fall B",
      courseCode: "B-100",
      termStartAt: at("2026-08-24T00:00:00Z"),
    });
    const fallA = await seedCourse(app.db, connection.id, {
      name: "Fall A",
      courseCode: "A-100",
      termStartAt: at("2026-08-24T00:00:00Z"),
    });
    const spring = await seedCourse(app.db, connection.id, {
      name: "Spring",
      courseCode: "Z-100",
      termStartAt: at("2026-01-12T00:00:00Z"),
    });
    const fallNoCode = await seedCourse(app.db, connection.id, {
      name: "Fall no code",
      courseCode: null,
      termStartAt: at("2026-08-24T00:00:00Z"),
    });

    const res = await list();
    expect(res.configured).toBe(true);
    expect(ids(res.items)).toEqual([fallA.id, fallB.id, fallNoCode.id, spring.id, noTerm.id]);
  });

  it("computes open/overdue counts and next_due_at from the course's open assignments", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { name: "Counted" });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(-2 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(-1 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(3 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(1 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(HOUR),
      submissionState: "submitted",
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-HOUR),
      submissionState: "graded",
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-3 * DAY),
      archivedAt: at("2026-09-01T00:00:00Z"),
    });

    const res = await list();
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({
      id: course.id,
      source: "canvas",
      external_id: String(course.canvasCourseId),
      connection_id: connection.id,
      name: "Counted",
      status: "active",
      source_base_url: connection.canvasBaseUrl,
      open_assignment_count: 5,
      overdue_assignment_count: 2,
      next_due_at: plus(1 * DAY).toISOString(),
    });
  });

  it("next_due_at is null when nothing open is due at or after now", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(-1 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null });

    const res = await list();
    expect(res.items[0]).toMatchObject({
      open_assignment_count: 2,
      overdue_assignment_count: 1,
      next_due_at: null,
    });
  });

  it("hides archived courses by default and surfaces them as status:archived on request", async () => {
    const connection = await seedConnection(app.db);
    const live = await seedCourse(app.db, connection.id, { name: "Live" });
    const archived = await seedCourse(app.db, connection.id, {
      name: "Archived",
      archivedAt: at("2026-09-01T00:00:00Z"),
      enrollmentState: "completed",
    });

    const hidden = await list(false);
    expect(ids(hidden.items)).toEqual([live.id]);

    const shown = await list(true);
    const byId = new Map(shown.items.map((i) => [i.id, i]));
    expect(byId.get(archived.id)?.status).toBe("archived");
    expect(byId.get(archived.id)?.archived_at).toBe("2026-09-01T00:00:00.000Z");
    expect(byId.get(live.id)?.status).toBe("active");
  });

  it("derives completed from either Canvas state and carries the term", async () => {
    const connection = await seedConnection(app.db);
    const byEnrollment = await seedCourse(app.db, connection.id, {
      enrollmentState: "completed",
      termName: "Spring 2026",
      termStartAt: at("2026-01-12T00:00:00Z"),
      termEndAt: at("2026-05-15T00:00:00Z"),
    });
    const byWorkflow = await seedCourse(app.db, connection.id, { workflowState: "completed" });
    const active = await seedCourse(app.db, connection.id, {
      enrollmentState: "active",
      workflowState: "available",
    });

    const res = await list();
    const byId = new Map(res.items.map((i) => [i.id, i]));
    expect(byId.get(byEnrollment.id)?.status).toBe("completed");
    expect(byId.get(byEnrollment.id)?.term).toEqual({
      name: "Spring 2026",
      starts_at: "2026-01-12T00:00:00.000Z",
      ends_at: "2026-05-15T00:00:00.000Z",
    });
    expect(byId.get(byWorkflow.id)?.status).toBe("completed");
    expect(byId.get(active.id)?.status).toBe("active");
    expect(byId.get(active.id)?.term).toEqual({ name: null, starts_at: null, ends_at: null });
  });

  it("excludes courses of a disconnected connection even with include_archived", async () => {
    const paused = await seedConnection(app.db, { status: "disconnected" });
    const active = await seedConnection(app.db);
    await seedCourse(app.db, paused.id, { name: "Paused" });
    const live = await seedCourse(app.db, active.id, { name: "Live" });

    const res = await list(true);
    expect(ids(res.items)).toEqual([live.id]);
  });
});

describe("getAcademicCourseDetail", () => {
  it("returns null for an unknown and a paused-connection course; an archived course opens as archived", async () => {
    const active = await seedConnection(app.db);
    const paused = await seedConnection(app.db, { status: "disconnected" });
    const archived = await seedCourse(app.db, active.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    const pausedCourse = await seedCourse(app.db, paused.id);

    expect(await getAcademicCourseDetail(app.db, crypto.randomUUID(), { now: NOW })).toBeNull();
    expect(await getAcademicCourseDetail(app.db, pausedCourse.id, { now: NOW })).toBeNull();
    // A course the list can surface (include_archived=true) must be openable.
    const detail = await getAcademicCourseDetail(app.db, archived.id, { now: NOW });
    expect(detail?.course.status).toBe("archived");
  });

  it("returns the course summary with every unarchived child row, in the documented orders", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { name: "Detail" });
    const other = await seedCourse(app.db, connection.id, { name: "Other" });

    const undated = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: null,
      title: "Undated",
    });
    const laterB = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(2 * DAY),
      title: "B",
    });
    const laterA = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(2 * DAY),
      title: "A",
    });
    const pastGraded = await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(-30 * DAY),
      submissionState: "graded",
      score: 9,
      pointsPossible: 10,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    await seedAssignment(app.db, connection.id, other.id);

    const oldNews = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-40 * DAY), // well outside Today's lookback, still listed here
    });
    const recentNews = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: plus(-1 * DAY),
      readState: "read",
    });
    const undatedNews = await seedAnnouncement(app.db, connection.id, course.id, {
      postedAt: null,
    });
    await seedAnnouncement(app.db, connection.id, course.id, {
      archivedAt: at("2026-09-01T00:00:00Z"),
    });
    await seedAnnouncement(app.db, connection.id, other.id);

    const laterEvent = await seedEvent(app.db, connection.id, course.id, {
      startsAt: plus(5 * DAY),
    });
    const pastEvent = await seedEvent(app.db, connection.id, course.id, {
      startsAt: plus(-5 * DAY),
    });
    await seedEvent(app.db, connection.id, course.id, { archivedAt: at("2026-09-01T00:00:00Z") });
    await seedEvent(app.db, connection.id, other.id);
    await seedEvent(app.db, connection.id, null);

    const detail = await getAcademicCourseDetail(app.db, course.id, { now: NOW });
    expect(detail).not.toBeNull();
    expect(AcademicCourseDetailResponseSchema.parse(detail)).toEqual(detail);
    expect(detail!.course).toMatchObject({
      id: course.id,
      name: "Detail",
      open_assignment_count: 3,
      overdue_assignment_count: 0,
      next_due_at: plus(2 * DAY).toISOString(),
    });
    expect(ids(detail!.assignments)).toEqual([pastGraded.id, laterA.id, laterB.id, undated.id]);
    expect(ids(detail!.announcements)).toEqual([recentNews.id, oldNews.id, undatedNews.id]);
    expect(ids(detail!.events)).toEqual([pastEvent.id, laterEvent.id]);
    expect(
      detail!.events.every((e) => e.kind === "calendar_event" && e.course_id === course.id),
    ).toBe(true);
  });
});
