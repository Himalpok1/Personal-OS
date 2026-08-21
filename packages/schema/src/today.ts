// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { InboxItemStatusSchema } from "./inbox.js";
import { ProjectStatusSchema } from "./projects.js";

// GET /today's only input -- everything else about the read model is
// computed server-side against this timezone (frozen semantics,
// docs/ARCHITECTURE.md "Today & agenda read models").
export const TodayQuerySchema = z.object({
  tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
});
export type TodayQuery = z.infer<typeof TodayQuerySchema>;

// Shared shape for a task as the Today/agenda read models render it. Base
// excludes occurrence_id so agenda.ts can discriminate standalone tasks from
// occurrences while reusing these fields.
export const TodayTaskItemBaseSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  remind_at: z.string().datetime({ offset: true }).nullable(),
  timezone: z.string(),
  priority: z.number().int().nullable(),
  project_id: z.string().uuid().nullable(),
  project_name: z.string().nullable(),
  rrule: z.string().nullable(),
  parent_task_id: z.string().uuid().nullable(),
});
export type TodayTaskItemBase = z.infer<typeof TodayTaskItemBaseSchema>;

export const TodayTaskItemSchema = TodayTaskItemBaseSchema.extend({
  // Present (non-null) iff this row IS an occurrence of a recurring parent;
  // absent/null for a one-off task. Same presence-flavored pattern as
  // EventRangeItemSchema's parent_event_id/original_start_at.
  occurrence_id: z.string().uuid().nullable().optional(),
})
  .refine((item) => item.occurrence_id == null || item.parent_task_id !== null, {
    message: "an occurrence representation must carry its parent_task_id",
  })
  .describe("task row; occurrence rows must link their recurring parent");
export type TodayTaskItem = z.infer<typeof TodayTaskItemSchema>;

export const TodayEventItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  all_day: z.boolean(),
  start_date: z.string().date().nullable(),
  end_date: z.string().date().nullable(),
  location: z.string().nullable(),
  project_id: z.string().uuid().nullable(),
  rrule: z.string().nullable(),
  parent_event_id: z.string().uuid().nullable(),
  occurs_at: z.string().datetime({ offset: true }).nullable(),
});
export type TodayEventItem = z.infer<typeof TodayEventItemSchema>;

// Section with an honest total (items may be windowed, total is not) --
// same generic-factory taste as pagination.ts's paginatedResponseSchema.
export function boundedItemsSectionSchema<T extends z.ZodTypeAny>(itemSchema: T) {
  return z
    .object({
      items: z.array(itemSchema),
      total: z.number().int().min(0),
    })
    .refine((section) => section.total >= section.items.length, {
      message: "total must not be smaller than the emitted items",
    });
}

export const TodayUpcomingDaySchema = z.object({
  date: z.string().date(),
  tasks: z.array(TodayTaskItemSchema),
  events: z.array(TodayEventItemSchema),
  total: z.number().int().min(0),
});
export type TodayUpcomingDay = z.infer<typeof TodayUpcomingDaySchema>;

export const TodayInboxItemSchema = z.object({
  id: z.string().uuid(),
  raw_text: z.string().nullable(),
  status: InboxItemStatusSchema,
  captured_at: z.string().datetime({ offset: true }),
  // Deliberately string, not the inbox entity_type enum -- the Today badge
  // renders whatever the parser produced and must not break if the capture
  // vocabulary grows.
  entity_type: z.string().nullable(),
});
export type TodayInboxItem = z.infer<typeof TodayInboxItemSchema>;

const TodayNextActionSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  priority: z.number().int().nullable(),
});

export const TodayProjectSummarySchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  color: z.string().nullable(),
  status: ProjectStatusSchema,
  target_date: z.string().date().nullable(),
  next_action: TodayNextActionSchema.nullable(),
  open_task_count: z.number().int().min(0),
  overdue_task_count: z.number().int().min(0),
  done_task_count: z.number().int().min(0),
  last_activity_at: z.string().datetime({ offset: true }).nullable(),
  stalled: z.boolean(),
});
export type TodayProjectSummary = z.infer<typeof TodayProjectSummarySchema>;

// reviews/brief are present now for forward compatibility; their producers
// arrive in Checkpoints 5.3/5.5 and may legitimately return null until then.
export const TodayResponseSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  effective_now: z.string().datetime({ offset: true }),
  tz: z.string(),
  local_date: z.string().date(),
  summary: z.object({
    overdue_total: z.number().int().min(0),
    due_today_total: z.number().int().min(0),
    inbox_attention_total: z.number().int().min(0),
    active_project_count: z.number().int().min(0),
  }),
  overdue: boundedItemsSectionSchema(TodayTaskItemSchema),
  due_today: boundedItemsSectionSchema(TodayTaskItemSchema),
  events_today: z.object({ items: z.array(TodayEventItemSchema) }),
  upcoming: z.object({ days: z.array(TodayUpcomingDaySchema) }),
  inbox: z.object({
    pending_count: z.number().int().min(0),
    needs_confirm_count: z.number().int().min(0),
    failed_count: z.number().int().min(0),
    items: z.array(TodayInboxItemSchema),
  }),
  projects: z.object({
    active_count: z.number().int().min(0),
    items: z.array(TodayProjectSummarySchema),
  }),
  reviews: z.object({
    last_daily_review_at: z.string().datetime({ offset: true }).nullable(),
    last_weekly_review_at: z.string().datetime({ offset: true }).nullable(),
  }),
  brief: z
    .object({
      generated_at: z.string().datetime({ offset: true }),
      model_id: z.string().uuid().nullable(),
    })
    .nullable(),
});
export type TodayResponse = z.infer<typeof TodayResponseSchema>;
