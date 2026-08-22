// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { PaginationQuerySchema } from "./pagination.js";
import { ProjectNextActionSchema, ProjectStatusSchema } from "./projects.js";
import {
  TodayEventItemSchema,
  TodayInboxItemSchema,
  TodayTaskItemSchema,
  TodayUpcomingDaySchema,
  boundedItemsSectionSchema,
} from "./today.js";

export const ReviewKindSchema = z.enum(["daily", "weekly"]);
export type ReviewKind = z.infer<typeof ReviewKindSchema>;

export const ReviewStatusSchema = z.enum(["in_progress", "completed", "skipped"]);
export type ReviewStatus = z.infer<typeof ReviewStatusSchema>;

// ---- Frozen review-content contract (Checkpoint 5.3), version 1 ----
//
// Content is written whole on every PATCH of the content field (no merge).
// Checklist keys are known and strict; each step's done-flag is optional so
// incremental saves validate. selected_priorities are HISTORICAL metadata:
// referenced tasks/occurrences may later be completed, archived, or dropped
// without invalidating the review. Arrays are hard-bounded.

export const REVIEW_CONTENT_VERSION = 1;

export const ReviewPriorityRefSchema = z
  .object({
    kind: z.enum(["task", "occurrence"]),
    id: z.string().uuid(),
  })
  .strict();
export type ReviewPriorityRef = z.infer<typeof ReviewPriorityRefSchema>;

const flag = () => z.boolean().optional();

export const DailyReviewChecklistSchema = z
  .object({
    inbox: flag(),
    overdue: flag(),
    priorities: flag(),
    calendar: flag(),
    projects: flag(),
    next_actions: flag(),
    summary: flag(),
  })
  .strict();
export type DailyReviewChecklist = z.infer<typeof DailyReviewChecklistSchema>;

export const WeeklyReviewChecklistSchema = z
  .object({
    inbox: flag(),
    overdue: flag(),
    active_projects: flag(),
    paused_projects: flag(),
    stalled_projects: flag(),
    missing_next_actions: flag(),
    upcoming_week: flag(),
    recently_completed: flag(),
    summary: flag(),
  })
  .strict();
export type WeeklyReviewChecklist = z.infer<typeof WeeklyReviewChecklistSchema>;

export const DailyReviewContentSchema = z
  .object({
    version: z.literal(REVIEW_CONTENT_VERSION),
    // Explicit discriminator: checklist keys are optional booleans written
    // sparse, so key-presence can never identify the variant (Checkpoint 5.3
    // audit D1). The server additionally binds this to the row's kind.
    kind: z.literal("daily"),
    checklist: DailyReviewChecklistSchema,
    selected_priorities: z.array(ReviewPriorityRefSchema).max(10),
  })
  .strict();
export type DailyReviewContent = z.infer<typeof DailyReviewContentSchema>;

export const WeeklyReviewContentSchema = z
  .object({
    version: z.literal(REVIEW_CONTENT_VERSION),
    kind: z.literal("weekly"),
    checklist: WeeklyReviewChecklistSchema,
    selected_priorities: z.array(ReviewPriorityRefSchema).max(10),
  })
  .strict();
export type WeeklyReviewContent = z.infer<typeof WeeklyReviewContentSchema>;

export const ReviewContentSchema = z.union([DailyReviewContentSchema, WeeklyReviewContentSchema]);
export type ReviewContent = z.infer<typeof ReviewContentSchema>;

export function reviewContentSchemaFor(
  kind: ReviewKind,
): typeof DailyReviewContentSchema | typeof WeeklyReviewContentSchema {
  return kind === "daily" ? DailyReviewContentSchema : WeeklyReviewContentSchema;
}

export const ReviewSchema = z.object({
  id: z.string().uuid(),
  kind: ReviewKindSchema,
  period_start: z.string().date(),
  timezone: z.string(),
  status: ReviewStatusSchema,
  content: ReviewContentSchema.nullable(),
  summary: z.string().max(2000).nullable(),
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
    content: ReviewContentSchema.optional(),
    summary: z.string().max(2000).nullable().optional(),
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

// ---- Server-side review context (Checkpoint 5.3) ----
//
// Bounded collectors so neither web nor mobile fans out. Sections reuse the
// frozen Today item shapes; totals stay honest when lists truncate.

export const ReviewContextProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable(),
  status: ProjectStatusSchema,
  target_date: z.string().date().nullable(),
  next_action: ProjectNextActionSchema.nullable(),
  stalled: z.boolean(),
});
export type ReviewContextProject = z.infer<typeof ReviewContextProjectSchema>;

export const ReviewRecentlyCompletedItemSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("task"),
    id: z.string().uuid(),
    title: z.string(),
    completed_at: z.string().datetime({ offset: true }),
  }),
  z.object({
    kind: z.literal("occurrence"),
    occurrence_id: z.string().uuid(),
    parent_task_id: z.string().uuid(),
    title: z.string(),
    completed_at: z.string().datetime({ offset: true }),
  }),
]);
export type ReviewRecentlyCompletedItem = z.infer<typeof ReviewRecentlyCompletedItemSchema>;

export const ReviewInboxAttentionSectionSchema = z.object({
  pending_count: z.number().int().min(0),
  needs_confirm_count: z.number().int().min(0),
  failed_count: z.number().int().min(0),
  items: z.array(TodayInboxItemSchema),
});
export type ReviewInboxAttentionSection = z.infer<typeof ReviewInboxAttentionSectionSchema>;

export const DailyReviewContextSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  effective_now: z.string().datetime({ offset: true }),
  tz: z.string(),
  period_start: z.string().date(),
  inbox_attention: ReviewInboxAttentionSectionSchema,
  overdue: boundedItemsSectionSchema(TodayTaskItemSchema),
  due_today: boundedItemsSectionSchema(TodayTaskItemSchema),
  events_today: z.object({ items: z.array(TodayEventItemSchema) }),
  active_projects: boundedItemsSectionSchema(ReviewContextProjectSchema),
  stalled_projects: boundedItemsSectionSchema(ReviewContextProjectSchema),
  projects_without_next_action: boundedItemsSectionSchema(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      status: ProjectStatusSchema,
    }),
  ),
  recently_completed: boundedItemsSectionSchema(ReviewRecentlyCompletedItemSchema),
});
export type DailyReviewContext = z.infer<typeof DailyReviewContextSchema>;

export const WeeklyReviewContextSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  effective_now: z.string().datetime({ offset: true }),
  tz: z.string(),
  period_start: z.string().date(),
  inbox_attention: ReviewInboxAttentionSectionSchema,
  overdue: boundedItemsSectionSchema(TodayTaskItemSchema),
  active_projects: boundedItemsSectionSchema(ReviewContextProjectSchema),
  paused_projects: boundedItemsSectionSchema(ReviewContextProjectSchema),
  stalled_projects: boundedItemsSectionSchema(ReviewContextProjectSchema),
  projects_without_next_action: boundedItemsSectionSchema(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      status: ProjectStatusSchema,
    }),
  ),
  upcoming_7d: z.object({ days: z.array(TodayUpcomingDaySchema) }),
  recently_completed: boundedItemsSectionSchema(ReviewRecentlyCompletedItemSchema),
});
export type WeeklyReviewContext = z.infer<typeof WeeklyReviewContextSchema>;
