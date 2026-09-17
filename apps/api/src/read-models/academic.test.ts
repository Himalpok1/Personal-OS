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
  ACADEMIC_COURSE_ATTENTION_ITEM_CAP,
  ACADEMIC_EVENTS_ITEM_CAP,
  ACADEMIC_OVERDUE_ITEM_CAP,
  ACADEMIC_PRIORITIES_ITEM_CAP,
  ACADEMIC_UPCOMING_DAY_COUNT,
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
  it("ADR-070a: only the current term's courses feed Today; a personal event is never term-filtered", async () => {
    const connection = await seedConnection(app.db);
    const fall = await seedCourse(app.db, connection.id, {
      name: "Fall course",
      termName: "2026 Fall",
      termStartAt: at("2026-08-03T05:00:00Z"),
    });
    const spring = await seedCourse(app.db, connection.id, {
      name: "Spring course",
      termName: "2026 Spring",
      termStartAt: at("2025-12-15T06:00:00Z"),
    });
    const undated = await seedCourse(app.db, connection.id, {
      name: "Compliance",
      termName: "Default Term",
      termStartAt: null,
    });
    const fallOverdue = await seedAssignment(app.db, connection.id, fall.id, {
      title: "Fall overdue",
      dueAt: plus(-DAY),
    });
    await seedAssignment(app.db, connection.id, spring.id, {
      title: "Spring overdue",
      dueAt: plus(-30 * DAY),
    });
    await seedAssignment(app.db, connection.id, undated.id, {
      title: "Compliance overdue",
      dueAt: plus(-60 * DAY),
      submissionMissing: true,
    });
    const fallNews = await seedAnnouncement(app.db, connection.id, fall.id, {
      postedAt: plus(-HOUR),
      readState: "unread",
    });
    await seedAnnouncement(app.db, connection.id, spring.id, {
      postedAt: plus(-HOUR),
      readState: "unread",
    });
    const personal = await seedEvent(app.db, connection.id, null, { startsAt: plus(HOUR) });
    await seedEvent(app.db, connection.id, spring.id, { startsAt: plus(2 * HOUR) });

    const res = await today();
    expect(res.current_term).toEqual({ name: "2026 Fall", starts_at: "2026-08-03T05:00:00.000Z" });
    expect(ids(res.overdue.items)).toEqual([fallOverdue.id]);
    expect(res.summary.overdue_total).toBe(1);
    // Canvas's own missing flag is counted over the SAME scope, not the whole cache.
    expect(res.summary.missing_total).toBe(0);
    expect(ids(res.announcements.items)).toEqual([fallNews.id]);
    expect(res.summary.unread_announcements_total).toBe(1);
    expect(ids(res.events.items)).toEqual([personal.id]);
  });

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
  const list = (includeArchived = false, includePastTerms = false) =>
    listAcademicCourses(
      app.db,
      { include_archived: includeArchived, include_past_terms: includePastTerms },
      { now: NOW },
    );

  it("answers configured:false with no items when no active connection exists", async () => {
    await seedConnection(app.db, { status: "disconnected" });
    const res = await list();
    expect(res).toEqual({ configured: false, current_term: null, items: [] });
    expect(AcademicCoursesResponseSchema.parse(res)).toEqual(res);
  });

  it("orders by term start desc (nulls last), then code, then name, then id", async () => {
    const connection = await seedConnection(app.db);
    const noTerm = await seedCourse(app.db, connection.id, { name: "No term", termStartAt: null });
    const fallB = await seedCourse(app.db, connection.id, {
      name: "Fall B",
      courseCode: "B-100",
      termName: "2026 Fall",
      termStartAt: at("2026-08-24T00:00:00Z"),
    });
    const fallA = await seedCourse(app.db, connection.id, {
      name: "Fall A",
      courseCode: "A-100",
      termName: "2026 Fall",
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
      termName: "2026 Fall",
      termStartAt: at("2026-08-24T00:00:00Z"),
    });

    const res = await list(false, true);
    expect(res.configured).toBe(true);
    expect(ids(res.items)).toEqual([fallA.id, fallB.id, fallNoCode.id, spring.id, noTerm.id]);
    expect(res.current_term).toEqual({ name: "2026 Fall", starts_at: "2026-08-24T00:00:00.000Z" });

    // ADR-070a: the DEFAULT view is the current term only -- the most recently
    // started term (Fall), never Spring and never an undated course.
    const current = await list();
    expect(ids(current.items)).toEqual([fallA.id, fallB.id, fallNoCode.id]);
    expect(current.current_term).toEqual({
      name: "2026 Fall",
      starts_at: "2026-08-24T00:00:00.000Z",
    });
  });

  it("ADR-070a: with no started term anywhere, nothing is filtered and current_term is null", async () => {
    const connection = await seedConnection(app.db);
    const undated = await seedCourse(app.db, connection.id, { termStartAt: null });
    const future = await seedCourse(app.db, connection.id, {
      termStartAt: at("2027-01-11T00:00:00Z"),
    });
    const res = await list();
    expect(ids(res.items).sort()).toEqual([undated.id, future.id].sort());
    expect(res.current_term).toBeNull();
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

    const res = await list(false, true);
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

// ---------------------------------------------------------------------------
// Checkpoint 10.3 -- priorities, workload, course attention, grade summary
// ---------------------------------------------------------------------------

const EMPTY_DAYS = [
  "2026-09-16",
  "2026-09-17",
  "2026-09-18",
  "2026-09-19",
  "2026-09-20",
  "2026-09-21",
  "2026-09-22",
  "2026-09-23",
].map((date) => ({ date, due_total: 0, points_total: 0 }));

describe("buildAcademicTodayResponse -- priorities (10.3)", () => {
  it("not configured: the three keys are present, zeroed, with eight zero-filled days", async () => {
    const res = await today();
    expect(res.configured).toBe(false);
    expect(res.priorities).toEqual({ items: [], total: 0 });
    expect(res.course_attention).toEqual({ items: [], total: 0 });
    expect(res.workload).toEqual({
      status: "on_track",
      open_total: 0,
      overdue_total: 0,
      missing_total: 0,
      due_within_24h_total: 0,
      due_this_week_total: 0,
      points_at_stake: 0,
      horizon_days: ACADEMIC_UPCOMING_DAY_COUNT,
      days: EMPTY_DAYS,
    });
    expect(AcademicTodayResponseSchema.parse(res)).toEqual(res);
  });

  it("lands urgency boundaries in the right level and excludes low, undated and closed rows", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const overdue = await seedAssignment(app.db, connection.id, course.id, {
      title: "Overdue by a millisecond",
      dueAt: plus(-1),
    });
    const high = await seedAssignment(app.db, connection.id, course.id, {
      title: "Due in 23h59m",
      dueAt: plus(24 * HOUR - 60 * 1000),
    });
    const medium = await seedAssignment(app.db, connection.id, course.id, {
      title: "Due in 24h01m",
      dueAt: plus(24 * HOUR + 60 * 1000),
    });
    const lastInHorizon = await seedAssignment(app.db, connection.id, course.id, {
      title: "Last instant of day +7",
      dueAt: at("2026-09-24T04:59:59Z"),
    });
    await seedAssignment(app.db, connection.id, course.id, {
      title: "At the horizon end -> low",
      dueAt: at("2026-09-24T05:00:00Z"),
    });
    await seedAssignment(app.db, connection.id, course.id, { title: "Undated", dueAt: null });
    await seedAssignment(app.db, connection.id, course.id, {
      title: "Submitted, would be critical",
      dueAt: plus(-DAY),
      submissionState: "submitted",
    });

    const res = await today();
    const items = res.priorities!.items;
    expect(items.map((i) => i.assignment.id)).toEqual([
      overdue.id,
      high.id,
      medium.id,
      lastInHorizon.id,
    ]);
    expect(items.map((i) => i.urgency)).toEqual(["critical", "high", "medium", "medium"]);
    expect(items.map((i) => i.score)).toEqual([400, 300, 200, 200]);
    expect(items.map((i) => i.reasons)).toEqual([
      ["overdue"],
      ["due_within_24h"],
      ["due_this_week"],
      ["due_this_week"],
    ]);
    expect(items[0]!.hours_until_due).toBe(0); // -1 ms rounds to 0, never -0
    expect(items[1]!.hours_until_due).toBe(24);
    expect(items[2]!.hours_until_due).toBe(24);
    expect(res.priorities!.total).toBe(4);
    // The wrapped assignment is the untouched item shape.
    expect(items[0]!.assignment).toEqual(res.overdue.items[0]);
  });

  it("ranks by score desc, then due_at asc, then title, then id -- with the additive reasons", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    const weekPlain = await seedAssignment(app.db, connection.id, course.id, {
      title: "Week plain",
      dueAt: plus(3 * DAY),
      pointsPossible: 10,
    });
    const weekHighPoints = await seedAssignment(app.db, connection.id, course.id, {
      title: "Week high points",
      dueAt: plus(5 * DAY),
      pointsPossible: 50,
    });
    const overdueMissingLate = await seedAssignment(app.db, connection.id, course.id, {
      title: "Overdue missing late",
      dueAt: plus(-2 * DAY),
      submissionMissing: true,
      submissionLate: true,
      pointsPossible: 100,
    });
    const overduePlain = await seedAssignment(app.db, connection.id, course.id, {
      title: "Overdue plain",
      dueAt: plus(-DAY),
      pointsPossible: 5,
    });
    const soonB = await seedAssignment(app.db, connection.id, course.id, {
      title: "B",
      dueAt: plus(2 * HOUR),
    });
    const soonA = await seedAssignment(app.db, connection.id, course.id, {
      title: "A",
      dueAt: plus(2 * HOUR),
    });

    const res = await today();
    const items = res.priorities!.items;
    expect(items.map((i) => i.assignment.id)).toEqual([
      overdueMissingLate.id,
      overduePlain.id,
      soonA.id,
      soonB.id,
      weekHighPoints.id,
    ]);
    // Cap 5 with an honest total.
    expect(items).toHaveLength(ACADEMIC_PRIORITIES_ITEM_CAP);
    expect(res.priorities!.total).toBe(6);
    expect(items[0]).toMatchObject({
      score: 500,
      reasons: ["overdue", "marked_missing", "marked_late", "high_points"],
      hours_until_due: -48,
    });
    expect(items[1]).toMatchObject({ score: 400, reasons: ["overdue"], hours_until_due: -24 });
    expect(items[2]).toMatchObject({ score: 300, reasons: ["due_within_24h"], hours_until_due: 2 });
    expect(items[4]).toMatchObject({ score: 225, reasons: ["due_this_week", "high_points"] });
    // The sixth (weekPlain, 200) fell off the cap but is counted.
    expect(items.some((i) => i.assignment.id === weekPlain.id)).toBe(false);
  });

  it("ADR-070a: a past-term row never reaches priorities, workload or course attention", async () => {
    const connection = await seedConnection(app.db);
    const fall = await seedCourse(app.db, connection.id, {
      name: "Fall",
      termStartAt: at("2026-08-03T05:00:00Z"),
    });
    const spring = await seedCourse(app.db, connection.id, {
      name: "Spring",
      termStartAt: at("2025-12-15T06:00:00Z"),
    });
    const fallRow = await seedAssignment(app.db, connection.id, fall.id, {
      dueAt: plus(3 * HOUR),
      pointsPossible: 10,
    });
    await seedAssignment(app.db, connection.id, spring.id, {
      dueAt: plus(-30 * DAY),
      submissionMissing: true,
      pointsPossible: 100,
    });

    const res = await today();
    expect(res.priorities!.items.map((i) => i.assignment.id)).toEqual([fallRow.id]);
    expect(res.workload).toMatchObject({
      status: "at_risk",
      open_total: 1,
      overdue_total: 0,
      missing_total: 0,
      due_within_24h_total: 1,
      points_at_stake: 10,
    });
    expect(res.course_attention!.items.map((i) => i.course_id)).toEqual([fall.id]);
  });
});

