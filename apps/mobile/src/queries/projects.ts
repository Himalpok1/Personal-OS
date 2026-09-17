import type { ProjectListParams } from "@personal-os/api-client";
import type { ProjectCreate, ProjectUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

const projectsKey = (params: ProjectListParams = {}) => ["projects", params] as const;
const projectSummariesKey = (includeArchived: boolean) =>
  ["projects", "summaries", includeArchived] as const;
const projectDetailKey = (id: string) => ["projects", "detail", id] as const;
const projectContextKey = (id: string) => ["projects", "context", id] as const;

// A malformed projectId query param (e.g. from a stale deep link) must never
// reach the API as a create/update body -- only well-formed UUIDs pass.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function coerceProjectIdParam(value: unknown): string | undefined {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : undefined;
}

export function useProjects(params: ProjectListParams = {}) {
  return useQuery({
    queryKey: projectsKey(params),
    queryFn: () => api.listProjects(params),
  });
}

export function useProjectSummaries(includeArchived: boolean = false) {
  return useQuery({
    queryKey: projectSummariesKey(includeArchived),
    queryFn: () => api.getProjectSummaries(includeArchived),
  });
}

export function useProjectDetail(id: string | undefined) {
  return useQuery({
    queryKey: projectDetailKey(id ?? ""),
    queryFn: () => api.getProjectDetail(id!),
    enabled: id !== undefined,
  });
}

/**
 * `GET /projects/:id/context` (Checkpoint 10.5, ADR-074) -- adds related
 * captures and a recent-activity feed on top of what `useProjectDetail`
 * already carries. A separate query, not a replacement: the project screen's
 * name/goal/tasks/notes/events editing all keep using `useProjectDetail`
 * unchanged, and this one is fetched alongside it purely for the two new
 * sections, so a slow or failing context fetch can never blank the rest of
 * the screen.
 */
export function useProjectContext(id: string | undefined) {
  return useQuery({
    queryKey: projectContextKey(id ?? ""),
    queryFn: () => api.getProjectContext(id!),
    enabled: id !== undefined,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["projects"] });
    // Today's Active Projects section renders the same rows.
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useCreateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (body: ProjectCreate) => api.createProject(body),
    onSuccess: invalidate,
  });
}

export function useUpdateProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: ProjectUpdate }) =>
      api.updateProject(id, body),
    onSuccess: invalidate,
  });
}

export function useArchiveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.archiveProject(id),
    onSuccess: invalidate,
  });
}

export function useUnarchiveProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.unarchiveProject(id),
    onSuccess: invalidate,
  });
}

export function usePauseProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.pauseProject(id),
    onSuccess: invalidate,
  });
}

export function useResumeProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.resumeProject(id),
    onSuccess: invalidate,
  });
}

export function useCompleteProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.completeProject(id),
    onSuccess: invalidate,
  });
}

export function useReopenProject() {
  const invalidate = useInvalidateProjects();
  return useMutation({
    mutationFn: (id: string) => api.reopenProject(id),
    onSuccess: invalidate,
  });
}
