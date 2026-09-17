import { useQuery } from "@tanstack/react-query";
import { api } from "./client";
import { deviceTimezone } from "./today";

// Academic Intelligence Layer read hooks (Checkpoint 10.2, ADR-070).
//
// Perimeter-only, exactly like the Canvas/mail/health/calendar hooks: no
// device bearer token is threaded, because the three `/academic/*` routes
// install no deviceAuthPreHandler. Adding one would invent an auth
// requirement that does not exist and would break these screens in the
// UI-test shell, which mounts no device identity at all.
//
// Everything here is a READ of a projection over the Checkpoint 10.1 Canvas
// tables (packages/schema/src/academic.ts's header): there is no mutation
// hook this file could offer, and no invalidation to wire, because nothing
// in the client can change academic data -- a Canvas sync (queries/canvas.ts)
// is the only writer, and it runs in the worker.

export const academicKeys = {
  /** Prefix every academic query shares, so one invalidate covers the domain. */
  all: ["academic"] as const,
  today: () => [...academicKeys.all, "today"] as const,
  courses: (includeArchived: boolean, includePastTerms = false) =>
    [...academicKeys.all, "courses", includeArchived, includePastTerms] as const,
  course: (id: string | null) => [...academicKeys.all, "course", id] as const,
};

/**
 * `GET /academic/today?tz=` -- the academic Today read model, bucketed under
 * the SAME device zone `useToday` sends, so "due today" here and on the
 * command centre's own sections agree on which local day today is.
 *
 * Not gated on `useCanvasConnections` being loaded first: a server with no
 * active connection answers `configured: false` with empty sections rather
 * than an error, so the Today card can render (or not) off this one query
 * alone, exactly like `useHealthSummary`'s `!data.configured` case.
 */
export function useAcademicToday() {
  return useQuery({
    queryKey: academicKeys.today(),
    queryFn: () => api.getAcademicToday(deviceTimezone()),
  });
}

export interface AcademicCoursesOptions {
  includeArchived?: boolean;
  /** Widen from the current term (ADR-070a's default) to every term. */
  includePastTerms?: boolean;
}

/**
 * `GET /academic/courses?include_archived=&include_past_terms=` -- every
 * active connection's courses with computed counts, current term only by
 * default. Accepts the pre-10.3 boolean form (`useAcademicCourses(true)` ==
 * `includeArchived`) as well as an options object.
 */
export function useAcademicCourses(options: AcademicCoursesOptions = {}) {
  const { includeArchived = false, includePastTerms = false } = options;
  return useQuery({
    queryKey: academicKeys.courses(includeArchived, includePastTerms),
    queryFn: () => api.listAcademicCourses({ includeArchived, includePastTerms }),
  });
}

/**
 * `GET /academic/courses/:id` -- one course with its assignments,
 * announcements and events. `enabled: false` while `id` is null, mirroring
 * every other id-scoped query in this package (`useCanvasSyncRuns`,
 * `useProjectDetail`), so the screen can call it before the route param has
 * resolved without firing a request for `/academic/courses/undefined`.
 */
export function useAcademicCourse(id: string | null) {
  return useQuery({
    queryKey: academicKeys.course(id),
    queryFn: () => api.getAcademicCourse(id as string),
    enabled: id !== null,
  });
}
