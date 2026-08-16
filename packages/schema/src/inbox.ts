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
  raw_text: z.string(),
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
