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
  // Checkpoint 9.4: a snooze on a recurring task lives on its occurrence,
  // never on the rule. Effective instant = snoozed_until ?? occurs_at.
  snoozed_until: z.string().datetime({ offset: true }).nullable(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

/**
 * Upper bound on how far ahead an occurrence may be snoozed (Checkpoint 9.4).
 * A snooze is a short deferral of ONE instance -- "later today", "tomorrow",
 * "next week" -- not a rule edit; anything further out is a due-date change
 * and belongs to PATCH /tasks/:id. Enforced at POST /occurrences/:id/snooze.
 */
export const MAX_SNOOZE_DAYS = 31;

export const OccurrenceSnoozeSchema = z
  .object({
    until: z.string().datetime({ offset: true }),
  })
  .strict();
export type OccurrenceSnooze = z.infer<typeof OccurrenceSnoozeSchema>;

// POST /occurrences/:id/reopen. `withdrawn_successor_id` is non-null only for
// a completion_date-anchored parent whose open lazy successor was deleted so
// this row could become the single open occurrence again.
export const OccurrenceReopenResponseSchema = z
  .object({
    id: z.string().uuid(),
    status: z.literal("scheduled"),
    withdrawn_successor_id: z.string().uuid().nullable(),
  })
  .strict();
export type OccurrenceReopenResponse = z.infer<typeof OccurrenceReopenResponseSchema>;

// parent_type/parent_id are required, not optional -- listing every
// occurrence regardless of parent isn't a query this UI ever needs, and
// omitting them would encourage an unbounded scan of a table that grows
// without limit for recurring items.
export const OccurrenceListQuerySchema = z.object({
  parent_type: OccurrenceParentTypeSchema,
  parent_id: z.string().uuid(),
  status: OccurrenceStatusSchema.optional(),
  // Checkpoint 9.4: `desc` lets the task detail's "Undo last Done" find the
  // LATEST terminal row on page 1 of a long series; the default stays `asc`
  // so every existing caller is byte-for-byte unchanged.
  order: z.enum(["asc", "desc"]).default("asc"),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type OccurrenceListQuery = z.infer<typeof OccurrenceListQuerySchema>;