describe("buildAcademicTodayResponse -- workload (10.3)", () => {
  it("fills eight local days from the same windows the buckets use, and reports the totals", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    // Today (09-16 CDT): one overdue earlier today (still on today's entry),
    // one later today.
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-16T14:00:00Z"),
      pointsPossible: 10,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-16T23:00:00Z"),
      pointsPossible: 20,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-17T03:00:00Z"), // 22:00 CDT today
      pointsPossible: 5,
    });
    // Overdue from an EARLIER day: on no entry, but in overdue_total.
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-14T12:00:00Z"),
      pointsPossible: 1000,
    });
    // Tomorrow at local midnight, and day +3 with null points.
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-17T05:00:00Z"),
      pointsPossible: 100,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-19T12:00:00Z"),
      pointsPossible: null,
    });
    // Last instant of day +7, then the horizon end (out), then closed and undated.
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-24T04:59:59Z"),
      pointsPossible: 7,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-24T05:00:00Z"),
      pointsPossible: 1000,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: at("2026-09-18T12:00:00Z"),
      pointsPossible: 1000,
      submissionState: "graded",
    });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null, pointsPossible: 1000 });

    const res = await today();
    expect(res.workload!.days).toEqual([
      { date: "2026-09-16", due_total: 3, points_total: 35 },
      { date: "2026-09-17", due_total: 1, points_total: 100 },
      { date: "2026-09-18", due_total: 0, points_total: 0 },
      { date: "2026-09-19", due_total: 1, points_total: 0 },
      { date: "2026-09-20", due_total: 0, points_total: 0 },
      { date: "2026-09-21", due_total: 0, points_total: 0 },
      { date: "2026-09-22", due_total: 0, points_total: 0 },
      { date: "2026-09-23", due_total: 1, points_total: 7 },
    ]);
    expect(res.workload).toMatchObject({
      status: "behind",
      open_total: 9,
      overdue_total: 2,
      missing_total: 0,
      due_within_24h_total: 3, // 18:00 and 22:00 today + tomorrow midnight (10h away)
      due_this_week_total: 3,
      // From now through the horizon end: 20 + 5 + 100 + 0 + 7 -- overdue (10,
      // 1000), horizon-end (1000), closed (1000) and undated (1000) excluded.
      points_at_stake: 132,
      horizon_days: 7,
    });
    expect(res.summary.overdue_total).toBe(res.workload!.overdue_total);
    expect(res.summary.due_this_week_total).toBe(res.workload!.due_this_week_total);
  });

  it("status is behind on a missing flag alone, at_risk on a 24h item alone, on_track otherwise", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    // Missing but due next week: no overdue, no 24h -- still behind.
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: plus(5 * DAY),
      submissionMissing: true,
    });
    expect((await today()).workload!.status).toBe("behind");

    await app.db.delete(canvasAssignments);
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(HOUR) });
    expect((await today()).workload!.status).toBe("at_risk");

    await app.db.delete(canvasAssignments);
    await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(5 * DAY) });
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null });
    const res = await today();
    expect(res.workload!.status).toBe("on_track");
    expect(res.workload!.open_total).toBe(2);
  });
});

