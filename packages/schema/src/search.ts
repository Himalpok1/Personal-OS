// GET /search -- the Personal OS lexical search contract.
//
// Checkpoint 8.3 (ADR-059) froze a four-entity, grouped, recency-ordered
// contract. Checkpoint 9.6 (ADR-065) widens it to six entities, adds
// tokenised matching with an explainable integer score on every result, a
// closed date-token grammar, and an interleaved score order by default. The
// same path serves both; there is no v1/v2 split because every member is
// `.strict()` and the API and the APK ship together under the frozen
// deployment order, so a second allowlist would be kept honest for nobody.
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
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";

export { SEARCH_QUERY_MAX_CHARS, SEARCH_QUERY_MIN_CHARS };
import { EventOriginSchema } from "./events.js";
import { InboxEntityTypeSchema, InboxItemStatusSchema } from "./inbox.js";
import { booleanQueryParam } from "./pagination.js";
import { ProjectStatusSchema } from "./projects.js";
import { TaskStatusSchema } from "./tasks.js";

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------
//
// The search domain is closed at SIX entities. Every exclusion is a decision:
// health measurements, monitor targets/checks/incidents, OAuth state, every
// encrypted credential column, provider tokens and cursors,
// `notification_dispatch_log`, the AI configuration tables and the generated
// brief/digest artifacts. `event` and `project` join in 9.6 because event
// text is now bounded at write (text-bounds.ts) and projects are authorable
// on the device. Adding a seventh is a contract change with its own privacy
// argument.
export const SearchResultTypeSchema = z.enum([
  "task",
  "note",
  "event",
  "project",
  "inbox_item",
  "mail_message",
]);
export type SearchResultType = z.infer<typeof SearchResultTypeSchema>;

/**
 * Grouping order for `order=type`, and the tie-break order between types at
 * equal score and timestamp. User-authored kinds first, then captures, then
 * third-party metadata -- "your own content first" (ADR-059 §2), made numeric
 * by `type_prior` in the scorer.
 */
export const SEARCH_RESULT_TYPE_ORDER = [
  "task",
  "note",
  "event",
  "project",
  "inbox_item",
  "mail_message",
] as const satisfies readonly SearchResultType[];

/** Default per-type cap. */
export const SEARCH_LIMIT_DEFAULT = 20;
/** Largest per-type cap a caller may ask for. */
export const SEARCH_LIMIT_MAX = 50;

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

const CommaSeparatedTypes = z
  .string()
  .transform((value) =>
    value
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0),
  )
  .pipe(z.array(SearchResultTypeSchema).min(1));

/**
 * `limit` IS PER TYPE, NOT PER RESPONSE (ADR-059 §2): with one shared budget
 * the type with the most rows -- mail, growing on a 15-minute cron with two
 * attacker-chosen searchable fields -- would decide what the other five get.
 */
export const SearchQuerySchema = z
  .object({
    q: z
      .string()
      .min(1)
      .max(SEARCH_QUERY_RAW_MAX_CHARS)
      .transform(normalizeSearchQuery)
      .refine((value) => value.length >= SEARCH_QUERY_MIN_CHARS, {
        message: `query must be at least ${SEARCH_QUERY_MIN_CHARS} characters after trimming`,
      })
      .refine((value) => value.length <= SEARCH_QUERY_MAX_CHARS, {
        message: `query must be at most ${SEARCH_QUERY_MAX_CHARS} characters`,
      }),
    limit: z.coerce.number().int().min(1).max(SEARCH_LIMIT_MAX).default(SEARCH_LIMIT_DEFAULT),
    include_archived: booleanQueryParam(false),
    /** Comma-separated subset of result types. Absent = all six. */
    types: CommaSeparatedTypes.optional(),
    /**
     * The client's IANA zone, exactly as `/today` takes it. OPTIONAL and with
     * NO server-side default: without it no date token is recognised (a
     * date-shaped word is plain text) and `date_filter` is null. Guessing a
     * zone is how an all-day event lands on the wrong day.
     */
    tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }).optional(),
    /**
     * `score` (default): one list in `compareScored` order across types.
     * `type`: grouped in SEARCH_RESULT_TYPE_ORDER, score order within a type
     * -- the 8.3 shape, kept for curl readability.
     */
    order: z.enum(["score", "type"]).default("score"),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

// ---------------------------------------------------------------------------
// Match explanation
// ---------------------------------------------------------------------------

/**
 * Which rung of the fallback ladder produced the results.
 *
 *   all               every token matched (text tokens by ILIKE over the
 *                     entity's columns; the date token by window OR text)
 *   all_without_date  rung 1 returned nothing anywhere and the query had a
 *                     date token, which was dropped entirely
 *   any               rungs 1-2 returned nothing anywhere and there were >= 2
 *                     text tokens; OR across tokens ("partial matches")
 *   none              no token survived tokenisation (e.g. "!!"); nothing was
 *                     queried and every count is zero
 */
export const SearchMatchModeSchema = z.enum(["all", "all_without_date", "any", "none"]);
export type SearchMatchMode = z.infer<typeof SearchMatchModeSchema>;

