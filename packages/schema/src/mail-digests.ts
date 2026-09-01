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

// ---------------------------------------------------------------------------
// READ / GENERATE CONTRACTS (Checkpoint 7.6)
// ---------------------------------------------------------------------------
//
// THE CLIENT DOES NOT CHOOSE THE DIGEST'S TIMEZONE, AND THAT IS THE WHOLE
// DIFFERENCE FROM THE DAILY BRIEF.
//
// `BriefRequestSchema` takes a `tz` because a brief is generated synchronously,
// per request, for whichever local day the caller is asking about. A digest is
// not that: it is a SCHEDULED, GLOBAL artifact whose zone is server
// configuration (`MAIL_DIGEST_TIMEZONE`), for the reason `resolveDigestTimezone`
// records -- a cron has nobody to ask, and deriving the zone from a device would
// make the row's IDENTITY drift as devices come and go.
//
// Accepting a `tz` here would therefore be actively harmful in two ways. A
// client asking for `America/Chicago` against a server configured for UTC (the
// default) would find no row and see an empty digest forever, even though one
// was generated an hour ago. And letting the manual path pass a different zone
// than the cron would produce two rows both claiming to be "today's digest",
// with nothing to say which one a screen should show.
//
// So the read returns the digest the server actually has, and the row carries
// its own `digest_date` and `timezone` so a screen can say what it covers.

/**
 * What `GET /mail-digests/current` returns.
 *
 * Three facts, because an honest empty state needs all three and a screen that
 * had to guess between them would guess wrong:
 *
 *   `configured`          the server has Gmail OAuth credentials at all.
 *   `has_active_mailbox`  at least one mailbox is connected and active.
 *   `digest`              the most recently generated digest, or null.
 *
 * "No digest yet" means something completely different depending on the first
 * two. Nothing connected is a setup step; connected-but-no-digest is simply
 * waiting for the daily run. Collapsing them into one empty message would tell a
 * user to go set something up that is already set up.
 */
export const MailDigestCurrentResponseSchema = z.object({
  configured: z.boolean(),
  has_active_mailbox: z.boolean(),
  digest: MailDigestRecordSchema.nullable(),
});
export type MailDigestCurrentResponse = z.infer<typeof MailDigestCurrentResponseSchema>;

/**
 * What `POST /mail-digests` returns.
 *
 * GENERATION IS ASYNCHRONOUS AND THIS IS AN ACKNOWLEDGEMENT, NOT A DIGEST.
 * The Daily Brief generates inside the API (ADR-041/043), but the digest
 * pipeline lives in `apps/worker` and the API must never import from it -- the
 * two processes share Postgres and pg-boss, not code (docs/ARCHITECTURE.md). So
 * a manual request enqueues the SAME job the daily cron enqueues.
 *
 * The honest consequence, which a UI must respect: 202 means the work was
 * accepted, never that a digest now exists. Every precondition that CAN be
 * decided synchronously is decided before this is returned, so a failure the
 * user can act on arrives immediately as a 4xx instead of as silence.
 *
 * There is deliberately no `digest_date` here. The API cannot know it: the zone
 * is the worker's configuration, and inventing a date from the API's own clock
 * would be a claim about a row that does not exist yet and may be keyed
 * differently.
 */
export const MailDigestGenerateAcceptedSchema = z.object({
  accepted: z.literal(true),
});
export type MailDigestGenerateAccepted = z.infer<typeof MailDigestGenerateAcceptedSchema>;
