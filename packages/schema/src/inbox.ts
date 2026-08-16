import { z } from "zod";
import { CaptureSourceSchema } from "./capture.js";

export const InboxItemStatusSchema = z.enum([
  "pending",
  "parsed",
  "needs_confirm",
  "confirmed",
  "failed",
]);
export type InboxItemStatus = z.infer<typeof InboxItemStatusSchema>;

export const InboxEntityTypeSchema = z.enum(["note", "task", "event"]);

export const InboxItemSchema = z.object({
  id: z.string().uuid(),
  client_uuid: z.string().uuid().nullable(),
  // Nullable: a PTT capture (source: "ptt") has no transcript yet until
  // ptt.transcribe fills it in. The mobile Inbox screen renders this
  // three-ways: transcript present -> show it; null + status "pending" ->
  // "Transcribing..."; null + status "failed" -> "Transcription failed".
  raw_text: z.string().nullable(),
  source: CaptureSourceSchema,
  captured_at: z.string().datetime({ offset: true }),
  timezone: z.string(),
  status: InboxItemStatusSchema,
  parse_result: z.unknown().nullable(),
  confidence: z.number().nullable(),
  entity_type: InboxEntityTypeSchema.nullable(),
  entity_id: z.string().uuid().nullable(),
  created_at: z.string().datetime({ offset: true }),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

// Accepted by POST /inbox/:id/confirm to let the caller supply a corrected
// tool-call payload when the parser's own guess was wrong; omitted entirely
// means "the parser's needs_confirm guess was right, just commit it."
export const InboxConfirmRequestSchema = z.object({
  corrected_tool_call: z.unknown().optional(),
});

export type InboxConfirmRequest = z.infer<typeof InboxConfirmRequestSchema>;

export const InboxListQuerySchema = z.object({
  status: InboxItemStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InboxListQuery = z.infer<typeof InboxListQuerySchema>;
