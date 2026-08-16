import {
  OccurrenceListQuerySchema,
  OccurrenceSchema,
  paginatedResponseSchema,
  type OccurrenceListQuery,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

const OccurrenceListResponseSchema = paginatedResponseSchema(OccurrenceSchema);
const OccurrenceCompleteResponseSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["done", "skipped"]),
});

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
