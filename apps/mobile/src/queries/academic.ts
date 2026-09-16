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
  courses: (includeArchived: boolean) => [...academicKeys.all, "courses", includeArchived] as const,
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

/** `GET /academic/courses?include_archived=` -- every active connection's courses with computed counts. */
export function useAcademicCourses(includeArchived = false) {
  return useQuery({
    queryKey: academicKeys.courses(includeArchived),
    queryFn: () => api.listAcademicCourses({ includeArchived }),
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
