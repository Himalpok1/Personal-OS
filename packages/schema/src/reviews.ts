// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";

export const ReviewKindSchema = z.enum(["daily", "weekly"]);
export type ReviewKind = z.infer<typeof ReviewKindSchema>;

export const ReviewStatusSchema = z.enum(["in_progress", "completed", "skipped"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

// content holds checklist state -- opaque passthrough here (same taste as
// inbox.ts's parse_result); its internal shape belongs to whichever client
// produced it.
export const ReviewSchema = z.object({
  id: z.string().uuid(),
  kind: ReviewKindSchema,
  period_start: z.string().date(),
  timezone: z.string(),
  status: ReviewStatusSchema,
  content: z.unknown().nullable(),
  summary: z.string().nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});
export type Review = z.infer<typeof ReviewSchema>;

export const ReviewCreateSchema = z
  .object({
    kind: ReviewKindSchema,
    period_start: z.string().date(),
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
  })
  .strict();
export type ReviewCreate = z.infer<typeof ReviewCreateSchema>;

export const ReviewUpdateSchema = z
  .object({
    content: z.unknown().optional(),
    summary: z.string().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type ReviewUpdate = z.infer<typeof ReviewUpdateSchema>;

export const ReviewListQuerySchema = PaginationQuerySchema.extend({
  kind: ReviewKindSchema.optional(),
});
export type ReviewListQuery = z.infer<typeof ReviewListQuerySchema>;
