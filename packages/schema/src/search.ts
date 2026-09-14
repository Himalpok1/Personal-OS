// GET /search -- the Personal OS lexical search contract (Checkpoint 8.3).
//
// Deep import, not the barrel -- see capture.ts's comment on this same import
// for why (keeps rrule and a Node-only workaround out of the web bundle
// apps/mobile ships via this package).
import {
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_QUERY_MIN_CHARS,
  SEARCH_QUERY_RAW_MAX_CHARS,
  normalizeSearchQuery,
} from "@personal-os/core/search/query";
import { z } from "zod";

// Re-exported so a client (apps/mobile) can enforce the same minimum before it
// issues a request, without taking a second dependency on packages/core for one
// number. The schema above is still the authority -- this only lets a caller
// avoid a request it knows will 400.
export { SEARCH_QUERY_MAX_CHARS, SEARCH_QUERY_MIN_CHARS };
import { InboxEntityTypeSchema, InboxItemStatusSchema } from "./inbox.js";
import { booleanQueryParam } from "./pagination.js";
import { TaskStatusSchema } from "./tasks.js";

// ===========================================================================
// THE SEARCHABLE DOMAIN IS A CLOSED SET, AND EVERYTHING OUTSIDE IT IS EXCLUDED
// BY CONSTRUCTION RATHER THAN BY THE READ MODEL REMEMBERING TO OMIT IT.
// ===========================================================================
//
// Four entities: the three that hold user-authored text, plus mail metadata.
//
// NOT searchable, and the omissions are decisions rather than an unfinished
// list: health measurements, monitor targets/checks/incidents, OAuth state,
// every encrypted credential column, provider tokens and cursors,
// notification_dispatch_log, the AI configuration tables, and the generated
// brief/digest artifacts. `events` is also absent -- Checkpoint 8.2 put real
// third-party calendar text into that table for the first time, and
// docs/STATUS.md records that event text is still unbounded at write, so adding
// it to a read surface is a scope expansion with its own privacy argument to
// make rather than a fifth line in an array.
export const SearchResultTypeSchema = z.enum(["task", "note", "inbox_item", "mail_message"]);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

/** Default per-type cap. */
export const SEARCH_LIMIT_DEFAULT = 20;
/** Largest per-type cap a caller may ask for. */
export const SEARCH_LIMIT_MAX = 50;

