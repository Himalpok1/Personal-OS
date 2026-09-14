import { z } from "zod";

// GET /reminders (Checkpoint 9.4). The primary device schedules one local
// notification per item; the server derives per-occurrence instants for
// recurring tasks so a reminder no longer fires once per task and never
// again (the A3 debt). Closed shape: no body, no notes, no ids beyond the
// two the client needs to act on the notification.
export const REMINDERS_DEFAULT_HORIZON_DAYS = 45;
export const REMINDERS_MAX_HORIZON_DAYS = 90;

export const ReminderItemSchema = z
  .object({
    /** `task:<task id>` for a one-off task, `occ:<occurrence id>` for an occurrence. */
    key: z.string().min(1),
    task_id: z.string().uuid(),
    occurrence_id: z.string().uuid().nullable(),
    title: z.string(),
    remind_at: z.string().datetime({ offset: true }),
    /** The effective due instant (snoozed_until ?? occurs_at for an occurrence). */
    due_at: z.string().datetime({ offset: true }).nullable(),
    timezone: z.string(),
    recurring: z.boolean(),
  })
  .strict();
export type ReminderItem = z.infer<typeof ReminderItemSchema>;

export const RemindersResponseSchema = z
  .object({
    items: z.array(ReminderItemSchema),
    horizon_days: z.number().int(),
  })
  .strict();
export type RemindersResponse = z.infer<typeof RemindersResponseSchema>;

export const RemindersQuerySchema = z.object({
  horizon_days: z.coerce
    .number()
    .int()
    .min(1)
    .max(REMINDERS_MAX_HORIZON_DAYS)
    .default(REMINDERS_DEFAULT_HORIZON_DAYS),
});
export type RemindersQuery = z.infer<typeof RemindersQuerySchema>;