/**
 * The closed vocabulary of scoring reasons. Points per code are fixed in
 * packages/core/src/search/score.ts and recorded in ADR-065; a result's
 * `score` is exactly the sum of its `reasons[].points`, so the ranking is
 * auditable from the response alone.
 */
export const SearchScoreCodeSchema = z.enum([
  "title_exact",
  "title_prefix",
  "title_phrase",
  "title_all_tokens",
  "title_token",
  "secondary_token",
  "body_token",
  "date_window",
  "date_text",
  "recency",
  "type_prior",
  "penalty_done",
  "penalty_archived",
  "penalty_completed_project",
  "penalty_external_event",
]);
export type SearchScoreCode = z.infer<typeof SearchScoreCodeSchema>;

export const SearchScoreReasonSchema = z
  .object({
    code: SearchScoreCodeSchema,
    points: z.number().int(),
    /** The matched token, for the per-token codes. Never a stored string. */
    token: z.string().optional(),
  })
  .strict();
export type SearchScoreReason = z.infer<typeof SearchScoreReasonSchema>;

/** Server-authored field names in which at least one token matched. */
export const SearchMatchFieldSchema = z.enum([
  "title",
  "body",
  "location",
  "description",
  "raw_text",
  "subject",
  "sender",
  "goal",
  "date",
]);
export type SearchMatchField = z.infer<typeof SearchMatchFieldSchema>;

export const SearchMatchSchema = z
  .object({
    reasons: z.array(SearchScoreReasonSchema),
    fields: z.array(SearchMatchFieldSchema),
  })
  .strict();
export type SearchMatch = z.infer<typeof SearchMatchSchema>;

// ---------------------------------------------------------------------------
// Result members
// ---------------------------------------------------------------------------
//
// STRICT, BY DESIGN. Every member is `.strict()` so a column not named here is
// a parse failure rather than a leak. No result carries an href: the client
// derives navigation from `type` + `id` only, so no stored string can become
// a route.

const SearchResultBase = {
  id: z.string().uuid(),
  /** Bounded, control-character-stripped label. Never empty -- see searchTitle. */
  title: z.string().min(1),
  /** Bounded secondary line, or null when there is genuinely nothing to show. */
  preview: z.string().nullable(),
  /** The row's recency instant. Per-type meaning is documented on each member. */
  timestamp: z.string().datetime({ offset: true }),
  /** Integer sum of `match.reasons[].points`. */
  score: z.number().int(),
  match: SearchMatchSchema,
};

export const TaskSearchResultSchema = z
  .object({
    type: z.literal("task"),
    ...SearchResultBase,
    /** timestamp = `updated_at`. */
    status: TaskStatusSchema,
    archived: z.boolean(),
  })
  .strict();
export type TaskSearchResult = z.infer<typeof TaskSearchResultSchema>;

export const NoteSearchResultSchema = z
  .object({
    type: z.literal("note"),
    ...SearchResultBase,
    /** timestamp = `updated_at`. */
    archived: z.boolean(),
  })
  .strict();
export type NoteSearchResult = z.infer<typeof NoteSearchResultSchema>;

/**
 * Event ownership is part of the result (ADR-064). `preview` for an
 * `external` event is the LOCATION ONLY -- the description is matched but
 * never emitted, because it is where third parties put conference links and
 * passcodes. A `local` event previews its location, else its description.
 * No calendar name, no external ids, no `client_uuid`.
 */
export const EventSearchResultSchema = z
  .object({
    type: z.literal("event"),
    ...SearchResultBase,
    /** timestamp = `updated_at`. */
    origin: EventOriginSchema,
    all_day: z.boolean(),
    /** Timed events. */
    starts_at: z.string().datetime({ offset: true }).nullable(),
    /** All-day events -- a pure date, never a midnight instant (ADR-042/045). */
    start_date: z.string().date().nullable(),
    /** `rrule` is set: this row is a series parent. One result per series. */
    is_recurring: z.boolean(),
    /** `parent_event_id` is set: a detached, individually edited instance. */
    is_detached: z.boolean(),
    archived: z.boolean(),
  })
  .strict();
export type EventSearchResult = z.infer<typeof EventSearchResultSchema>;

export const ProjectSearchResultSchema = z
  .object({
    type: z.literal("project"),
    ...SearchResultBase,
    /** title = `name`, preview = `goal`, timestamp = `updated_at`. */
    status: ProjectStatusSchema,
    target_date: z.string().date().nullable(),
    archived: z.boolean(),
  })
  .strict();
export type ProjectSearchResult = z.infer<typeof ProjectSearchResultSchema>;

export const InboxSearchResultSchema = z
  .object({
    type: z.literal("inbox_item"),
    ...SearchResultBase,
    /** timestamp = `captured_at` -- inbox_items has no updated_at column. */
    status: InboxItemStatusSchema,
    entity_type: InboxEntityTypeSchema.nullable(),
    entity_id: z.string().uuid().nullable(),
  })
  .strict();
export type InboxSearchResult = z.infer<typeof InboxSearchResultSchema>;

