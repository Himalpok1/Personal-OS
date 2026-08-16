import { z } from "zod";

// Shared by every list endpoint's query schema (tasks/notes/inbox/occurrences).
export const PaginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

export function paginatedResponseSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    items: z.array(itemSchema),
    limit: z.number(),
    offset: z.number(),
    total: z.number(),
  });
}
