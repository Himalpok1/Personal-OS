// Cloud Ask -- the wire contract (Checkpoint 8.6B, ADR-056/8.6B design).
//
// Deep import, not the barrel -- matching capture.ts's and search.ts's own
// comment on this: keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import { z } from "zod";

/** Shortest accepted question, AFTER control-character stripping. */
export const ASK_QUESTION_MIN_CHARS = 3;
/** Longest accepted question, AFTER control-character stripping. */
export const ASK_QUESTION_MAX_CHARS = 512;
/**
 * Ceiling on the RAW question, before stripping. Generous versus the
 * post-strip bound for the same reason SEARCH_QUERY_RAW_MAX_CHARS is: this
 * only exists so an absurd body is rejected before any per-character work.
 */
const ASK_QUESTION_RAW_MAX_CHARS = 2000;

// ===========================================================================
// THE REQUEST -- BODY ONLY, NEVER THE QUERY STRING
// ===========================================================================
//
// `POST /ask` reads the question from the JSON body exclusively. A `?q=`
// alongside it is ignored by the route (tested there), which closes the
// malformed-caller shape the 8.6B design's adversarial review named directly:
// a question in the query string, or an oversized body.
export const AskRequestSchema = z
  .object({
    question: z
      .string()
      .min(1)
      .max(ASK_QUESTION_RAW_MAX_CHARS)
      // Control-strip BEFORE the length checks (the Checkpoint 8.1 ordering),
      // so the bounds apply to the string that is actually used, and so an
      // adversarial question cannot spend its raw budget on invisible
      // codepoints and arrive looking too short.
      .transform((value) => stripUnsummarizableCharacters(value) ?? "")
      .refine((value) => value.length >= ASK_QUESTION_MIN_CHARS, {
        message: `question must be at least ${ASK_QUESTION_MIN_CHARS} characters after trimming`,
      })
      .refine((value) => value.length <= ASK_QUESTION_MAX_CHARS, {
        message: `question must be at most ${ASK_QUESTION_MAX_CHARS} characters`,
      }),
  })
  .strict();
export type AskRequest = z.infer<typeof AskRequestSchema>;

// ===========================================================================
// THE RESPONSE -- NO BODY TEXT ECHOED BACK EXCEPT THE MODEL'S OWN ANSWER
// ===========================================================================
//
// `sources` carries only what the client needs to navigate: a per-request
// ordinal, the entity type, the entity's own uuid (server-authored, safe to
// route on -- unlike anything derived from the model's text), and its title.
// No body, no snippet, no score. The model was never given the ids either
// (see apps/api/src/ask/prompt.ts) -- they are attached here, server-side,
// from the same selection the prompt was built from.
export const AskSourceTypeSchema = z.enum(["task", "note"]);
export type AskSourceType = z.infer<typeof AskSourceTypeSchema>;

export const AskSourceSchema = z
  .object({
    ref: z.number().int().min(1),
    type: AskSourceTypeSchema,
    id: z.string().uuid(),
    title: z.string(),
  })
  .strict();
export type AskSource = z.infer<typeof AskSourceSchema>;

export const AskResponseSchema = z
  .object({
    answer: z.string(),
    sources: z.array(AskSourceSchema),
    /** How many secret-shaped strings were removed from the context before it was sent. */
    redactions: z.number().int().min(0),
    /** The `ai_models.id` that actually served the call. */
    model_id: z.string().uuid().nullable(),
  })
  .strict();
export type AskResponse = z.infer<typeof AskResponseSchema>;