export const MailSearchResultSchema = z
  .object({
    type: z.literal("mail_message"),
    ...SearchResultBase,
    /** timestamp = `internal_date` -- when the provider says the message arrived. */
    sender: z.string().nullable(),
    has_attachment: z.boolean(),
  })
  .strict();
export type MailSearchResult = z.infer<typeof MailSearchResultSchema>;

export const SearchResultSchema = z.discriminatedUnion("type", [
  TaskSearchResultSchema,
  NoteSearchResultSchema,
  EventSearchResultSchema,
  ProjectSearchResultSchema,
  InboxSearchResultSchema,
  MailSearchResultSchema,
]);
export type SearchResult = z.infer<typeof SearchResultSchema>;

// ---------------------------------------------------------------------------
// Counts and date filter
// ---------------------------------------------------------------------------

/**
 * Per-type counts, with the same honesty invariant `boundedItemsSectionSchema`
 * enforces on Today: a cap may hide rows, but it may never misreport how many
 * there were. `total` counts rows satisfying the candidate predicate on the
 * rung that was taken.
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
    event: SearchTypeCountSchema,
    project: SearchTypeCountSchema,
    inbox_item: SearchTypeCountSchema,
    mail_message: SearchTypeCountSchema,
  })
  .strict();
export type SearchCounts = z.infer<typeof SearchCountsSchema>;

/**
 * The one date token the query carried, and the local-date window it became.
 * `dropped` is true on the `all_without_date` rung. Echoed so the user can
 * read exactly what was applied -- "September" with no year means the
 * CURRENT year in `tz`, and that rule is visible here rather than guessed.
 */
export const SearchDateFilterSchema = z
  .object({
    token: z.string(),
    kind: z.enum(["day", "month", "year", "iso_date", "iso_month"]),
    from: z.string().date(),
    to: z.string().date(),
    tz: z.string(),
    dropped: z.boolean(),
  })
  .strict();
export type SearchDateFilter = z.infer<typeof SearchDateFilterSchema>;

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

/**
 * ORDERING IS PART OF THE CONTRACT, because a search whose result order is
 * incidental is a search the user cannot learn.
 *
 * `order=score`: `score desc`, then `timestamp desc`, then position in
 * SEARCH_RESULT_TYPE_ORDER, then `id asc` -- a total order (two rows with
 * equal timestamps are an observed property of this database, see ADR-059).
 * `order=type`: grouped by SEARCH_RESULT_TYPE_ORDER, the same order within a
 * group. The client never re-sorts; it only partitions.
 */
export const SearchResponseSchema = z
  .object({
    /** The NORMALIZED query that was actually run, echoed for display. */
    query: z.string(),
    /** The text tokens that were matched (lowercased, NFKC), for audit. */
    tokens: z.array(z.string()),
    /**
     * Query words that survived tokenisation but not the token cap, in query
     * order, so the client can say what was ignored. QUERY tokens only --
     * never a stored string.
     */
    dropped: z.array(z.string()),
    /** The per-type cap that was applied. */
    limit: z.number().int().min(1),
    order: z.enum(["score", "type"]),
    match_mode: SearchMatchModeSchema,
    date_filter: SearchDateFilterSchema.nullable(),
    /** True when any type had more matches than its cap allowed through. */
    truncated: z.boolean(),
    counts: SearchCountsSchema,
    results: z.array(SearchResultSchema),
  })
  .strict();
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

// ---------------------------------------------------------------------------
// Item context (Lane F -- the bounded read a future read-only lane may call)
// ---------------------------------------------------------------------------
//
// `getItemContext({type, id})` returns ONE item with a bounded, control-
// stripped body and citations by id. It is a function over `Db` in
// apps/api/src/search/service.ts; no agent runtime calls it (ADR-056). What
// it never carries: mail bodies (none exist), external event descriptions,
// any external id, client_uuid, audio_path, parse_result, confidence, or any
// connection/credential column.

/** Longest body `getItemContext` returns. Equals ASK_BODY_MAX_CHARS deliberately. */
export const ITEM_CONTEXT_BODY_MAX_CHARS = 1500;

export const ItemRefSchema = z
  .object({ type: SearchResultTypeSchema, id: z.string().uuid() })
  .strict();
export type ItemRef = z.infer<typeof ItemRefSchema>;

export const ItemContextSchema = z
  .object({
    type: SearchResultTypeSchema,
    id: z.string().uuid(),
    title: z.string().min(1),
    /** Bounded to ITEM_CONTEXT_BODY_MAX_CHARS; null when the type has no body or it is withheld. */
    body: z.string().nullable(),
    body_truncated: z.boolean(),
    timestamp: z.string().datetime({ offset: true }),
    status: z.string().nullable(),
    archived: z.boolean(),
    origin: EventOriginSchema.nullable(),
    project_id: z.string().uuid().nullable(),
    /** Ids a caller may cite; always includes the item itself. */
    citations: z.array(ItemRefSchema).min(1),
  })
  .strict();
export type ItemContext = z.infer<typeof ItemContextSchema>;
