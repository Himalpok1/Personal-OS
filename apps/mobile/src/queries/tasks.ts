import type { TaskListParams } from "@personal-os/api-client";
import type { Task, TaskCreate, TaskUpdate } from "@personal-os/schema";
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

/**
 * The raw mutation config for POST /tasks/:id/reopen (Checkpoint 9.3,
 * contract 1: done | dropped -> active), exported separately from the hook so
 * `tasks.test.ts` can drive it through a bare `MutationObserver` without a
 * render harness -- the same convention as `askCloudMutationOptions`.
 *
 * Reopen touches the task row only; the API leaves occurrences alone, so
 * this invalidates "tasks" and nothing else, exactly like the sibling
 * lifecycle hooks above. A 409 `task_not_reopenable` (the task is already
 * open) is surfaced to the caller, not swallowed: the detail screen turns it
 * into a status-specific message via components/task-actions-state.ts.
 */
export function reopenTaskMutationOptions(): { mutationFn: (id: string) => Promise<Task> } {
  return {
    mutationFn: (id: string) => api.reopenTask(id),
  };
}

export function useReopenTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    ...reopenTaskMutationOptions(),
    onSuccess: invalidate,
  });
}
