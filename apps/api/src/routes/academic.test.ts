import { canvasAssignments, canvasConnections, canvasCourses } from "@personal-os/db";
import {
  AcademicCourseDetailResponseSchema,
  AcademicCoursesResponseSchema,
  AcademicTodayResponseSchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../test/build-test-app.js";

// The HTTP contract of GET /academic/* (Checkpoint 10.2, ADR-070): status
// codes, error shapes and schema conformance. Bucket/ordering semantics are
// pinned against a fixed clock in read-models/academic.test.ts; here the
// routes run on the real clock, so rows are seeded relative to Date.now().

let app: FastifyInstance;

const DAY = 24 * 60 * 60 * 1000;

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await app.db.delete(canvasConnections);
});

async function seedCourseWithAssignment() {
  const [connection] = await app.db
    .insert(canvasConnections)
    .values({
      canvasBaseUrl: `https://${crypto.randomUUID()}.instructure.com`,
      canvasUserId: 1,
      canvasUserName: "Test Student",
      status: "active",
    })
    .returning();
  const [course] = await app.db
    .insert(canvasCourses)
    .values({ connectionId: connection!.id, canvasCourseId: 4315, name: "Advanced Web Dev" })
    .returning();
  const [assignment] = await app.db
    .insert(canvasAssignments)
    .values({
      connectionId: connection!.id,
      courseId: course!.id,
      canvasAssignmentId: 99001,
      title: "Project 2",
      dueAt: new Date(Date.now() + DAY),
      pointsPossible: 100,
      submissionState: "unsubmitted",
      score: null,
      grade: null,
    })
    .returning();
  return { connection: connection!, course: course!, assignment: assignment! };
}

describe("GET /academic/today", () => {
  it("400s validation_failed without tz", async () => {
    const res = await app.inject({ method: "GET", url: "/academic/today" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("400s validation_failed for an unknown IANA zone", async () => {
    const res = await app.inject({ method: "GET", url: "/academic/today?tz=Mars/Olympus" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("200s configured:false, never an error, when no connection exists", async () => {
    const res = await app.inject({ method: "GET", url: "/academic/today?tz=America/Chicago" });
    expect(res.statusCode).toBe(200);
    const body = AcademicTodayResponseSchema.parse(res.json());
    expect(body.configured).toBe(false);
    expect(body.tz).toBe("America/Chicago");
    expect(body.summary.overdue_total).toBe(0);
  });

  it("200s a schema-conformant response with the seeded assignment in due_this_week", async () => {
    const { connection, course, assignment } = await seedCourseWithAssignment();
    const res = await app.inject({ method: "GET", url: "/academic/today?tz=America/Chicago" });
    expect(res.statusCode).toBe(200);
    const body = AcademicTodayResponseSchema.parse(res.json());
    expect(body.configured).toBe(true);
    // Due in exactly 24h from a real-clock now: never today, always within
    // the 7 local days that follow, whatever the hour the test runs at.
    expect(body.due_this_week.items.map((i) => i.id)).toEqual([assignment.id]);
    expect(body.due_this_week.items[0]).toMatchObject({
      source: "canvas",
      external_id: "99001",
      course_id: course.id,
      course_name: "Advanced Web Dev",
      source_base_url: connection.canvasBaseUrl,
      open: true,
      grade: { status: "not_graded", score: null, grade: null, percentage: null },
    });
    expect(typeof body.due_this_week.items[0]?.external_id).toBe("string");
  });

  it("never emits an assignment description, entered_* grade, or attachment", async () => {
    await seedCourseWithAssignment();
    const res = await app.inject({ method: "GET", url: "/academic/today?tz=America/Chicago" });
    const raw = JSON.stringify(res.json());
    for (const forbidden of ["description", "entered_score", "entered_grade", "attachments"]) {
      expect(raw).not.toContain(forbidden);
    }
  });
});

describe("GET /academic/courses", () => {
  it("200s configured:false with no items when nothing is connected", async () => {
    const res = await app.inject({ method: "GET", url: "/academic/courses" });
    expect(res.statusCode).toBe(200);
    expect(AcademicCoursesResponseSchema.parse(res.json())).toEqual({
      configured: false,
      current_term: null,
      items: [],
    });
  });

  it("200s the course list with computed counts, and accepts include_archived", async () => {
    const { course } = await seedCourseWithAssignment();
    const res = await app.inject({ method: "GET", url: "/academic/courses?include_archived=true" });
    expect(res.statusCode).toBe(200);
    const body = AcademicCoursesResponseSchema.parse(res.json());
    expect(body.configured).toBe(true);
    expect(body.items.map((i) => i.id)).toEqual([course.id]);
    expect(body.items[0]).toMatchObject({
      external_id: "4315",
      status: "active",
      open_assignment_count: 1,
      overdue_assignment_count: 0,
    });
  });

  it("400s validation_failed for a non-boolean include_archived", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/academic/courses?include_archived=maybe",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("validation_failed");
  });
});

describe("GET /academic/courses/:id", () => {
  it("404s not_found for an unknown course", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/academic/courses/${crypto.randomUUID()}`,
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("200s an archived course as status:archived, and 404s a paused connection's course", async () => {
    const { connection, course } = await seedCourseWithAssignment();
    const [archived] = await app.db
      .insert(canvasCourses)
      .values({
        connectionId: connection.id,
        canvasCourseId: 4316,
        name: "Archived",
        archivedAt: new Date(),
      })
      .returning();
    const archivedRes = await app.inject({
      method: "GET",
      url: `/academic/courses/${archived!.id}`,
    });
    expect(archivedRes.statusCode).toBe(200);
    expect(archivedRes.json<{ course: { status: string } }>().course.status).toBe("archived");

    await app.db.update(canvasConnections).set({ status: "disconnected" });
    const pausedRes = await app.inject({ method: "GET", url: `/academic/courses/${course.id}` });
    expect(pausedRes.statusCode).toBe(404);
    expect(pausedRes.json()).toEqual({ error: "not_found" });
  });

  it("400s validation_failed for a malformed id rather than 500ing on the uuid cast", async () => {
    const res = await app.inject({ method: "GET", url: "/academic/courses/not-a-uuid" });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ error: string }>().error).toBe("validation_failed");
  });

  it("200s a schema-conformant detail for a live course", async () => {
    const { course, assignment } = await seedCourseWithAssignment();
    const res = await app.inject({ method: "GET", url: `/academic/courses/${course.id}` });
    expect(res.statusCode).toBe(200);
    const body = AcademicCourseDetailResponseSchema.parse(res.json());
    expect(body.course.id).toBe(course.id);
    expect(body.assignments.map((a) => a.id)).toEqual([assignment.id]);
    expect(body.announcements).toEqual([]);
    expect(body.events).toEqual([]);
  });
});
