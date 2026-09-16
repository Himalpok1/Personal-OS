import { canvasAssignments, canvasConnections, canvasCourses, type Db } from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp } from "../test/build-test-app.js";

// GET /canvas-assignments/upcoming (ADR-068, Checkpoint 10.1). Exercises the
// read endpoint directly against inserted rows -- this route never calls the
// Canvas client, so no fake is needed here (unlike canvas-connections.test.ts).

let app: FastifyInstance;

const NOW = new Date("2026-09-16T12:00:00Z");

beforeAll(async () => {
  app = await buildTestApp();
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  // canvas_courses/canvas_assignments both cascade from canvas_connections,
  // matching canvas-connections.test.ts's own beforeEach reasoning.
  await app.db.delete(canvasConnections);
});

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
      canvasCourseId: Math.floor(Math.random() * 1_000_000),
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
      canvasAssignmentId: Math.floor(Math.random() * 1_000_000),
      title: "Problem Set 1",
      dueAt: new Date(NOW.getTime() + 2 * 24 * 60 * 60 * 1000),
      published: true,
      ...overrides,
    })
    .returning();
  return row!;
}

describe("GET /canvas-assignments/upcoming", () => {
  it("returns an assignment due within the default 7-day window, with the course name denormalized", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { name: "Real Analysis" });
    await seedAssignment(app.db, connection.id, course.id, { title: "Homework 3" });

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ items: Array<{ title: string; course_name: string }> }>();
    expect(body.items).toHaveLength(1);
    expect(body.items[0]!.title).toBe("Homework 3");
    expect(body.items[0]!.course_name).toBe("Real Analysis");
  });

  it("excludes an assignment due more than `within_days` out", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const res = await app.inject({
      method: "GET",
      url: "/canvas-assignments/upcoming?within_days=7",
    });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("excludes a past-due assignment", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, {
      dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
    });

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("excludes an assignment with no due date", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, { dueAt: null });

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("excludes an archived assignment", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id, { archivedAt: new Date() });

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("excludes an assignment whose course is archived", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id, { archivedAt: new Date() });
    await seedAssignment(app.db, connection.id, course.id);

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("excludes assignments from a disconnected connection", async () => {
    const connection = await seedConnection(app.db, { status: "disconnected" });
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id);

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(0);
  });

  it("never includes description, score, or grade in the response shape", async () => {
    const connection = await seedConnection(app.db);
    const course = await seedCourse(app.db, connection.id);
    await seedAssignment(app.db, connection.id, course.id);

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    const raw = JSON.stringify(res.json());
    for (const forbidden of ["description", '"score"', '"grade"']) {
      expect(raw).not.toContain(forbidden);
    }
  });

  it("orders results by due_at ascending across multiple courses", async () => {
    const connection = await seedConnection(app.db);
    const courseA = await seedCourse(app.db, connection.id, { name: "Course A" });
    const courseB = await seedCourse(app.db, connection.id, { name: "Course B" });
    await seedAssignment(app.db, connection.id, courseA.id, {
      title: "Later",
      dueAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    await seedAssignment(app.db, connection.id, courseB.id, {
      title: "Sooner",
      dueAt: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000),
    });

    const res = await app.inject({ method: "GET", url: "/canvas-assignments/upcoming" });
    const body = res.json<{ items: Array<{ title: string }> }>();
    expect(body.items.map((i) => i.title)).toEqual(["Sooner", "Later"]);
  });

  it("400s a within_days value outside [1, 30]", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/canvas-assignments/upcoming?within_days=31",
    });
    expect(res.statusCode).toBe(400);
  });
});
