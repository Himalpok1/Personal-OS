import type { TaskListParams } from "@personal-os/api-client";
import type { Task, TaskCreate, TaskUpdate } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { taskReminderKey } from "@/notifications/reminder-actions";
import { cancelRemindersForKey } from "@/notifications/scheduler";
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

// Every task write can change what Today shows and what the primary device
// should have scheduled (a created task may carry remind_at; an activated
// inbox task is now due), so all three read models are invalidated together.
function useInvalidateTasks() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
    void queryClient.invalidateQueries({ queryKey: ["reminders"] });
  };
}

/**
 * Checkpoint 9.4. A mutation that can make a scheduled local reminder stale
 * (the task is no longer open, or its remind_at/due_at/rule moved) FIRST
 * cancels the on-device alarm for this task's one-off key, then invalidates
 * every read model that renders it -- tasks, today and the reminders feed
 * the scheduler reconciles from. The cancel goes first, and is awaited, so
 * the alarm cannot fire in the window between the server accepting the
 * mutation and the next reconcile pass; the refetched feed then restores
 * whatever is still due (an edited remind_at, an occurrence of a rule that
 * just changed). Occurrence keys (`occ:<id>`) are handled by
 * queries/occurrences.ts; a rule edit's regenerated occurrences reach the
 * device through the feed alone.
 */
function useInvalidateAfterTaskMutation() {
  const invalidate = useInvalidateTasks();
  return async (taskId: string, cancelReminder = true) => {
    if (cancelReminder) {
      await cancelRemindersForKey(taskReminderKey(taskId)).catch((error: unknown) => {
        console.warn("Failed to cancel the local reminder for a mutated task", error);
      });
    }
    invalidate();
  };
}

/**
 * The PATCH fields whose change can move or remove a reminder. A patch
 * touching none of them (a title or body edit, a project move) leaves the
 * scheduled alarm exactly right, so it is NOT cancelled: cancelling it
 * anyway would open a window -- between the cancel and the next reconcile
 * pass -- in which killing the app leaves the reminder unscheduled until
 * the next launch, for an edit that never affected it. Pure; exported for
 * tasks.test.ts.
 */
const REMINDER_AFFECTING_TASK_FIELDS: readonly (keyof TaskUpdate)[] = [
  "remind_at",
  "due_at",
  "rrule",
  "recurrence_anchor",
  "recurrence_timezone",
  "recurrence_until",
  "recurrence_count",
  "recurrence_exdates",
];

export function taskUpdateAffectsReminder(body: TaskUpdate): boolean {
  return REMINDER_AFFECTING_TASK_FIELDS.some((field) => field in body);
}

export function useCreateTask() {
  const invalidate = useInvalidateTasks();
  return useMutation({
    mutationFn: (body: TaskCreate) => api.createTask(body),
    onSuccess: invalidate,
  });
}

export function useUpdateTask() {
  const invalidate = useInvalidateAfterTaskMutation();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: TaskUpdate }) => api.updateTask(id, body),
    onSuccess: (_task, { id, body }) => invalidate(id, taskUpdateAffectsReminder(body)),
  });
}

export function useArchiveTask() {
  const invalidate = useInvalidateAfterTaskMutation();
  return useMutation({
    mutationFn: (id: string) => api.archiveTask(id),
    onSuccess: (_task, id) => invalidate(id),
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
  const invalidate = useInvalidateAfterTaskMutation();
  return useMutation({
    mutationFn: (id: string) => api.completeTask(id),
    onSuccess: (_task, id) => invalidate(id),
  });
}

export function useDropTask() {
  const invalidate = useInvalidateAfterTaskMutation();
  return useMutation({
    mutationFn: (id: string) => api.dropTask(id),
    onSuccess: (_task, id) => invalidate(id),
  });
}

/**
 * The raw mutation config for POST /tasks/:id/reopen (Checkpoint 9.3,
 * contract 1: done | dropped -> active), exported separately from the hook so
 * `tasks.test.ts` can drive it through a bare `MutationObserver` without a
 * render harness -- the same convention as `askCloudMutationOptions`.
 *
 * Reopen can bring a reminder back (a reopened task with remind_at in the
 * future is due again), so it invalidates the same set the sibling
 * lifecycle hooks do -- "tasks", "today" and "reminders" -- though there is
 * no alarm to cancel, so it does not go through the cancel step. A 409 `task_not_reopenable` (the task is already
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
