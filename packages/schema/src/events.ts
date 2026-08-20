// Deep import, not the barrel -- see capture.ts's/tasks.ts's comment on
// this same import for why (keeps rrule and a Node-only workaround out of
// the web bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { OccurrenceStatusSchema } from "./occurrences.js";
import { booleanQueryParam, PaginationQuerySchema } from "./pagination.js";
import { FlexibleDatetimeSchema } from "./parser-tools.js";

export const EventSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  timezone: z.string(),
  all_day: z.boolean(),
  // All-day events use dates, never midnight-timestamptz -- see
  // packages/db/src/schema/events.ts.
  start_date: z.string().date().nullable(),
  end_date: z.string().date().nullable(),
  // Read-only in Checkpoint 4.1, same precedent as TaskSchema's rrule
  // fields -- recurrence stays capture(AI)-only until Phase 4's RRULE
  // editor (see docs/ARCHITECTURE.md's Phase plan).
  rrule: z.string().nullable(),
  recurrence_timezone: z.string().nullable(),
  project_id: z.string().uuid().nullable(),
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type Event = z.infer<typeof EventSchema>;

// .strict() so an attempt to sneak rrule/recurrence_*/archived_at into a
// create body is a loud 400, not a silent strip -- same discipline as
// TaskCreateSchema.
export const EventCreateSchema = z
  .object({
    title: z.string().min(1),
    description: z.string().optional(),
    location: z.string().optional(),
    starts_at: FlexibleDatetimeSchema.optional(),
    ends_at: FlexibleDatetimeSchema.optional(),
    timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
    all_day: z.boolean().optional(),
    start_date: z.string().date().optional(),
    end_date: z.string().date().optional(),
    project_id: z.string().uuid().optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    const allDay = value.all_day ?? false;
    if (allDay) {
      if (!value.start_date) {
        ctx.addIssue({
          code: "custom",
          path: ["start_date"],
          message: "required for all-day events",
        });
      }
      if (value.starts_at !== undefined || value.ends_at !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["starts_at"],
          message: "timestamps are not allowed for all-day events",
        });
      }
      if (value.start_date && value.end_date && value.end_date < value.start_date) {
        ctx.addIssue({
          code: "custom",
          path: ["end_date"],
          message: "must be on or after start_date",
        });
      }
    } else {
      if (!value.starts_at) {
        ctx.addIssue({ code: "custom", path: ["starts_at"], message: "required for timed events" });
      }
      if (value.start_date !== undefined || value.end_date !== undefined) {
        ctx.addIssue({
          code: "custom",
          path: ["start_date"],
          message: "date-only fields are not allowed for timed events",
        });
      }
    }
  });
export type EventCreate = z.infer<typeof EventCreateSchema>;

// No archived_at here -- that changes only via the dedicated /archive
// action endpoint, same as tasks/notes.
export const EventUpdateSchema = z
  .object({
    title: z.string().min(1).optional(),
    description: z.string().nullable().optional(),
    location: z.string().nullable().optional(),
    starts_at: FlexibleDatetimeSchema.nullable().optional(),
    ends_at: FlexibleDatetimeSchema.nullable().optional(),
    all_day: z.boolean().optional(),
    start_date: z.string().date().nullable().optional(),
    end_date: z.string().date().nullable().optional(),
    project_id: z.string().uuid().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, {
    message: "at least one field must be provided",
  });
export type EventUpdate = z.infer<typeof EventUpdateSchema>;

export const EventListQuerySchema = PaginationQuerySchema.extend({
  project_id: z.string().uuid().optional(),
  include_archived: booleanQueryParam(false),
});
export type EventListQuery = z.infer<typeof EventListQuerySchema>;

// For GET /events/range (built separately, atop this schema). Unlike
// FlexibleDatetimeSchema (LLM tool-call output, offset optional), `from`/
// `to` are structured API query parameters -- an explicit UTC offset is
// required, same as every response schema's datetime fields
// (z.string().datetime({ offset: true })), no new validator needed.
const MAX_EVENT_RANGE_MS = 366 * 24 * 60 * 60 * 1000;
export const EventRangeQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }),
    to: z.string().datetime({ offset: true }),
    include_archived: booleanQueryParam(false),
  })
  .superRefine((value, ctx) => {
    const from = Date.parse(value.from);
    const to = Date.parse(value.to);
    if (from >= to) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "must be later than from" });
    } else if (to - from > MAX_EVENT_RANGE_MS) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "range must not exceed 366 days" });
    }
  });
export type EventRangeQuery = z.infer<typeof EventRangeQuerySchema>;

// One merged entry from GET /events/range, covering all three source kinds
// (one-off timed, one-off all-day, recurring instance) with a single shape
// so the calendar UI (a later checkpoint) doesn't need to branch on entry
// type just to render it. `id` is always the *source* event's id -- for a
// recurring instance that's the parent series, not a per-occurrence id,
// since occurrences aren't guaranteed to be materialized rows.
//
// starts_at/ends_at/start_date/end_date always describe the *source event
// itself* (for a recurring series, that's its dtstart/dtend template, the
// same value on every instance) -- they are NOT re-pointed at the specific
// instance. occurs_at/occurs_ends_at carry the instance-specific real
// instants and are the fields a calendar view should actually position a
// recurring entry with; both are null for a one-off entry
// (is_recurring_instance: false), where starts_at/ends_at (or
// start_date/end_date) already are the instance.
export const EventRangeItemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  description: z.string().nullable(),
  location: z.string().nullable(),
  all_day: z.boolean(),
  starts_at: z.string().datetime({ offset: true }).nullable(),
  ends_at: z.string().datetime({ offset: true }).nullable(),
  start_date: z.string().date().nullable(),
  end_date: z.string().date().nullable(),
  is_recurring_instance: z.boolean(),
  occurs_at: z.string().datetime({ offset: true }).nullable(),
  occurs_ends_at: z.string().datetime({ offset: true }).nullable(),
  // Null for a one-off entry (status is a recurring-occurrence concept only).
  // In practice this is only ever "scheduled" or "done": a real occurrences
  // row with status "skipped" is excluded from the response entirely rather
  // than surfaced with that status -- see GET /events/range's handler.
  status: OccurrenceStatusSchema.nullable(),
});
export type EventRangeItem = z.infer<typeof EventRangeItemSchema>;

export const EventRangeResponseSchema = z.array(EventRangeItemSchema);
export type EventRangeResponse = z.infer<typeof EventRangeResponseSchema>;
