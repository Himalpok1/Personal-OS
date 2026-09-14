import {
  OccurrenceListQuerySchema,
  OccurrenceReopenResponseSchema,
  OccurrenceSchema,
  OccurrenceSnoozeSchema,
  paginatedResponseSchema,
  type OccurrenceListQuery,
  type OccurrenceSnooze,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

const OccurrenceListResponseSchema = paginatedResponseSchema(OccurrenceSchema);
const OccurrenceCompleteResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["done", "skipped"]),
});

// `order` (Checkpoint 9.4, additive, default `asc`) rides through the parse
// like every other member: the task detail asks for terminal rows `desc` so
// the latest one -- the only one "Undo last Done" wants -- is on page 1.
export async function listOccurrences(baseUrl: string, query: OccurrenceListQuery) {
  const parsed = OccurrenceListQuerySchema.parse(query);
  return fetchJson(baseUrl, `/occurrences${buildQuery(parsed)}`, OccurrenceListResponseSchema);
}

export async function completeOccurrence(baseUrl: string, id: string) {
  return fetchJson(baseUrl, `/occurrences/${id}/complete`, OccurrenceCompleteResponseSchema, {
    method: "POST",
  });
}

export async function skipOccurrence(baseUrl: string, id: string) {
  return fetchJson(baseUrl, `/occurrences/${id}/skip`, OccurrenceCompleteResponseSchema, {
    method: "POST",
  });
}

// Checkpoint 9.4. Snooze acts on ONE instance of a recurring task; the rule
// and the parent are untouched (409 occurrence_not_open on a terminal row,
// 400 validation_failed outside (now, now + MAX_SNOOZE_DAYS]).
export async function snoozeOccurrence(baseUrl: string, id: string, body: OccurrenceSnooze) {
  const parsed = OccurrenceSnoozeSchema.parse(body);
  return fetchJson(baseUrl, `/occurrences/${id}/snooze`, OccurrenceSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

// done|skipped -> scheduled. For a completion_date parent the open lazy
// successor is withdrawn in the same transaction (`withdrawn_successor_id`);
// 409 occurrence_not_reopenable when already scheduled, 409 task_not_open
// when the parent is dropped or archived.
export async function reopenOccurrence(baseUrl: string, id: string) {
  return fetchJson(baseUrl, `/occurrences/${id}/reopen`, OccurrenceReopenResponseSchema, {
    method: "POST",
  });
}