// ===========================================================================
// `limit` IS PER TYPE, NOT PER RESPONSE, AND THAT IS THE SECURITY-RELEVANT BIT
// ===========================================================================
//
// A single shared budget across all four types would mean the type with the
// most rows decides what the other three get. In this system that type is
// `mail_messages` -- hundreds of rows against a handful of tasks and notes, and
// growing on a 15-minute cron -- and its two searchable fields are chosen by
// whoever sent the mail.
//
// ADR-054 already settled this shape for the digest, in almost these words:
// the mail section "is capped hardest, capped before measurement, and is the
// first rung on the drop ladder, or a third party could evict the user's own
// agenda from their own digest." Search has the identical failure mode, so it
// gets the identical answer: each type is capped independently, before any
// merging, so no volume of mail can push a matching note out of a result set.
// The cost is that a response holds at most 4 x limit rows, which is stated
// here rather than discovered.
export const SearchQuerySchema = z
  .object({
    q: z
      .string()
      .min(1)
      .max(SEARCH_QUERY_RAW_MAX_CHARS)
      // Normalize BEFORE the length checks, so the bounds apply to the string
      // that will actually be matched. Checking the raw value first would let
      // "  a  " pass a >= 2 test and then reach SQL as the single character
      // "a".
      .transform(normalizeSearchQuery)
      .refine((value) => value.length >= SEARCH_QUERY_MIN_CHARS, {
        message: `query must be at least ${SEARCH_QUERY_MIN_CHARS} characters after trimming`,
      })
      .refine((value) => value.length <= SEARCH_QUERY_MAX_CHARS, {
        message: `query must be at most ${SEARCH_QUERY_MAX_CHARS} characters`,
      }),
    limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
    // booleanQueryParam, never z.coerce.boolean() -- see pagination.ts's
    // comment on why the latter is silently broken for "?flag=false".
    //
    // Applies to the two entities whose result member carries an `archived`
    // flag (tasks, notes). It deliberately does NOT reach mail:
    // `mail_messages.deleted_at` is a provider-reconciliation tombstone, not a
    // user action, and a message the provider no longer returns is not
    // something the user archived. Nor does it reach inbox items (Checkpoint
    // 9.3): a dismissed capture is excluded unconditionally because the
    // inbox_item member has no `archived` flag to label it with.
    include_archived: booleanQueryParam(false),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ===========================================================================
// THE RESULT UNION
// ===========================================================================
//
// Every member is `.strict()`, which is the actual allowlist mechanism rather
// than a stylistic choice: the read model builds a plain object and parses it
// through these schemas, so a column that is not named here is STRUCTURALLY
// INCAPABLE of reaching the wire -- a stray field is a parse failure, not a
// leak. Same guarantee `apps/api/src/routes/mail-connections.ts` documents for
// its ciphertext columns.
//
// NO NAVIGATION URL IS RETURNED. The client derives a route from `type` and
// `id`, both of which are server-authored. A server-supplied href would be one
// more string a result carries, and the one thing a search result must never do
// is let attacker-authored text decide where a tap goes.

const SearchResultBase = {
  id: z.string().uuid(),
  /** Bounded, control-character-stripped label. Never empty -- see searchTitle. */
  title: z.string().min(1),
  /** Bounded secondary line, or null when there is genuinely nothing to show. */
  preview: z.string().nullable(),
  /** The row's recency instant. Per-type meaning is documented on each member. */
  timestamp: z.string().datetime({ offset: true }),
};

export const TaskSearchResultSchema = z
  .object({
    type: z.literal("task"),
    ...SearchResultBase,
    /** `updated_at`. */
    status: TaskStatusSchema,
    archived: z.boolean(),
  })
  .strict();
export type TaskSearchResult = z.infer<typeof TaskSearchResultSchema>;

export const NoteSearchResultSchema = z
  .object({
    type: z.literal("note"),
    ...SearchResultBase,
    /** `updated_at`. */
    archived: z.boolean(),
  })
  .strict();
export type NoteSearchResult = z.infer<typeof NoteSearchResultSchema>;

export const InboxSearchResultSchema = z
  .object({
    type: z.literal("inbox_item"),
    ...SearchResultBase,
    /** `captured_at` -- inbox_items has no updated_at column. */
    status: InboxItemStatusSchema,
    // Present when the capture was committed to an entity. The client uses the
    // PAIR to navigate to that entity; there is no inbox-item detail screen, so
    // without it an inbox result can only return the user to the Inbox tab.
    // Both fields are server-authored, which is what makes them safe to route
    // on.
    entity_type: InboxEntityTypeSchema.nullable(),
    entity_id: z.string().uuid().nullable(),
  })
  .strict();
export type InboxSearchResult = z.infer<typeof InboxSearchResultSchema>;

// METADATA ONLY, and the schema is where that is enforced rather than merely
// intended. There is no body field because `mail_messages` has no body column
// and, under the `gmail.metadata` scope, a body is unfetchable (ADR-053).
//
// `from_address` and `from_domain` are deliberately ABSENT. They are stored, but
// an address is an identifier the user did not ask for when they typed a search
// term, and ADR-054's rule that no address may reach a log or a push body is a
// statement about how little value it carries against how much it discloses.
// `sender` carries the display name alone -- attacker-authored, bounded, and
// rendered as inert text.
export const MailSearchResultSchema = z
  .object({
    type: z.literal("mail_message"),
    ...SearchResultBase,
    /** `internal_date` -- when the provider says the message arrived. */
    sender: z.string().nullable(),
    has_attachment: z.boolean(),
  })
  .strict();
export type MailSearchResult = z.infer<typeof MailSearchResultSchema>;

export const SearchResultSchema = z.discriminatedUnion("type", [
  TaskSearchResultSchema,
  NoteSearchResultSchema,
  InboxSearchResultSchema,
  MailSearchResultSchema,
]);
export type SearchResult = z.infer<typeof SearchResultSchema>;

/**
 * Per-type counts, with the same honesty invariant `boundedItemsSectionSchema`
 * enforces on Today: a cap may hide rows, but it may never misreport how many
 * there were.
 */
export const SearchTypeCountSchema = z
  .object({
    returned: z.number().int().min(0),
    total: z.number().int().min(0),
  })
  .strict()
  .refine((counts) => counts.total >= counts.returned, {
    message: "total must not be smaller than the returned count",
  });
export type SearchTypeCount = z.infer<typeof SearchTypeCountSchema>;

export const SearchCountsSchema = z
  .object({
    task: SearchTypeCountSchema,
    note: SearchTypeCountSchema,
    inbox_item: SearchTypeCountSchema,
    mail_message: SearchTypeCountSchema,
  })
  .strict();
export type SearchCounts = z.infer<typeof SearchCountsSchema>;

/**
 * ORDERING IS PART OF THE CONTRACT, because a search whose result order is
 * incidental is a search the user cannot learn.
 *
 * Results arrive grouped by type in the fixed order of
 * `SEARCH_RESULT_TYPE_ORDER`, and within a type by recency descending with `id`
 * ascending as the final tie-break. The type order is not alphabetical: it puts
 * the three user-authored kinds ahead of mail, which is the same "your own
 * content first" principle the per-type cap enforces, made visible.
 *
 * `id` breaks ties because two rows CAN share a timestamp -- Checkpoint 8.2
 * ingested 98 calendar events that all shared one `created_at` to the
 * microsecond, so this is an observed property of this database rather than a
 * theoretical one. Without it, two rows with equal timestamps could swap places
 * between identical requests.
 */
export const SEARCH_RESULT_TYPE_ORDER = ["task", "note", "inbox_item", "mail_message"] as const;

export const SearchResponseSchema = z
  .object({
    /** The NORMALIZED query that was actually run, echoed for display. */
    query: z.string(),
    /** The per-type cap that was applied. */
    limit: z.number().int().min(1),
    /** True when any type had more matches than its cap allowed through. */
    truncated: z.boolean(),
    counts: SearchCountsSchema,
    results: z.array(SearchResultSchema),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;
