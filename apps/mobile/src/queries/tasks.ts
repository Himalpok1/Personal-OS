import type { TaskListParams } from "@personal-os/api-client";
import type { TaskCreate, TaskUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

const tasksKey = (params: TaskListParams = {}) => ["tasks", params] as const;
const taskKey = (id: string) => ["tasks", id] as const;

export function useTasks(params: TaskListParams = {}) {
  return useQuery({
    queryKey: tasksKey(params),
    queryFn: () => api.listTasks(params),
  });
}

export function useTask(id: string | undefined) {
  return useQuery({
    queryKey: taskKey(id ?? ""),
    queryFn: () => api.getTask(id!),
    enabled: id !== undefined,
  });
}

function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["tasks"] });
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: TaskCreate) => api.createTask(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskUpdate }) => api.updateTask(id, body),
    onSuccess: invalidate,
  });
}

export function useArchiveTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.archiveTask(id),
    onSuccess: invalidate,
  });
}

export function useActivateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.activateTask(id),
    onSuccess: invalidate,
  });
}

// On a recurring task the API rejects this with a 409 carrying
// `occurrence_id` on ApiClientError.body -- callers should catch that and
// fall back to useCompleteOccurrence (see queries/occurrences.ts).
export function useCompleteTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: invalidate,
  });
}

export function useDropTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (id: string) => api.dropTask(id),
    onSuccess: invalidate,
  });
}