describe("buildAcademicTodayResponse -- course attention (10.3)", () => {
  it("lists one row per course with open work, ordered by level then the tie-breaks, skipping none", async () => {
    const connection = await seedConnection(app.db);
    // A course with only closed and no assignments -> none, never listed.
    const done = await seedCourse(app.db, connection.id, { name: "Done" });
    await seedAssignment(app.db, connection.id, done.id, {
      dueAt: plus(-DAY),
      submissionState: "graded",
    });
    await seedCourse(app.db, connection.id, { name: "Empty" });
    // low: only an undated open item.
    const low = await seedCourse(app.db, connection.id, { name: "Low" });
    await seedAssignment(app.db, connection.id, low.id, { dueAt: null });
    // medium: due in 3 days.
    const medium = await seedCourse(app.db, connection.id, { name: "Medium" });
    await seedAssignment(app.db, connection.id, medium.id, { dueAt: plus(3 * DAY) });
    // high via 24h only, next due in 2h.
    const highSoon = await seedCourse(app.db, connection.id, {
      name: "High soon",
      courseCode: "HS",
    });
    await seedAssignment(app.db, connection.id, highSoon.id, { dueAt: plus(2 * HOUR) });
    // high via one overdue, next due in 4 days -> overdue desc puts it first.
    const highOverdue = await seedCourse(app.db, connection.id, { name: "High overdue" });
    await seedAssignment(app.db, connection.id, highOverdue.id, { dueAt: plus(-DAY) });
    await seedAssignment(app.db, connection.id, highOverdue.id, { dueAt: plus(4 * DAY) });
    // high via 24h, same overdue (0) and same 24h count as "High soon", later next due -> after it.
    const highLater = await seedCourse(app.db, connection.id, { name: "High later" });
    await seedAssignment(app.db, connection.id, highLater.id, { dueAt: plus(5 * HOUR) });
    // Two more high-via-24h courses tied on every count and next due: by name, then id.
    const tieB = await seedCourse(app.db, connection.id, { name: "Tie" });
    const tieA = await seedCourse(app.db, connection.id, { name: "Tie" });
    await seedAssignment(app.db, connection.id, tieB.id, { dueAt: plus(6 * HOUR) });
    await seedAssignment(app.db, connection.id, tieA.id, { dueAt: plus(6 * HOUR) });
    const [tieFirst, tieSecond] = tieA.id < tieB.id ? [tieA, tieB] : [tieB, tieA];

    const res = await today();
    const items = res.course_attention!.items;
    expect(items.map((i) => i.course_id)).toEqual([
      highOverdue.id,
      highSoon.id,
      highLater.id,
      tieFirst.id,
      tieSecond.id,
      medium.id,
      low.id,
    ]);
    expect(res.course_attention!.total).toBe(7);
    expect(items[0]).toEqual({
      course_id: highOverdue.id,
      course_name: "High overdue",
      course_code: null,
      open_total: 2,
      overdue_total: 1,
      due_within_24h_total: 0,
      due_this_week_total: 1,
      next_due_at: plus(4 * DAY).toISOString(),
      attention: "high",
    });
    expect(items[1]).toMatchObject({
      course_code: "HS",
      due_within_24h_total: 1,
      due_this_week_total: 0,
      next_due_at: plus(2 * HOUR).toISOString(),
      attention: "high",
    });
    expect(items[5]).toMatchObject({ attention: "medium", due_this_week_total: 1 });
    expect(items[6]).toMatchObject({ attention: "low", open_total: 1, next_due_at: null });
    expect(items.some((i) => i.course_id === done.id)).toBe(false);
  });

  it("caps course-attention rows at the item cap with an honest total", async () => {
    const connection = await seedConnection(app.db);
    for (let i = 0; i < ACADEMIC_COURSE_ATTENTION_ITEM_CAP + 1; i += 1) {
      const course = await seedCourse(app.db, connection.id, { name: `Course ${i}` });
      await seedAssignment(app.db, connection.id, course.id, { dueAt: plus(3 * DAY) });
    }
    const res = await today();
    expect(res.course_attention!.items).toHaveLength(ACADEMIC_COURSE_ATTENTION_ITEM_CAP);
    expect(res.course_attention!.total).toBe(ACADEMIC_COURSE_ATTENTION_ITEM_CAP + 1);
    expect(AcademicTodayResponseSchema.parse(res)).toEqual(res);
  });
});

