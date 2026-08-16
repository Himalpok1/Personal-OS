import { z } from "zod";

// The four strict tool-calling schemas from docs/ARCHITECTURE.md's parse
// pipeline. Used both to build the tool JSON-schema sent to whichever
// provider is configured (see packages/ai-providers) and to validate the
// tool-call arguments that come back before they ever touch Drizzle.
export const CreateTaskToolSchema = z.object({
  title: z.string().min(1),
  due_at: z.string().datetime({ offset: true }).optional(),
  remind_at: z.string().datetime({ offset: true }).optional(),
  priority: z.number().int().optional(),
  project: z.string().optional(),
  rrule: z.string().optional(),
  recurrence_anchor: z.enum(["due_date", "completion_date"]).optional(),
  recurrence_timezone: z.string().optional(),
});
export type CreateTaskTool = z.infer<typeof CreateTaskToolSchema>;

export const CreateNoteToolSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  project: z.string().optional(),
});
export type CreateNoteTool = z.infer<typeof CreateNoteToolSchema>;

export const CreateEventToolSchema = z.object({
  title: z.string().min(1),
  start: z.string().datetime({ offset: true }),
  end: z.string().datetime({ offset: true }).optional(),
  location: z.string().optional(),
  rrule: z.string().optional(),
  all_day: z.boolean().optional(),
});
export type CreateEventTool = z.infer<typeof CreateEventToolSchema>;

export const UnclearToolSchema = z.object({
  reason: z.string().min(1),
});
export type UnclearTool = z.infer<typeof UnclearToolSchema>;

export const ParserToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("create_task"), args: CreateTaskToolSchema }),
  z.object({ tool: z.literal("create_note"), args: CreateNoteToolSchema }),
  z.object({ tool: z.literal("create_event"), args: CreateEventToolSchema }),
  z.object({ tool: z.literal("unclear"), args: UnclearToolSchema }),
]);
export type ParserToolCall = z.infer<typeof ParserToolCallSchema>;
