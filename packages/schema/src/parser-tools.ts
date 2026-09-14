import { z } from "zod";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  NOTE_BODY_MAX_CHARS,
  PARSER_PROJECT_REF_MAX_CHARS,
  PARSER_REASON_MAX_CHARS,
  tooLongMessage,
} from "./text-bounds.js";

// ISO 8601 datetime with an OPTIONAL UTC offset -- deliberately looser than
// z.string().datetime({offset:true}). LLM tool-call output isn't guaranteed
// to include an offset just because it's requested (a model resolving
// "tomorrow at 3pm" may return "2026-08-17T15:00:00" with none at all), and
// rejecting that outright throws away a perfectly resolvable answer.
// packages/core's parseFlexibleDatetime is what actually resolves an
// offset-less value, against the capture's own timezone.
export const FlexibleDatetimeSchema = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/,
    "expected an ISO 8601 datetime",
  );

// The four strict tool-calling schemas from docs/ARCHITECTURE.md's parse
// pipeline, in TWO tiers (Checkpoint 9.6, ADR-065):
//
//   * The `*ToolBaseSchema` tier is UNBOUNDED on its text fields. It is what
//     `inbox_items.parse_result` is READ through (`StoredParserToolCallSchema`
//     via inbox.ts's StoredParseResultSchema). Rows were written for weeks
//     before any bound existed, so a stored title longer than today's
//     ENTITY_TITLE_MAX_CHARS is a fact about the database, not a malformed
//     row -- and reading it through the bounded schema turned every such row
//     into `409 parse_result_unreadable`, unfilable from the device forever.
//   * The `*ToolSchema` tier extends the base with `.max()` bounds. It builds
//     the tool JSON-schema sent to whichever provider is configured (see
//     packages/ai-providers), validates the model's tool-call arguments before
//     they ever touch Drizzle (the worker truncates the model's args to the
//     bounds FIRST, so an over-long model title is a truncated title, not a
//     failed capture), and types `POST /inbox/:id/confirm`'s
//     `corrected_tool_call`, where an over-long title is the user's own typing
//     and is refused with a 400 naming the field.
//
// `.max()` changes nothing about the inferred TypeScript type, so the two
// tiers infer to structurally identical types and a stored tool call flows
// into every consumer typed on the bounded one unchanged.
const CreateTaskToolBaseSchema = z.object({
  title: z.string().min(1),
  due_at: FlexibleDatetimeSchema.optional(),
  remind_at: FlexibleDatetimeSchema.optional(),
  priority: z.number().int().optional(),
  project: z.string().optional(),
  rrule: z.string().optional(),
  recurrence_anchor: z.enum(["due_date", "completion_date"]).optional(),
  recurrence_timezone: z.string().optional(),
});

export const CreateTaskToolSchema = CreateTaskToolBaseSchema.extend({
  title: z
    .string()
    .min(1)
    .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("title", ENTITY_TITLE_MAX_CHARS)),
  project: z
    .string()
    .max(PARSER_PROJECT_REF_MAX_CHARS, tooLongMessage("project", PARSER_PROJECT_REF_MAX_CHARS))
    .optional(),
});
export type CreateTaskTool = z.infer<typeof CreateTaskToolSchema>;

const CreateNoteToolBaseSchema = z.object({
  title: z.string().min(1),
  body: z.string(),
  project: z.string().optional(),
});

export const CreateNoteToolSchema = CreateNoteToolBaseSchema.extend({
  title: z
    .string()
    .min(1)
    .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("title", ENTITY_TITLE_MAX_CHARS)),
  body: z.string().max(NOTE_BODY_MAX_CHARS, tooLongMessage("body", NOTE_BODY_MAX_CHARS)),
  project: z
    .string()
    .max(PARSER_PROJECT_REF_MAX_CHARS, tooLongMessage("project", PARSER_PROJECT_REF_MAX_CHARS))
    .optional(),
});
export type CreateNoteTool = z.infer<typeof CreateNoteToolSchema>;

const CreateEventToolBaseSchema = z.object({
  title: z.string().min(1),
  start: FlexibleDatetimeSchema,
  end: FlexibleDatetimeSchema.optional(),
  location: z.string().optional(),
  rrule: z.string().optional(),
  all_day: z.boolean().optional(),
});

export const CreateEventToolSchema = CreateEventToolBaseSchema.extend({
  title: z
    .string()
    .min(1)
    .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("title", ENTITY_TITLE_MAX_CHARS)),
  location: z
    .string()
    .max(EVENT_LOCATION_MAX_CHARS, tooLongMessage("location", EVENT_LOCATION_MAX_CHARS))
    .optional(),
});
export type CreateEventTool = z.infer<typeof CreateEventToolSchema>;

const UnclearToolBaseSchema = z.object({
  reason: z.string().min(1),
});

export const UnclearToolSchema = UnclearToolBaseSchema.extend({
  reason: z
    .string()
    .min(1)
    .max(PARSER_REASON_MAX_CHARS, tooLongMessage("reason", PARSER_REASON_MAX_CHARS)),
});
export type UnclearTool = z.infer<typeof UnclearToolSchema>;

/** The closed set of tool names; both unions discriminate on it. */
export const PARSER_TOOL_NAMES = ["create_task", "create_note", "create_event", "unclear"] as const;
export type ParserToolName = (typeof PARSER_TOOL_NAMES)[number];

/**
 * The UNBOUNDED union: what a persisted `parse_result.toolCall` is read
 * through. Never used to validate model output or a caller's correction --
 * those go through ParserToolCallSchema below.
 */
export const StoredParserToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("create_task"), args: CreateTaskToolBaseSchema }),
  z.object({ tool: z.literal("create_note"), args: CreateNoteToolBaseSchema }),
  z.object({ tool: z.literal("create_event"), args: CreateEventToolBaseSchema }),
  z.object({ tool: z.literal("unclear"), args: UnclearToolBaseSchema }),
]);
export type StoredParserToolCall = z.infer<typeof StoredParserToolCallSchema>;

/** The BOUNDED union: model output (after truncation) and confirm corrections. */
export const ParserToolCallSchema = z.discriminatedUnion("tool", [
  z.object({ tool: z.literal("create_task"), args: CreateTaskToolSchema }),
  z.object({ tool: z.literal("create_note"), args: CreateNoteToolSchema }),
  z.object({ tool: z.literal("create_event"), args: CreateEventToolSchema }),
  z.object({ tool: z.literal("unclear"), args: UnclearToolSchema }),
]);
export type ParserToolCall = z.infer<typeof ParserToolCallSchema>;

// Whether a parsed tool call can become a real task/note/event row.
//
// `unclear` is a legitimate parser OUTCOME -- it is one of the four tools the
// model may call, and Checkpoint 8.4 found it stored in production on two
// inbox items. It is NOT, however, a committable one: the parser is saying it
// could not classify the capture, so there is no entity to create. The commit
// switch in apps/worker/src/commit-parsed-entity.ts has always thrown on it.
//
// Before 8.4 nothing consulted that fact BEFORE enqueueing a commit, so
// confirming an `unclear` item enqueued a job that could only ever throw,
// burned all five retries, and left the item untouched with the user told
// nothing. This predicate is the single shared answer to "will a commit of
// this tool call be attempted, or is it structurally impossible?", so the API
// can refuse up front instead of accepting doomed work.
//
// Typed on the stored (unbounded) union: the bounded wire union is a subtype
// of it, so a call from either source qualifies without a cast.
export function isCommittableToolCall(call: StoredParserToolCall): boolean {
  return call.tool !== "unclear";
}
