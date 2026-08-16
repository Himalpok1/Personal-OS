import type { ProjectListParams } from "@personal-os/api-client";
import type { ProjectCreate, ProjectUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

const projectsKey = (params: ProjectListParams = {}) => ["projects", params] as const;
const projectKey = (id: string) => ["projects", id] as const;

export function useProjects(params: ProjectListParams = {}) {
  return useQuery({
    queryKey: projectsKey(params),
    queryFn: () => api.listProjects(params),
  });
}

export function useProject(id: string | undefined) {
  return useQuery({
    queryKey: projectKey(id ?? ""),
    queryFn: () => api.getProject(id!),
    enabled: id !== undefined,
  });
}

function useInvalidateProjects() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["projects"] });
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
