import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

// The mail digest record (ADR-053). Shaped on `brief.ts`, whose
// `(brief_date, timezone)` identity solved the same problem.
//
// Checkpoint 7.1 defines the persisted RECORD only. The digest's INPUT
// shape -- the closed scalar allowlist that will be the only thing reaching a
// prompt -- belongs to Checkpoint 7.4, together with the generation pipeline,
// and is deliberately absent here: defining it now would freeze a security
// contract before the code that has to honour it exists.

/**
 * The digest payload.
 *
 * `.passthrough()` mirrors `BriefContentSchema`, and carries the same caveat:
 * it exists for future SERVER-authored fields, not as a licence to persist
 * arbitrary model-returned keys. Checkpoint 7.4 must reconstruct `{ text }`
 * server-side rather than spreading the model's result, exactly as
 * `apps/api/src/brief/generate.ts` does.
 */
export const MailDigestContentSchema = z.object({ text: z.string() }).passthrough();
export type MailDigestContent = z.infer<typeof MailDigestContentSchema>;

/**
 * One persisted digest.
 *
 * IDENTITY IS `(digest_date, timezone)` AND THERE IS NO `connection_id`.
 * That absence is deliberate and is the ADR-053 decision: the digest is GLOBAL
 * across every active mail connection. "What needs my attention today" is not a
 * per-account question, and a per-mailbox identity would make the answer depend
 * on how many mailboxes happen to be connected.
 *
 * `timezone` is part of the identity for the reason `ai_daily_briefs` has it:
 * the same instant is a different local calendar date in different zones, and
 * the row describes one requested local day.
 *
 * `model_id` records which `ai_models` row ACTUALLY served the generation --
 * via `callWithFallbackTracked`, never the route's assumed primary -- and is
 * nullable so a later model deletion cannot take the digest's history with it.
 */
export const MailDigestRecordSchema = z.object({
  id: z.string().uuid(),
  digest_date: z.string().date(),
  timezone: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
  content: MailDigestContentSchema,
  model_id: z.string().uuid().nullable(),
  generated_at: z.string().datetime({ offset: true }),
});
export type MailDigestRecord = z.infer<typeof MailDigestRecordSchema>;
