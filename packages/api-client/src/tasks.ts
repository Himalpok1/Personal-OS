import {
  TaskCreateSchema,
  TaskSchema,
  TaskUpdateSchema,
  paginatedResponseSchema,
  type Task,
  type TaskCreate,
  type TaskStatus,
  type TaskUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type { Task, TaskCreate, TaskStatus, TaskUpdate };

const TaskListResponseSchema = paginatedResponseSchema(TaskSchema);

// Client-side params, not the server's TaskListQuerySchema -- that schema
// parses a raw HTTP querystring (status arrives as a comma-separated
// string) and isn't the right shape for constructing a request from
// idiomatic JS values. buildQuery serializes `status` back into the same
// comma-separated wire format the server expects.
export interface TaskListParams {
  status?: TaskStatus[];
  project_id?: string;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listTasks(baseUrl: string, params: TaskListParams = {}) {
  return fetchJson(baseUrl, `/tasks${buildQuery(params)}`, TaskListResponseSchema);
}

export async function getTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}`, TaskSchema);
}

export async function createTask(baseUrl: string, body: TaskCreate): Promise<Task> {
  const parsed = TaskCreateSchema.parse(body);
  return fetchJson(baseUrl, "/tasks", TaskSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function updateTask(baseUrl: string, id: string, body: TaskUpdate): Promise<Task> {
  const parsed = TaskUpdateSchema.parse(body);
  return fetchJson(baseUrl, `/tasks/${id}`, TaskSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
}

export async function archiveTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}/archive`, TaskSchema, { method: "POST" });
}

export async function activateTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}/activate`, TaskSchema, { method: "POST" });
}

// On a recurring task this throws ApiClientError with status 409; the
// caller can read `err.body.occurrence_id` and fall back to
// completeOccurrence() from occurrences.ts instead.
export async function completeTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}/complete`, TaskSchema, { method: "POST" });
}

export async function dropTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}/drop`, TaskSchema, { method: "POST" });
}

// done|dropped -> active. Throws ApiClientError with status 409
// (`err.body.error === "task_not_reopenable"`, `err.body.status` carrying
// the task's current status) from inbox/active, and 404 for an unknown or
// archived task -- see apps/api/src/routes/tasks.ts.
export async function reopenTask(baseUrl: string, id: string): Promise<Task> {
  return fetchJson(baseUrl, `/tasks/${id}/reopen`, TaskSchema, { method: "POST" });
}
