import { z } from "zod";

// Shared by every list endpoint's query schema (tasks/notes/inbox/occurrences).
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

// `z.coerce.boolean()` runs JS's `Boolean(value)` on the raw query string --
// `Boolean("false")` is `true`, since any non-empty string is truthy. Every
// `include_archived`/`include_revoked` query flag in this codebase used that
// pattern and was silently broken for any client that explicitly sends
// `?include_archived=false` rather than omitting the param (found in
// Checkpoint 4.2 when the mobile web client, which always sends the param
// explicitly, tried to hide an archived event and couldn't -- see
// docs/STATUS.md). This preprocesses only the two exact query-string
// representations. Other values pass through so Zod rejects malformed input.
export function booleanQueryParam(defaultValue: boolean) {
  return z.preprocess((value) => {
    if (value === undefined) return undefined;
    if (typeof value === "boolean") return value;
    if (value === "true") return true;
    if (value === "false") return false;
    return value;
  }, z.boolean().default(defaultValue));
}

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  });
}
