import {
  NoteCreateSchema,
  NoteSchema,
  NoteUpdateSchema,
  paginatedResponseSchema,
  type Note,
  type NoteCreate,
  type NoteUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

const NoteListResponseSchema = paginatedResponseSchema(NoteSchema);

export interface NoteListParams {
  project_id?: string;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listNotes(baseUrl: string, params: NoteListParams = {}) {
  return fetchJson(baseUrl, `/notes${buildQuery(params)}`, NoteListResponseSchema);
}

export async function getNote(baseUrl: string, id: string): Promise<Note> {
  return fetchJson(baseUrl, `/notes/${id}`, NoteSchema);
}

export async function createNote(baseUrl: string, body: NoteCreate): Promise<Note> {
  const parsed = NoteCreateSchema.parse(body);
  return fetchJson(baseUrl, "/notes", NoteSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function updateNote(baseUrl: string, id: string, body: NoteUpdate): Promise<Note> {
  const parsed = NoteUpdateSchema.parse(body);
  return fetchJson(baseUrl, `/notes/${id}`, NoteSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
}

export async function archiveNote(baseUrl: string, id: string): Promise<Note> {
  return fetchJson(baseUrl, `/notes/${id}/archive`, NoteSchema, { method: "POST" });
}
