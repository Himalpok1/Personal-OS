import { z } from "zod";
import { booleanQueryParam } from "./pagination.js";

// Literals defined here, not imported from core -- the wire vocabulary is a
// contract of this package (core may map to richer internal states).
export const PROJECT_STATUSES = ["active", "paused", "completed"] as const;
export const ProjectStatusSchema = z.enum(PROJECT_STATUSES);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  status: ProjectStatusSchema,
  goal: z.string().nullable(),
  color: z.string().nullable(),
  target_date: z.string().date().nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Project = z.infer<typeof ProjectSchema>;

// No `status` field -- lifecycle transitions happen via dedicated endpoints
// (Checkpoint 5.2), never through generic create/update.
export const ProjectCreateSchema = z
  .object({
    name: z.string().min(1),
    color: z.string().optional(),
    goal: z.string().optional(),
    target_date: z.string().date().optional(),
  })
  .strict();
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z
  .object({
    name: z.string().min(1).optional(),
    color: z.string().nullable().optional(),
    goal: z.string().nullable().optional(),
    target_date: z.string().date().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type ProjectUpdate = z.infer<typeof ProjectUpdateSchema>;

export const ProjectListQuerySchema = z.object({
  include_archived: booleanQueryParam(false),
});
export type ProjectListQuery = z.infer<typeof ProjectListQuerySchema>;

// ---- Checkpoint 5.2 read models (frozen before parallel implementation) ----

export const ProjectNextActionSchema = z.object({
  task_id: z.string().uuid(),
  title: z.string(),
  due_at: z.string().datetime({ offset: true }).nullable(),
  priority: z.number().int().nullable(),
});
export type ProjectNextAction = z.infer<typeof ProjectNextActionSchema>;

export const ProjectCountsSchema = z.object({
  open: z.number().int().min(0),
  done: z.number().int().min(0),
  overdue: z.number().int().min(0),
});
export type ProjectCounts = z.infer<typeof ProjectCountsSchema>;

// Enriched list row for the Projects screen: the base row plus computed
// aggregates. `status` stays part of the base row; paused/completed rows are
// valid members of the summaries list.
export const ProjectSummaryItemSchema = ProjectSchema.extend({
  next_action: ProjectNextActionSchema.nullable(),
  stalled: z.boolean(),
  last_activity_at: z.string().datetime({ offset: true }).nullable(),
  counts: ProjectCountsSchema,
});
export type ProjectSummaryItem = z.infer<typeof ProjectSummaryItemSchema>;

export const ProjectSummaryListResponseSchema = z.object({
  items: z.array(ProjectSummaryItemSchema),
});
export type ProjectSummaryListResponse = z.infer<typeof ProjectSummaryListResponseSchema>;

const ProjectDetailTaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  status: z.enum(["inbox", "active", "done", "dropped"]),
  due_at: z.string().datetime({ offset: true }).nullable(),
  priority: z.number().int().nullable(),
  rrule: z.string().nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
});
export type ProjectDetailTask = z.infer<typeof ProjectDetailTaskSchema>;

const ProjectDetailNoteSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type ProjectDetailNote = z.infer<typeof ProjectDetailNoteSchema>;

// Series-level rows only -- detached occurrence children
// (parent_event_id IS NOT NULL) are excluded by producers so an overridden
// instance is never listed twice alongside its series.
const ProjectDetailEventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  all_day: z.boolean(),
  start_date: z.string().date().nullable(),
  end_date: z.string().date().nullable(),
  location: z.string().nullable(),
  rrule: z.string().nullable(),
});
export type ProjectDetailEvent = z.infer<typeof ProjectDetailEventSchema>;

export const ProjectDetailComputedSchema = z.object({
  next_action: ProjectNextActionSchema.nullable(),
  stalled: z.boolean(),
  last_activity_at: z.string().datetime({ offset: true }).nullable(),
  counts: ProjectCountsSchema,
});
export type ProjectDetailComputed = z.infer<typeof ProjectDetailComputedSchema>;

export const ProjectDetailResponseSchema = z.object({
  project: ProjectSchema,
  computed: ProjectDetailComputedSchema,
  tasks: z.object({ items: z.array(ProjectDetailTaskSchema), total: z.number().int().min(0) }),
  notes: z.object({ items: z.array(ProjectDetailNoteSchema), total: z.number().int().min(0) }),
  events: z.object({ items: z.array(ProjectDetailEventSchema), total: z.number().int().min(0) }),
});
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;