describe("getAcademicCourseDetail -- grade summary (10.3)", () => {
  it("is a zero count with null figures when nothing is graded", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, { score: 9, pointsPossible: 10 });
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "pending_review",
      score: 9,
      pointsPossible: 10,
    });
    const detail = await getAcademicCourseDetail(app.db, course.id, { now: NOW });
    expect(detail!.grade_summary).toEqual({
      graded_total: 0,
      average_percentage: null,
      points_earned: null,
      points_possible_graded: null,
      weighted_percentage: null,
    });
  });

  it("averages percentages and weights points over graded rows; an excused row counts only in the total", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: 9,
      pointsPossible: 10,
    });
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: 50,
      pointsPossible: 100,
    });
    // Excused: graded, null score.
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: null,
      grade: "EX",
      pointsPossible: 100,
    });
    // Graded with a score but no points possible: no percentage, no points.
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: 5,
      pointsPossible: null,
    });
    // Not graded, would skew everything if counted.
    await seedAssignment(app.db, connection.id, course.id, { score: 0, pointsPossible: 100 });
    // Archived graded row: not in the detail at all.
    await seedAssignment(app.db, connection.id, course.id, {
      submissionState: "graded",
      score: 0,
      pointsPossible: 100,
      archivedAt: at("2026-09-01T00:00:00Z"),
    });

    const detail = await getAcademicCourseDetail(app.db, course.id, { now: NOW });
    expect(detail!.grade_summary).toEqual({
      graded_total: 4,
      average_percentage: 70,
      points_earned: 59,
      points_possible_graded: 110,
      weighted_percentage: 53.6,
    });
    expect(AcademicCourseDetailResponseSchema.parse(detail)).toEqual(detail);
  });
});
