import {
  ProjectContextResponseSchema,
  ProjectCreateSchema,
  ProjectDetailResponseSchema,
  ProjectSchema,
  ProjectSummaryListResponseSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectContextResponse,
  type ProjectCreate,
  type ProjectDetailResponse,
  type ProjectSummaryItem,
  type ProjectSummaryListResponse,
  type ProjectUpdate,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

export type {
  ProjectContextResponse,
  ProjectDetailResponse,
  ProjectSummaryItem,
  ProjectSummaryListResponse,
};

// Unlike tasks/notes/inbox, GET /projects returns a plain array -- small,
// unbounded-need table, no pagination envelope (matches the API's own
// convention).
const ProjectListResponseSchema = z.array(ProjectSchema);

export interface ProjectListParams {
  include_archived?: boolean;
}

export async function listProjects(baseUrl: string, params: ProjectListParams = {}) {
  return fetchJson(baseUrl, `/projects${buildQuery(params)}`, ProjectListResponseSchema);
}

// Enriched read model for the Projects screen (Checkpoint 5.2): base rows plus
// computed next action / stalled / activity / counts.
export async function getProjectSummaries(
  baseUrl: string,
  includeArchived?: boolean,
): Promise<ProjectSummaryListResponse> {
  return fetchJson(
    baseUrl,
    `/projects/summaries${buildQuery({ include_archived: includeArchived })}`,
    ProjectSummaryListResponseSchema,
  );
}

export async function getProject(baseUrl: string, id: string): Promise<Project> {
  return fetchJson(baseUrl, `/projects/${id}`, ProjectSchema);
}

export async function getProjectDetail(
  baseUrl: string,
  id: string,
): Promise<ProjectDetailResponse> {
  return fetchJson(baseUrl, `/projects/${id}/detail`, ProjectDetailResponseSchema);
}

/**
 * `GET /projects/:id/context` (Checkpoint 10.5) -- a superset of
 * `getProjectDetail`: the project's tasks (each carrying its opaque
 * `canvas_assignment_id`, never Canvas content) and calendar items, captures
 * that became one of this project's own items, and a small recent-activity
 * feed. Same 404 rule as `getProjectDetail`.
 */
export async function getProjectContext(
  baseUrl: string,
  id: string,
): Promise<ProjectContextResponse> {
  return fetchJson(baseUrl, `/projects/${id}/context`, ProjectContextResponseSchema);
}

export async function createProject(baseUrl: string, body: ProjectCreate): Promise<Project> {
  const parsed = ProjectCreateSchema.parse(body);
  return fetchJson(baseUrl, "/projects", ProjectSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function updateProject(
  baseUrl: string,
  id: string,
  body: ProjectUpdate,
): Promise<Project> {
  const parsed = ProjectUpdateSchema.parse(body);
  return fetchJson(baseUrl, `/projects/${id}`, ProjectSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
}

// Lifecycle/archive actions are bodyless POSTs exactly like archiveProject:
// fetchJson only sets Content-Type when a body exists (a JSON Content-Type on
// an empty body is rejected by Fastify's parser as a spurious 400).
async function postProjectAction(baseUrl: string, id: string, action: string): Promise<Project> {
  return fetchJson(baseUrl, `/projects/${id}/${action}`, ProjectSchema, { method: "POST" });
}

export function pauseProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "pause");
}

export function resumeProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "resume");
}

export function completeProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "complete");
}

export function reopenProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "reopen");
}

export function archiveProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "archive");
}

export function unarchiveProject(baseUrl: string, id: string): Promise<Project> {
  return postProjectAction(baseUrl, id, "unarchive");
}
