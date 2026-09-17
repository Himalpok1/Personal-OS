import { z } from "zod";
import { ENTITY_TITLE_MAX_CHARS, PROJECT_GOAL_MAX_CHARS, tooLongMessage } from "./text-bounds.js";
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
    name: z
      .string()
      .min(1)
      .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("name", ENTITY_TITLE_MAX_CHARS)),
    color: z.string().max(64).optional(),
    goal: z
      .string()
      .max(PROJECT_GOAL_MAX_CHARS, tooLongMessage("goal", PROJECT_GOAL_MAX_CHARS))
      .optional(),
    target_date: z.string().date().optional(),
  })
  .strict();
export type ProjectCreate = z.infer<typeof ProjectCreateSchema>;

export const ProjectUpdateSchema = z
  .object({
    name: z
      .string()
      .min(1)
      .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("name", ENTITY_TITLE_MAX_CHARS))
      .optional(),
    color: z.string().max(64).nullable().optional(),
    goal: z
      .string()
      .max(PROJECT_GOAL_MAX_CHARS, tooLongMessage("goal", PROJECT_GOAL_MAX_CHARS))
      .nullable()
      .optional(),
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

// Exported (not just its inferred type) so GET /projects/:id/context
// (Checkpoint 10.5) can `.extend()` it rather than restate its fields.
export const ProjectDetailTaskSchema = z.object({
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
// instance is never listed twice alongside its series. Exported for the
// same reason as ProjectDetailTaskSchema above.
export const ProjectDetailEventSchema = z.object({
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

// ---------------------------------------------------------------------------
// GET /projects/:id/context (Checkpoint 10.5, ADR-074)
// ---------------------------------------------------------------------------
//
// A NEW, separate response -- not a widening of ProjectDetailResponseSchema
// -- built for a future bounded-context caller (the same "context" shape
// GET /academic/courses/:id/context adds alongside its own detail route).
//
// PRIVACY BOUNDARY: `canvas_assignment_id` on a task item is the ONLY Canvas
// fact this response may ever carry, and it is an opaque id the owner set on
// their OWN task -- never a Canvas-authored title, course name or any other
// provider content. Enforced structurally, not just by convention: this file
// has no import from `@personal-os/canvas-providers` and never will need
// one, because nothing here reads a canvas_* table -- the read model behind
// this schema (apps/api/src/read-models/project-context.ts) selects
// `tasks.canvas_assignment_id` alone, a plain uuid column on the tasks row.

/**
 * ProjectDetailTaskSchema plus the one Canvas-adjacent fact a task may
 * carry: the opaque id of a linked assignment, never its content. `null`
 * when the task was never linked (ADR-074: explicit-only, never inferred).
 */
export const ProjectContextTaskSchema = ProjectDetailTaskSchema.extend({
  canvas_assignment_id: z.string().uuid().nullable(),
}).strict();
export type ProjectContextTask = z.infer<typeof ProjectContextTaskSchema>;

/**
 * An inbox capture that became one of this project's own items -- a
 * deterministic join through `inbox_items.entity_type`/`entity_id`, never a
 * text match or a guess. `entity_type`/`entity_id` are echoed so a caller can
 * navigate to the item the capture became.
 */
export const ProjectRelatedCaptureSchema = z
  .object({
    id: z.string().uuid(),
    raw_text: z.string().nullable(),
    source: z.string(),
    status: z.string(),
    captured_at: z.string().datetime({ offset: true }),
    entity_type: z.enum(["task", "note", "event"]),
    entity_id: z.string().uuid(),
  })
  .strict();
export type ProjectRelatedCapture = z.infer<typeof ProjectRelatedCaptureSchema>;

/**
 * The closed vocabulary of recent-activity feed entries -- exactly the three
 * signal categories `isStalledProject`'s own activity-signal reasoning
 * already names (packages/core's ProjectActivitySignals): task completions,
 * note writes/updates, occurrence completions. This feed does not add a
 * fourth (plain task creation/edit) beyond what that reasoning covers.
 */
export const ProjectActivityTypeSchema = z.enum([
  "task_completed",
  "note_written",
  "occurrence_completed",
]);
export type ProjectActivityType = z.infer<typeof ProjectActivityTypeSchema>;

/**
 * One entry in the project's recent-activity feed: a server-authored
 * description (never a raw title concatenation a client would have to
 * re-derive) and the instant it happened at.
 */
export const ProjectActivityItemSchema = z
  .object({
    type: ProjectActivityTypeSchema,
    description: z.string(),
    at: z.string().datetime({ offset: true }),
  })
  .strict();
export type ProjectActivityItem = z.infer<typeof ProjectActivityItemSchema>;

export const PROJECT_CONTEXT_TASKS_ITEM_CAP = 50;
export const PROJECT_CONTEXT_EVENTS_ITEM_CAP = 50;
export const PROJECT_CONTEXT_RELATED_CAPTURES_ITEM_CAP = 20;
export const PROJECT_CONTEXT_RECENT_ACTIVITY_ITEM_CAP = 20;
/** How far back the recent-activity feed looks, from the build's own now. */
export const PROJECT_CONTEXT_RECENT_ACTIVITY_WINDOW_DAYS = 30;

/**
 * The project's own tasks and calendar items (same queries/ordering as
 * GET /projects/:id/detail, reused rather than duplicated), plus two new
 * sections: captures that became one of this project's items, and a small
 * newest-first feed of what happened on this project in the last
 * PROJECT_CONTEXT_RECENT_ACTIVITY_WINDOW_DAYS days. Same 404 rule as detail
 * (an unknown id 404s; an archived project's context is still readable, same
 * as a direct fetch of the project itself).
 */
export const ProjectContextResponseSchema = z
  .object({
    project: ProjectSchema,
    tasks: z.object({
      items: z.array(ProjectContextTaskSchema),
      total: z.number().int().min(0),
    }),
    events: z.object({
      items: z.array(ProjectDetailEventSchema),
      total: z.number().int().min(0),
    }),
    related_captures: z.object({
      items: z.array(ProjectRelatedCaptureSchema),
      total: z.number().int().min(0),
    }),
    recent_activity: z.object({
      items: z.array(ProjectActivityItemSchema),
      total: z.number().int().min(0),
    }),
  })
  .strict();
export type ProjectContextResponse = z.infer<typeof ProjectContextResponseSchema>;
