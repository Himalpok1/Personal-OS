// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { FlexibleDatetimeSchema } from "./parser-tools.js";
import { booleanQueryParam } from "./pagination.js";

export const TaskStatusSchema = z.enum(["inbox", "active", "done", "dropped"]);
export type TaskStatus = z.infer<typeof TaskStatusSchema>;

const CommaSeparatedTaskStatuses = z
  .string()
  .transform((value) => value.split(",").map((s) => s.trim()))
  .pipe(z.array(TaskStatusSchema).min(1));

export const TaskSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  body: z.string().nullable(),
  status: TaskStatusSchema,
  due_at: z.string().datetime({ offset: true }).nullable(),
  remind_at: z.string().datetime({ offset: true }).nullable(),
  timezone: z.string(),
  priority: z.number().int().nullable(),
  project_id: z.string().uuid().nullable(),
  completed_at: z.string().datetime({ offset: true }).nullable(),
  // Read-only in Phase 2 -- rrule creation/editing stays capture(AI)-only
  // until Phase 4's RRULE editor (see docs/ARCHITECTURE.md's Phase plan).
  rrule: z.string().nullable(),
  recurrence_anchor: z.enum(["due_date", "completion_date"]).nullable(),
  recurrence_timezone: z.string().nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Task = z.infer<typeof TaskSchema>;

// .strict() so an attempt to sneak rrule/recurrence_*/status/archived_at
// into a create body is a loud 400, not a silent strip.
export const TaskCreateSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().optional(),
    due_at: FlexibleDatetimeSchema.optional(),
    priority: z.number().int().optional(),
    project_id: z.string().uuid().optional(),
    timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
  })
  .strict();
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

// No status/archived_at here -- those change only via the dedicated
// /activate, /complete, /drop, /archive action endpoints.
export const TaskUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().nullable().optional(),
    due_at: FlexibleDatetimeSchema.nullable().optional(),
    priority: z.number().int().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type TaskUpdate = z.infer<typeof TaskUpdateSchema>;

export const TaskListQuerySchema = z.object({
  status: CommaSeparatedTaskStatuses.optional(),
  project_id: z.string().uuid().optional(),
  include_archived: booleanQueryParam(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type TaskListQuery = z.infer<typeof TaskListQuerySchema>;
