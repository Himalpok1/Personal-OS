import {
  AcademicCourseContextResponseSchema,
  AcademicCourseDetailResponseSchema,
  AcademicCoursesResponseSchema,
  AcademicTodayResponseSchema,
  type AcademicCourseContextResponse,
  type AcademicCourseDetailResponse,
  type AcademicCoursesResponse,
  type AcademicTodayResponse,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// Checkpoint 10.2 (ADR-070) -- the Academic Intelligence Layer's three read
// routes. All GET, all Tailscale-perimeter-only, all projections of the
// Checkpoint 10.1 Canvas tables (see packages/schema/src/academic.ts's
// header for what "normalized" means and why nothing here is a new entity).
// Read-only by construction, like every Canvas method in canvas.ts: there is
// no write route this file could bind to.

export type {
  AcademicCourseContextResponse,
  AcademicCourseDetailResponse,
  AcademicCoursesResponse,
  AcademicTodayResponse,
};

/**
 * `GET /academic/today?tz=` -- the academic Today read model: overdue,
 * due today, due this week, recent announcements and upcoming calendar
 * events, each with an honest total, bucketed under the client's IANA zone
 * exactly as `getToday` is. Answers `configured: false` with empty sections
 * (never an error) when no active connection exists.
 */
export async function getAcademicToday(
  baseUrl: string,
  tz: string,
): Promise<AcademicTodayResponse> {
  return await fetchJson(
    baseUrl,
    `/academic/today${buildQuery({ tz })}`,
    AcademicTodayResponseSchema,
  );
}

/**
 * `GET /academic/courses?include_archived=&include_past_terms=` -- every
 * active connection's courses with computed counts. Current term only by
 * default (ADR-070a); `includePastTerms` widens the list to every term.
 */
export async function listAcademicCourses(
  baseUrl: string,
  options: { includeArchived?: boolean; includePastTerms?: boolean } = {},
): Promise<AcademicCoursesResponse> {
  return await fetchJson(
    baseUrl,
    `/academic/courses${buildQuery({
      include_archived: options.includeArchived,
      include_past_terms: options.includePastTerms,
    })}`,
    AcademicCoursesResponseSchema,
  );
}

/** `GET /academic/courses/:id` -- one course with its assignments, announcements and events. 404 if unknown, archived, or its connection is not active. */
export async function getAcademicCourse(
  baseUrl: string,
  id: string,
): Promise<AcademicCourseDetailResponse> {
  return await fetchJson(
    baseUrl,
    `/academic/courses/${encodeURIComponent(id)}`,
    AcademicCourseDetailResponseSchema,
  );
}

/**
 * `GET /academic/courses/:id/context` (Checkpoint 10.5) -- a superset of
 * `getAcademicCourse`: the same course/assignments/announcements/events/
 * grade_summary plus `related_reminders`, the owner's own tasks explicitly
 * linked to one of this course's assignments. Same 404 rule.
 */
export async function getAcademicCourseContext(
  baseUrl: string,
  id: string,
): Promise<AcademicCourseContextResponse> {
  return await fetchJson(
    baseUrl,
    `/academic/courses/${encodeURIComponent(id)}/context`,
    AcademicCourseContextResponseSchema,
  );
}
