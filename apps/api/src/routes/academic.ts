import { AcademicCoursesQuerySchema, AcademicTodayQuerySchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  buildAcademicTodayResponse,
  getAcademicCourseContext,
  getAcademicCourseDetail,
  listAcademicCourses,
} from "../read-models/academic.js";

// GET /academic/* (Checkpoint 10.2, ADR-070) -- the Academic Intelligence
// Layer's three read routes. HTTP only: every query, derivation and ordering
// lives in read-models/academic.ts and packages/core/src/academic/*, exactly
// as routes/today.ts is a thin caller of buildTodayResponse.
//
// Perimeter-only (Tailscale), like every non-device route -- no device auth
// hook, matching /today, /agenda and /canvas-assignments/upcoming. Read-only
// by construction: nothing here or in the read model writes, and no route
// accepts a body. Invalid input rejects with 400 validation_failed via the
// shared Zod error handler in server.ts.
//
// `GET /canvas-assignments/upcoming` remains registered for the versionCode
// 22 client; new clients read `GET /academic/today` instead.

const CourseIdParamsSchema = z.object({ id: z.string().uuid() });

export default function academicRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/academic/today", async (request) => {
    const query = AcademicTodayQuerySchema.parse(request.query);
    return buildAcademicTodayResponse(app.db, query);
  });

  // Static segment registered alongside the parametric /academic/courses/:id
  // below; find-my-way always prefers the static route (the
  // /projects/summaries precedent).
  app.get<{ Querystring: Record<string, string> }>("/academic/courses", async (request) => {
    const query = AcademicCoursesQuerySchema.parse(request.query);
    return listAcademicCourses(app.db, query);
  });

  // A malformed id is the client's mistake (400), not a missing course; an
  // unknown, archived, or paused-connection course is 404 -- the read model
  // never says which, so the response cannot confirm a row's existence.
  app.get<{ Params: { id: string } }>("/academic/courses/:id", async (request, reply) => {
    const params = CourseIdParamsSchema.parse(request.params);
    const detail = await getAcademicCourseDetail(app.db, params.id);
    if (!detail) return reply.code(404).send({ error: "not_found" });
    return detail;
  });

  // Checkpoint 10.5 (ADR-074): a superset of the route above -- same
  // existence/404 rule -- plus the owner's own tasks/reminders explicitly
  // linked to one of this course's assignments. Registered after the plain
  // detail route for readability; find-my-way matches by segment count, not
  // declaration order, so both `/academic/courses/:id` and
  // `/academic/courses/:id/context` route correctly regardless.
  app.get<{ Params: { id: string } }>("/academic/courses/:id/context", async (request, reply) => {
    const params = CourseIdParamsSchema.parse(request.params);
    const context = await getAcademicCourseContext(app.db, params.id);
    if (!context) return reply.code(404).send({ error: "not_found" });
    return context;
  });
}
