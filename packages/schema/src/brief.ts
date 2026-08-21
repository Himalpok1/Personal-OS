// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

// POST /briefs (manual/on-demand only per ADR-041) -- no scheduling inputs,
// the server picks brief_date from tz.
export const BriefRequestSchema = z
  .object({
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
  })
  .strict();
export type BriefRequest = z.infer<typeof BriefRequestSchema>;

// LLM payload is extensible by design; `text` is the one guaranteed field
// every client renders. New provider fields may appear without a contract bump.
export const BriefContentSchema = z.object({ text: z.string() }).passthrough();
export type BriefContent = z.infer<typeof BriefContentSchema>;

export const DailyBriefRecordSchema = z.object({
  id: z.string().uuid(),
  brief_date: z.string().date(),
  timezone: z.string(),
  content: BriefContentSchema,
  model_id: z.string().uuid().nullable(),
  generated_at: z.string().datetime({ offset: true }),
});
export type DailyBriefRecord = z.infer<typeof DailyBriefRecordSchema>;
