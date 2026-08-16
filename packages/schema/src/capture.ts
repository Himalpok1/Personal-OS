import { isValidTimezone } from "@personal-os/core";
import { z } from "zod";

// Matches the /capture contract in docs/ARCHITECTURE.md. text is capped to
// bound both cost and abuse surface against the user's own LLM provider bill
// -- a single-user tool still shouldn't let one accidental paste burn a
// budget.
export const CaptureSourceSchema = z.enum(["siri", "ptt", "web", "share", "assistant"]);

export const CaptureRequestSchema = z.object({
  text: z.string().min(1).max(4000),
  source: CaptureSourceSchema,
  client_uuid: z.string().uuid(),
  captured_at: z.string().datetime({ offset: true }),
  timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
});

export type CaptureRequest = z.infer<typeof CaptureRequestSchema>;

export const CaptureResponseSchema = z.object({
  inbox_id: z.string().uuid(),
});

export type CaptureResponse = z.infer<typeof CaptureResponseSchema>;
