import { z } from "zod";
import { CaptureSourceSchema } from "./capture.js";
import { booleanQueryParam } from "./pagination.js";
import { ParserToolCallSchema } from "./parser-tools.js";

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
  // For a pending PTT item this temporarily exposes transcription
  // avg_logprob until capture parsing consumes it. After parsing, interpret
  // it only within the existing parse/confirmation semantics alongside
  // status and parse_result; it is not a durable standalone STT field.
  confidence: z.number().nullable(),
  entity_type: InboxEntityTypeSchema.nullable(),
  entity_id: z.string().uuid().nullable(),
  // Soft-delete axis (Checkpoint 9.3, migration 0017), orthogonal to
  // `status`: an archived row keeps whatever status it had and its committed
  // entity is untouched. Non-null means "handled; leave the Inbox and the
  // Today attention counts". There is no restore path, matching tasks.
  archived_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
});

export type InboxItem = z.infer<typeof InboxItemSchema>;

// POST /inbox/:id/archive response. Idempotent: a second call returns the
// archived_at the first one stamped, never a fresh instant.
export const InboxArchiveResponseSchema = z.object({
  id: z.string().uuid(),
  archived_at: z.string().datetime({ offset: true }),
});
export type InboxArchiveResponse = z.infer<typeof InboxArchiveResponseSchema>;

// The shape capture.parse persists into inbox_items.parse_result. It was
// previously an interface private to apps/worker, which is why the API's
// confirm route could write a DIFFERENT shape into the same column (it stored
// a bare tool call where the worker reads `.toolCall`) -- a correction was
// therefore unreadable by the only code that consumes it. Declaring it here
// makes API and worker agree by construction.
// Durable record of a capture.parse job that exhausted every pg-boss retry.
//
// Before Checkpoint 8.6A the ONLY record of such a failure was pg-boss's own
// `job.output`, which self-deletes on the queue's `deletion_seconds` (7 days by
// default -- a value nobody chose). `capture.parse` additionally had no
// dead-letter queue, so retry exhaustion left the inbox row in `pending` or
// `needs_confirm` forever with nothing durable saying why.
//
// Deliberately a CLOSED vocabulary of scalars. It can carry neither provider
// prose nor the user's capture text, for the same reason `errorToken` exists:
// this value is persisted, and a free-text field here would be a laundering
// path from an upstream error message into the database.
export const StoredParseFailureSchema = z.object({
  reason: z.literal("retries_exhausted"),
  mode: z.enum(["auto", "confirm"]),
  // `inbox_items` has no `updated_at`, so without this there is no record of
  // WHEN a row reached its terminal state.
  failed_at: z.string(),
});
export type StoredParseFailure = z.infer<typeof StoredParseFailureSchema>;

export const StoredParseResultSchema = z.object({
  toolCall: ParserToolCallSchema,
  confidenceFlags: z.array(z.string()),
  // Present only on a row the dead-letter handler finalized. Optional so every
  // pre-8.6A row still parses unchanged, and so finalizing a `needs_confirm`
  // row PRESERVES its stored tool call -- destroying it would take away the
  // correction the owner may still want to supply.
  failure: StoredParseFailureSchema.optional(),
});
export type StoredParseResult = z.infer<typeof StoredParseResultSchema>;

// Reads the failure marker from either shape it can occupy: alongside a
// preserved tool call, or alone on a row that never had one (the `pending`
// auto-parse path, where `parse_result` was NULL).
export function readStoredParseFailure(value: unknown): StoredParseFailure | null {
  if (typeof value !== "object" || value === null) return null;
  const parsed = StoredParseFailureSchema.safeParse(
    (value as { failure?: unknown }).failure ?? value,
  );
  return parsed.success ? parsed.data : null;
}

// inbox_items.parse_result is `jsonb` and is `unknown` on the wire, so every
// reader must narrow it defensively rather than casting. Returns null for the
// legacy `{error}` shape written on the no-provider path, for a correction
// stored before 8.4 fixed the shape, and for anything else unrecognised.
export function readStoredParseResult(value: unknown): StoredParseResult | null {
  const parsed = StoredParseResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

// Accepted by POST /inbox/:id/confirm to let the caller supply a corrected
// tool-call payload when the parser's own guess was wrong; omitted entirely
// means "the parser's needs_confirm guess was right, just commit it."
//
// Typed as ParserToolCallSchema rather than the previous `z.unknown()`: the
// worker parses this value against exactly that union before committing, so
// accepting anything looser only moved the rejection from a 400 the caller
// can read into a job failure nobody sees.
export const InboxConfirmRequestSchema = z.object({
  corrected_tool_call: ParserToolCallSchema.optional(),
});

export type InboxConfirmRequest = z.infer<typeof InboxConfirmRequestSchema>;

// Why a confirm was refused. Closed, because the mobile client maps each
// member to its own copy -- an open string would render as a blank error.
export const InboxConfirmRefusalSchema = z.enum([
  // The stored (or supplied) tool call is `unclear`: the parser could not
  // classify the capture, so there is no entity to create. Needs a correction.
  "parse_result_not_committable",
  // No parse result at all, or one written in a shape no reader understands.
  "parse_result_unreadable",
]);
export type InboxConfirmRefusal = z.infer<typeof InboxConfirmRefusalSchema>;

export const InboxListQuerySchema = z.object({
  status: InboxItemStatusSchema.optional(),
  // booleanQueryParam, never z.coerce.boolean() -- see pagination.ts. Same
  // convention as every other list endpoint with an archive axis.
  include_archived: booleanQueryParam(false),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type InboxListQuery = z.infer<typeof InboxListQuerySchema>;
