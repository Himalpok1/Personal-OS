// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { TodayEventItemSchema, TodayTaskItemBaseSchema } from "./today.js";

export const AgendaQuerySchema = z
  .object({
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
    from: z.string().date(),
    to: z.string().date(),
  })
  .superRefine((value, ctx) => {
    if (value.to < value.from) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "must be on or after from" });
      return;
    }
    // Date-string arithmetic via UTC day numbers -- no timezone/DST
    // involvement; the span is a count of calendar dates.
    const [year, month, day] = value.to.split("-");
    const toMs = Date.UTC(Number(year), Number(month) - 1, Number(day));
    const [fromYear, fromMonth, fromDay] = value.from.split("-");
    const fromMs = Date.UTC(Number(fromYear), Number(fromMonth) - 1, Number(fromDay));
    const spanDays = (toMs - fromMs) / 86_400_000;
    if (spanDays > 62) {
      ctx.addIssue({ code: "custom", path: ["to"], message: "range must not exceed 62 days" });
    }
  });
export type AgendaQuery = z.infer<typeof AgendaQuerySchema>;

export const AgendaTaskItemSchema = TodayTaskItemBaseSchema.extend({
  kind: z.literal("task"),
});
export type AgendaTaskItem = z.infer<typeof AgendaTaskItemSchema>;

// A materialized occurrence IS the actionable item (recurring dedupe rule);
// its parent linkage and instance instant are required, unlike the nullable
// forms on the base task shape.
export const AgendaOccurrenceItemSchema = TodayTaskItemBaseSchema.extend({
  kind: z.literal("occurrence"),
  occurrence_id: z.string().uuid(),
  parent_task_id: z.string().uuid(),
  occurs_at: z.string().datetime({ offset: true }),
});
export type AgendaOccurrenceItem = z.infer<typeof AgendaOccurrenceItemSchema>;

export const AgendaEventItemSchema = TodayEventItemSchema.extend({
  kind: z.literal("event"),
});
export type AgendaEventItem = z.infer<typeof AgendaEventItemSchema>;

export const AgendaItemSchema = z.discriminatedUnion("kind", [
  AgendaTaskItemSchema,
  AgendaOccurrenceItemSchema,
  AgendaEventItemSchema,
]);
export type AgendaItem = z.infer<typeof AgendaItemSchema>;

export const AgendaDaySchema = z.object({
  date: z.string().date(),
  items: z.array(AgendaItemSchema),
});
export type AgendaDay = z.infer<typeof AgendaDaySchema>;

export const AgendaResponseSchema = z.object({
  tz: z.string(),
  from: z.string().date(),
  to: z.string().date(),
  generated_at: z.string().datetime({ offset: true }),
  effective_now: z.string().datetime({ offset: true }),
  // Events have no overdue notion (frozen semantics); only tasks and
  // occurrences can be overdue.
  overdue: z.array(z.union([AgendaTaskItemSchema, AgendaOccurrenceItemSchema])),
  days: z.array(AgendaDaySchema),
});
export type AgendaResponse = z.infer<typeof AgendaResponseSchema>;
