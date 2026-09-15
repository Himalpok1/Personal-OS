// Cloud Ask -- the wire contract (Checkpoint 8.6B, ADR-056/8.6B design).
//
// Deep import, not the barrel -- matching capture.ts's and search.ts's own
// comment on this: keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package.
import { stripUnsummarizableCharacters } from "@personal-os/core/mail/provider-strings";
import { isValidTimezone } from "@personal-os/core/timezone";
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
export const AskScopeSchema = z.enum(["today", "both"]);
export type AskScope = z.infer<typeof AskScopeSchema>;

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
    // Checkpoint 9.7 ("Ask about today"). Both OPTIONAL and both ADDITIVE:
    // a request without `tz` is the 8.6B request and gets the 8.6B response,
    // byte-shape-identical (task/note sources only, no new fields) -- that is
    // what keeps the versionCode 18 client, whose response schema is
    // `.strict()`, working against a 9.7 server. `tz` is what turns the Today
    // context on: the server never guesses a zone (ADR-065's search rule).
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }).optional(),
    // `today`: the question is about the schedule and NO note/task body is
    // selected or transmitted -- the preset chips send this, so a chip about
    // the day can never ship a journal entry that happens to contain "focus".
    // `both` (the default when `tz` is present): the lexical <records>
    // selection runs as before, beside the Today context.
    scope: AskScopeSchema.optional(),
  })
  .strict()
  // `scope` only means something beside `tz`. A caller sending `scope:
  // "today"` WITHOUT `tz` must not silently get the 8.6B body-selecting path
  // -- the opposite of what the flag asks for -- so it is a validation
  // failure here, client-side (api-client pre-validates) and server-side alike.
  .superRefine((value, ctx) => {
    if (value.scope !== undefined && value.tz === undefined) {
      ctx.addIssue({ code: "custom", path: ["scope"], message: "scope requires tz" });
    }
  });
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
//
// Checkpoint 9.7 widened `type` with `event`, `inbox_item` and `project` and
// added three OPTIONAL fields (`section`, `detail`, `occurs_at`). Both appear ONLY on responses to a request that carried
// `tz` (the 9.7 client); a `tz`-less request never sees them, so the 8.6B
// `.strict()` client parses exactly what it always did.
export const AskSourceTypeSchema = z.enum(["task", "note", "event", "inbox_item", "project"]);
export type AskSourceType = z.infer<typeof AskSourceTypeSchema>;

/**
 * Which part of the Today context a source came from. Rendered beside the
 * citation so a ranking claim ("your only P1", "overdue") can be checked
 * against a SERVER-authored label without opening the item -- the citation
 * check only proves a ref exists, never that the claim about it is true.
 */
export const AskSourceSectionSchema = z.enum([
  "overdue",
  "due_today",
  "upcoming",
  "event",
  "reminder",
  "completed",
  "capture",
  "project",
  "snoozed",
  "record",
]);
export type AskSourceSection = z.infer<typeof AskSourceSectionSchema>;

export const AskSourceSchema = z
  .object({
    ref: z.number().int().min(1),
    type: AskSourceTypeSchema,
    id: z.string().uuid(),
    title: z.string(),
    section: AskSourceSectionSchema.optional(),
    /**
     * Short server-formatted detail for the row (a priority, a wall-clock
     * time, a date) -- never model text, never an id.
     */
    detail: z.string().max(80).optional(),
    /** Event instances only: lets the client open the INSTANCE, as Today does. */
    occurs_at: z.string().datetime({ offset: true }).nullable().optional(),
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
    /**
     * Checkpoint 9.7, present only on `tz` requests. `false` when the answer
     * contains no `[n]` at all -- not refused (an empty day cites nothing),
     * but the client says so rather than presenting an uncheckable answer.
     */
    citations_present: z.boolean().optional(),
  })
  .strict();
export type AskResponse = z.infer<typeof AskResponseSchema>;
