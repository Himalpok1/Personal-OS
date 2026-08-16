import {
  ProjectCreateSchema,
  ProjectSchema,
  ProjectUpdateSchema,
  type Project,
  type ProjectCreate,
  type ProjectUpdate,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

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

export async function getProject(baseUrl: string, id: string): Promise<Project> {
  return fetchJson(baseUrl, `/projects/${id}`, ProjectSchema);
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

export async function archiveProject(baseUrl: string, id: string): Promise<Project> {
  return fetchJson(baseUrl, `/projects/${id}/archive`, ProjectSchema, { method: "POST" });
}
