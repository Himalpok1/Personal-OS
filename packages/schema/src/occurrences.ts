import { z } from "zod";

export const OccurrenceParentTypeSchema = z.enum(["task", "event"]);
export const OccurrenceStatusSchema = z.enum(["scheduled", "done", "skipped"]);

export const OccurrenceSchema = z.object({
  id: z.string().uuid(),
  parent_type: OccurrenceParentTypeSchema,
  parent_id: z.string().uuid(),
  occurs_at: z.string().datetime({ offset: true }),
  status: OccurrenceStatusSchema,
  lazy_generated: z.boolean(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

// parent_type/parent_id are required, not optional -- listing every
// occurrence regardless of parent isn't a query this UI ever needs, and
// omitting them would encourage an unbounded scan of a table that grows
// without limit for recurring items.
export const OccurrenceListQuerySchema = z.object({
  parent_type: OccurrenceParentTypeSchema,
  parent_id: z.string().uuid(),
  status: OccurrenceStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OccurrenceListQuery = z.infer<typeof OccurrenceListQuerySchema>;
