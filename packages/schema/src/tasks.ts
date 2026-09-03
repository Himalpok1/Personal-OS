// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { validateCompletionAnchoredRule } from "@personal-os/core/recurrence/editor";
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
  rrule: z.string().nullable(),
  recurrence_anchor: z.enum(["due_date", "completion_date"]).nullable(),
  recurrence_timezone: z.string().nullable(),
  recurrence_until: z.string().datetime({ offset: true }).nullable(),
  recurrence_count: z.number().int().nullable(),
  recurrence_exdates: z.array(z.string().date()).nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Task = z.infer<typeof TaskSchema>;

export const TaskCreateSchema = z
  .object({
    title: z.string().min(1),
    body: z.string().optional(),
    due_at: FlexibleDatetimeSchema.optional(),
    // Creation-time reminders. TaskUpdateSchema has carried remind_at since
    // Checkpoint 5.4, and the tasks.remind_at column has existed since Phase
    // 1, but creation never accepted it -- so the only way to set a reminder
    // on a new task was to create it and then PATCH it. Checkpoint 8.4 closes
    // that; no migration, the column is already there.
    remind_at: FlexibleDatetimeSchema.optional(),
    priority: z.number().int().optional(),
    project_id: z.string().uuid().optional(),
    timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
    rrule: z.string().nullable().optional(),
    recurrence_timezone: z.string().nullable().optional(),
    recurrence_anchor: z.enum(["due_date", "completion_date"]).nullable().optional(),
    recurrence_until: FlexibleDatetimeSchema.nullable().optional(),
    recurrence_count: z.number().int().positive().nullable().optional(),
    recurrence_exdates: z.array(z.string().date()).nullable().optional(),
  })
  .strict()
  .superRefine((val, ctx) => {
    if (val.recurrence_until != null && val.recurrence_count != null) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence_until"],
        message: "recurrence_until and recurrence_count are mutually exclusive",
      });
      ctx.addIssue({
        code: "custom",
        path: ["recurrence_count"],
        message: "recurrence_until and recurrence_count are mutually exclusive",
      });
    }
    if (val.rrule) {
      if (
        val.recurrence_timezone !== undefined &&
        val.recurrence_timezone !== null &&
        !isValidTimezone(val.recurrence_timezone)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_timezone"],
          message: "unknown IANA timezone",
        });
      }
    }
    if (val.recurrence_anchor === "completion_date") {
      if (val.recurrence_until != null) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_until"],
          message: "completion-anchored recurrence rules do not support recurrence_until",
        });
      }
      if (val.recurrence_count != null) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_count"],
          message: "completion-anchored recurrence rules do not support recurrence_count",
        });
      }
      if (val.recurrence_exdates != null && val.recurrence_exdates.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_exdates"],
          message: "completion-anchored recurrence rules do not support recurrence_exdates",
        });
      }
      if (val.rrule) {
        try {
          validateCompletionAnchoredRule(val.rrule);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.addIssue({
            code: "custom",
            path: ["rrule"],
            message: msg,
          });
        }
      }
    }
  });
export type TaskCreate = z.infer<typeof TaskCreateSchema>;

// No status/archived_at here -- those change only via the dedicated
// /activate, /complete, /drop, /archive action endpoints.
export const TaskUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    body: z.string().nullable().optional(),
    due_at: FlexibleDatetimeSchema.nullable().optional(),
    // Closes the recorded debt that a reminder time could previously only
    // originate from AI capture -- this makes the field writable via a
    // normal PATCH. Reminder SCHEDULING itself remains entirely
    // client-side/native (local notification reconciliation on the
    // primary device); this field only carries the stored instant.
    remind_at: FlexibleDatetimeSchema.nullable().optional(),
    priority: z.number().int().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
    rrule: z.string().nullable().optional(),
    recurrence_timezone: z.string().nullable().optional(),
    recurrence_anchor: z.enum(["due_date", "completion_date"]).nullable().optional(),
    recurrence_until: FlexibleDatetimeSchema.nullable().optional(),
    recurrence_count: z.number().int().positive().nullable().optional(),
    recurrence_exdates: z.array(z.string().date()).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  })
  .superRefine((val, ctx) => {
    if (val.recurrence_until != null && val.recurrence_count != null) {
      ctx.addIssue({
        code: "custom",
        path: ["recurrence_until"],
        message: "recurrence_until and recurrence_count are mutually exclusive",
      });
      ctx.addIssue({
        code: "custom",
        path: ["recurrence_count"],
        message: "recurrence_until and recurrence_count are mutually exclusive",
      });
    }
    if (val.rrule) {
      if (
        val.recurrence_timezone !== undefined &&
        val.recurrence_timezone !== null &&
        !isValidTimezone(val.recurrence_timezone)
      ) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_timezone"],
          message: "unknown IANA timezone",
        });
      }
    }
    if (val.recurrence_anchor === "completion_date") {
      if (val.recurrence_until != null) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_until"],
          message: "completion-anchored recurrence rules do not support recurrence_until",
        });
      }
      if (val.recurrence_count != null) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_count"],
          message: "completion-anchored recurrence rules do not support recurrence_count",
        });
      }
      if (val.recurrence_exdates != null && val.recurrence_exdates.length > 0) {
        ctx.addIssue({
          code: "custom",
          path: ["recurrence_exdates"],
          message: "completion-anchored recurrence rules do not support recurrence_exdates",
        });
      }
      if (val.rrule) {
        try {
          validateCompletionAnchoredRule(val.rrule);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          ctx.addIssue({
            code: "custom",
            path: ["rrule"],
            message: msg,
          });
        }
      }
    }
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
