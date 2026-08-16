import { z } from "zod";

// ISO 8601 datetime with an OPTIONAL UTC offset -- deliberately looser than
// z.string().datetime({offset:true}). LLM tool-call output isn't guaranteed
// to include an offset just because it's requested (a model resolving
// "tomorrow at 3pm" may return "2026-08-17T15:00:00" with none at all), and
// rejecting that outright throws away a perfectly resolvable answer.
// packages/core's parseFlexibleDatetime is what actually resolves an
// offset-less value, against the capture's own timezone.
const FlexibleDatetimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
    "expected an ISO 8601 datetime",
  );

// The four strict tool-calling schemas from docs/ARCHITECTURE.md's parse
// pipeline. Used both to build the tool JSON-schema sent to whichever
// provider is configured (see packages/ai-providers) and to validate the
// tool-call arguments that come back before they ever touch Drizzle.
export const CreateTaskToolSchema = z.object({
  title: z.string().min(1),
  due_at: FlexibleDatetimeSchema.optional(),
  remind_at: FlexibleDatetimeSchema.optional(),
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
  start: FlexibleDatetimeSchema,
  end: FlexibleDatetimeSchema.optional(),
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
