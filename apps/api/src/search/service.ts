import { localDayWindow } from "@personal-os/core";
import {
  stripUnsummarizableCharacters,
  truncateProviderString,
} from "@personal-os/core/mail/provider-strings";
import {
  SEARCH_SENDER_MAX_CHARS,
  searchPreview,
  searchTitle,
} from "@personal-os/core/search/preview";
import { buildContainsPattern } from "@personal-os/core/search/query";
import {
  compareScored,
  normalizeForMatch,
  scoreCandidate,
  type ScoreInput,
  type ScoredCandidate,
} from "@personal-os/core/search/score";
import {
  textTokenValues,
  tokenizeSearchQuery,
  type TokenizedQuery,
} from "@personal-os/core/search/tokenize";
import type { Db } from "@personal-os/db";
import {
  ITEM_CONTEXT_BODY_MAX_CHARS,
  ItemContextSchema,
  SEARCH_LIMIT_MAX,
  SEARCH_QUERY_MAX_CHARS,
  SEARCH_RESULT_TYPE_ORDER,
  SearchResponseSchema,
  type ItemContext,
  type ItemRef,
  type SearchCounts,
  type SearchDateFilter,
  type SearchMatchMode,
  type SearchResponse,
  type SearchResult,
  type SearchResultType,
} from "@personal-os/schema";
import {
  loadItemContextRow,
  resolveSearchDateWindow,
  searchEventCandidates,
  searchInboxCandidates,
  searchMailCandidates,
  searchNoteCandidates,
  searchProjectCandidates,
  searchTaskCandidates,
  type EventCandidate,
  type InboxCandidate,
  type MailCandidate,
  type NoteCandidate,
  type ProjectCandidate,
  type SearchDateWindow,
  type SearchPredicate,
  type TaskCandidate,
} from "../read-models/search.js";

// The search SERVICE (Checkpoint 9.6, ADR-065): tokenise, run the matching
// ladder against the read model's candidate queries, score in TypeScript,
// rank, cap per type, and assemble the frozen response.
//
// ===========================================================================
// THE LADDER
// ===========================================================================
//
//   rung 1  "all"               every token must match (AND). A text token is
//                               an ILIKE over the entity's columns; the date
//                               token is its window predicate OR its text.
//   rung 2  "all_without_date"  taken ONLY when rung 1 returned nothing in ANY
//                               type and the query had a date token: the date
//                               token is dropped entirely. "may" is a month
//                               and also a verb; the ladder is what makes that
//                               cheap.
//   rung 3  "any"               taken ONLY when rungs 1-2 returned nothing and
//                               there are at least two text tokens: OR across
//                               tokens, which the client labels "partial
//                               matches". One token has nothing to relax.
//   "none"                      no token survived tokenisation. No SQL runs.
//
// Deterministic: the same request yields the same rung, the same candidates
// (the read model's ORDER BY is total) and the same ranking (compareScored is
// total), so two identical requests are byte-identical.
//
// ===========================================================================
// WHY RANKING IS IN TYPESCRIPT
// ===========================================================================
//
// The read model returns up to SEARCH_CANDIDATE_CAP rows per type with
// `title_all` and `date_hit` computed in SQL; everything else the scorer
// needs is a string operation over text this process already holds. Scoring
// here keeps the SQL to one readable predicate per type, lets
// packages/core/src/search/score.ts stay pure and unit-tested without a
// database, and -- because `score` is exactly the sum of `reasons[].points`
// -- makes every ranking auditable from the response alone.
//
// Nothing here logs. The route emits the one counts-only line.

export interface SearchServiceInput {
  /** The NORMALIZED query (SearchQuerySchema has already run). */
  q: string;
  /** Subset of types to search; absent means all six. */
  types?: readonly SearchResultType[] | undefined;
  /** Per-type cap. */
  limit: number;
  /** The caller's IANA zone, or null -- without it no date token is recognised. */
  tz: string | null;
  includeArchived: boolean;
  order: "score" | "type";
  /** Injected clock for the recency ladder and "today"; defaults to now. */
  now?: Date;
}

const ALL_TYPES: readonly SearchResultType[] = SEARCH_RESULT_TYPE_ORDER;

const EMPTY_COUNT = { returned: 0, total: 0 } as const;

const ZERO_COUNTS: SearchCounts = {
  task: EMPTY_COUNT,
  note: EMPTY_COUNT,
  event: EMPTY_COUNT,
  project: EMPTY_COUNT,
  inbox_item: EMPTY_COUNT,
  mail_message: EMPTY_COUNT,
};

/** A scored result before it is serialized: the wire member plus the Date the comparator sorts on. */
interface RankedResult {
  result: SearchResult;
  timestamp: Date;
}

interface TypeSlice {
  ranked: RankedResult[];
  total: number;
}

type Candidates = {
  task: TaskCandidate[];
  note: NoteCandidate[];
  event: EventCandidate[];
  project: ProjectCandidate[];
  inbox_item: InboxCandidate[];
  mail_message: MailCandidate[];
};

const EMPTY_CANDIDATES: Candidates = {
  task: [],
  note: [],
  event: [],
  project: [],
  inbox_item: [],
  mail_message: [],
};

async function fetchCandidates(
  db: Db,
  types: readonly SearchResultType[],
  predicate: SearchPredicate,
  includeArchived: boolean,
): Promise<Candidates> {
  const wanted = new Set(types);
  const options = { predicate, includeArchived };
  // The six run CONCURRENTLY and are capped INDEPENDENTLY, which together are
  // what stop a large mail table from deciding how many notes the user gets
  // back (see SearchQuerySchema's note on the per-type cap).
  const [task, note, event, project, inboxItem, mailMessage] = await Promise.all([
    wanted.has("task") ? searchTaskCandidates(db, options) : [],
    wanted.has("note") ? searchNoteCandidates(db, options) : [],
    wanted.has("event") ? searchEventCandidates(db, options) : [],
    wanted.has("project") ? searchProjectCandidates(db, options) : [],
    wanted.has("inbox_item") ? searchInboxCandidates(db, options) : [],
    wanted.has("mail_message") ? searchMailCandidates(db, options) : [],
  ]);
  return { task, note, event, project, inbox_item: inboxItem, mail_message: mailMessage };
}

function isEmpty(candidates: Candidates): boolean {
  return Object.values(candidates).every((rows) => rows.length === 0);
}

/**
 * Whether the date token's TEXT occurs in any of the columns the scorer is
 * handed. SQL tested `window OR text` as one predicate; splitting the text
 * half back out here (over the same normalization the scorer uses) is what
 * lets `date_text` be awarded independently of `date_window`.
 *
 * `dateApplied` is false on rungs 2 and 3, where the date token was DROPPED
 * from the predicate: a token the query no longer contains must not earn
 * points, or a row surviving only because the date was ignored would be
 * ranked as if it had matched it (Checkpoint 9.6 review).
 */
function dateTextHit(
  query: TokenizedQuery,
  dateApplied: boolean,
  columns: readonly (string | null)[],
): boolean {
  if (!dateApplied || query.dateToken === null) return false;
  const value = query.dateToken.value;
  return columns.some((column) => column !== null && normalizeForMatch(column).includes(value));
}

// ---------------------------------------------------------------------------
// Per-type scoring and result assembly
// ---------------------------------------------------------------------------
//
// Each function maps a candidate to (a) the scorer's input and (b) the strict
// wire member. What a member carries is decided by the schema; what the scorer
// SEES can be wider -- an external event's description is scored (the user
// remembers the agenda) and never emitted (it is where the passcode is).

/** What every per-type slice needs beyond its rows. */
interface Scoring {
  query: TokenizedQuery;
  now: Date;
  limit: number;
  /** False once the ladder dropped the date token (rungs 2 and 3). */
  dateApplied: boolean;
}

function scoreAndRank<C extends { id: string; total: number }>(
  candidates: readonly C[],
  { query, now, limit }: Scoring,
  toInput: (candidate: C) => ScoreInput,
  toResult: (candidate: C, scored: ScoredCandidate) => RankedResult,
): TypeSlice {
  const ranked = candidates
    .map((candidate) => toResult(candidate, scoreCandidate(toInput(candidate), query, now)))
    .sort((a, b) =>
      compareScored(
        { score: a.result.score, timestamp: a.timestamp, type: a.result.type, id: a.result.id },
        { score: b.result.score, timestamp: b.timestamp, type: b.result.type, id: b.result.id },
      ),
    )
    .slice(0, limit);
  return { ranked, total: candidates[0]?.total ?? 0 };
}

function taskSlice(rows: TaskCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "task",
      id: row.id,
      title: row.title,
      secondary: [],
      body: row.body,
      timestamp: row.updatedAt,
      fieldNames: { title: "title", body: "body" },
      flags: {
        archived: row.archivedAt !== null,
        done: row.status === "done" || row.status === "dropped",
        completedProject: false,
        externalEvent: false,
      },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [row.title, row.body]),
    }),
    (row, scored) => ({
      timestamp: row.updatedAt,
      result: {
        type: "task",
        id: row.id,
        title: searchTitle(row.title, "(untitled task)"),
        preview: searchPreview(row.body),
        timestamp: row.updatedAt.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        status: row.status as Extract<SearchResult, { type: "task" }>["status"],
        archived: row.archivedAt !== null,
      },
    }),
  );
}

function noteSlice(rows: NoteCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "note",
      id: row.id,
      title: row.title,
      secondary: [],
      body: row.body,
      timestamp: row.updatedAt,
      fieldNames: { title: "title", body: "body" },
      flags: {
        archived: row.archivedAt !== null,
        done: false,
        completedProject: false,
        externalEvent: false,
      },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [row.title, row.body]),
    }),
    (row, scored) => ({
      timestamp: row.updatedAt,
      result: {
        type: "note",
        id: row.id,
        title: searchTitle(row.title, "(untitled note)"),
        preview: searchPreview(row.body),
        timestamp: row.updatedAt.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        archived: row.archivedAt !== null,
      },
    }),
  );
}

function eventSlice(rows: EventCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "event",
      id: row.id,
      title: row.title,
      secondary: row.location === null ? [] : [row.location],
      // Scored for BOTH origins: matching the description is what finds the
      // meeting the user remembers by its agenda. Emitting it is a separate
      // decision, made below.
      body: row.description,
      timestamp: row.updatedAt,
      fieldNames: { title: "title", secondary: "location", body: "description" },
      flags: {
        archived: row.archivedAt !== null,
        done: false,
        completedProject: false,
        externalEvent: row.origin === "external",
      },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [
        row.title,
        row.location,
        row.description,
      ]),
    }),
    (row, scored) => ({
      timestamp: row.updatedAt,
      result: {
        type: "event",
        id: row.id,
        title: searchTitle(row.title, "(untitled event)"),
        // ADR-064/065: an EXTERNAL event previews its location ONLY. The
        // description is third-party text -- conference links, passcodes --
        // and never leaves the row through this surface. A LOCAL event is the
        // owner's own text: location, else description.
        preview:
          row.origin === "external"
            ? searchPreview(row.location)
            : (searchPreview(row.location) ?? searchPreview(row.description)),
        timestamp: row.updatedAt.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        origin: row.origin === "local" ? "local" : "external",
        all_day: row.allDay,
        starts_at: row.startsAt === null ? null : row.startsAt.toISOString(),
        start_date: row.startDate,
        is_recurring: row.rrule !== null,
        is_detached: row.parentEventId !== null,
        archived: row.archivedAt !== null,
      },
    }),
  );
}

function projectSlice(rows: ProjectCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "project",
      id: row.id,
      title: row.name,
      secondary: [],
      body: row.goal,
      timestamp: row.updatedAt,
      fieldNames: { title: "title", body: "goal" },
      flags: {
        archived: row.archivedAt !== null,
        done: false,
        completedProject: row.status === "completed",
        externalEvent: false,
      },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [row.name, row.goal]),
    }),
    (row, scored) => ({
      timestamp: row.updatedAt,
      result: {
        type: "project",
        id: row.id,
        title: searchTitle(row.name, "(untitled project)"),
        preview: searchPreview(row.goal),
        timestamp: row.updatedAt.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        status: row.status as Extract<SearchResult, { type: "project" }>["status"],
        target_date: row.targetDate,
        archived: row.archivedAt !== null,
      },
    }),
  );
}

function inboxSlice(rows: InboxCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "inbox_item",
      id: row.id,
      // The capture text IS the title -- there is no separate title column.
      title: row.rawText ?? "",
      secondary: [],
      body: null,
      timestamp: row.capturedAt,
      fieldNames: { title: "raw_text" },
      flags: { archived: false, done: false, completedProject: false, externalEvent: false },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [row.rawText]),
    }),
    (row, scored) => ({
      timestamp: row.capturedAt,
      result: {
        type: "inbox_item",
        id: row.id,
        title: searchTitle(row.rawText, "(no transcript)"),
        // `preview` stays null rather than repeating a prefix of the same string.
        preview: null,
        timestamp: row.capturedAt.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        status: row.status as Extract<SearchResult, { type: "inbox_item" }>["status"],
        entity_type: row.entityType as Extract<SearchResult, { type: "inbox_item" }>["entity_type"],
        entity_id: row.entityId,
      },
    }),
  );
}

function mailSlice(rows: MailCandidate[], scoring: Scoring) {
  return scoreAndRank(
    rows,
    scoring,
    (row) => ({
      type: "mail_message",
      id: row.id,
      title: row.subject ?? "",
      secondary: row.fromDisplayName === null ? [] : [row.fromDisplayName],
      body: null,
      timestamp: row.internalDate,
      fieldNames: { title: "subject", secondary: "sender" },
      flags: { archived: false, done: false, completedProject: false, externalEvent: false },
      dateWindowHit: row.dateHit,
      dateTextHit: dateTextHit(scoring.query, scoring.dateApplied, [
        row.subject,
        row.fromDisplayName,
      ]),
    }),
    (row, scored) => ({
      timestamp: row.internalDate,
      result: {
        type: "mail_message",
        id: row.id,
        title: searchTitle(row.subject, "(no subject)"),
        preview: null,
        timestamp: row.internalDate.toISOString(),
        score: scored.score,
        match: { reasons: scored.reasons, fields: scored.fields },
        // Display name only. `from_address` and `from_domain` are stored but
        // never selected by the read model -- see MailSearchResultSchema.
        sender: searchPreview(row.fromDisplayName, SEARCH_SENDER_MAX_CHARS),
        has_attachment: row.hasAttachment,
      },
    }),
  );
}

// ---------------------------------------------------------------------------
// searchPersonalItems
// ---------------------------------------------------------------------------

export async function searchPersonalItems(
  db: Db,
  input: SearchServiceInput,
): Promise<SearchResponse> {
  // The route has already run SearchQuerySchema; these guards exist for every
  // OTHER caller (a test, a future lane) so the read model's bounds cannot be
  // bypassed by skipping the schema. A plain RangeError, not a ZodError: this
  // is a programming error at a call site, never user input to explain.
  if (input.q.length > SEARCH_QUERY_MAX_CHARS) {
    throw new RangeError(`search query exceeds ${SEARCH_QUERY_MAX_CHARS} characters`);
  }
  if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > SEARCH_LIMIT_MAX) {
    throw new RangeError(`search limit must be an integer between 1 and ${SEARCH_LIMIT_MAX}`);
  }

  const now = input.now ?? new Date();
  // An EMPTY `types` means "no restriction", the same as an absent one: the
  // schema's csv form cannot express an empty list, so nothing legitimately
  // asks for zero types.
  const types = input.types === undefined || input.types.length === 0 ? ALL_TYPES : input.types;
  const tz = input.tz;

  // "today" for the relative and bare-month date forms is the caller's LOCAL
  // date, derived the way Today derives it -- never a UTC slice of `now`.
  const query = tokenizeSearchQuery(input.q, {
    tz,
    today: tz === null ? null : localDayWindow(tz, now).localDate,
  });
  const textPatterns = textTokenValues(query).map(buildContainsPattern);

  const base = {
    query: input.q,
    tokens: textTokenValues(query),
    // What the tokeniser recognised but could not fit under SEARCH_MAX_TOKENS,
    // echoed so the client can say which words were ignored rather than
    // silently matching a shorter query than the one typed.
    dropped: query.dropped,
    limit: input.limit,
    order: input.order,
  };

  if (query.tokens.length === 0) {
    // "!!" or an emoji: nothing to match, so nothing is queried and every
    // count is honestly zero rather than the newest N rows of everything.
    return SearchResponseSchema.parse({
      ...base,
      match_mode: "none",
      date_filter: null,
      truncated: false,
      counts: ZERO_COUNTS,
      results: [],
    } satisfies SearchResponse);
  }

  let dateWindow: SearchDateWindow | null = null;
  let dateFilter: SearchDateFilter | null = null;
  if (query.dateToken !== null && query.dateToken.kind === "date" && tz !== null) {
    const { window } = query.dateToken;
    dateWindow = resolveSearchDateWindow({
      tz,
      from: window.from,
      to: window.to,
      tokenText: query.dateToken.value,
    });
    dateFilter = {
      token: window.token,
      kind: window.kind,
      from: window.from,
      to: window.to,
      tz,
      dropped: false,
    };
  }

  // Rung 1.
  let matchMode: SearchMatchMode = "all";
  let candidates = await fetchCandidates(
    db,
    types,
    { textPatterns, mode: "all", date: dateWindow },
    input.includeArchived,
  );

  // Rung 2: drop the date token entirely.
  if (isEmpty(candidates) && dateWindow !== null && dateFilter !== null) {
    matchMode = "all_without_date";
    dateFilter = { ...dateFilter, dropped: true };
    candidates =
      textPatterns.length === 0
        ? EMPTY_CANDIDATES
        : await fetchCandidates(
            db,
            types,
            { textPatterns, mode: "all", date: null },
            input.includeArchived,
          );
  }

  // Rung 3: any token.
  if (isEmpty(candidates) && textPatterns.length >= 2) {
    matchMode = "any";
    candidates = await fetchCandidates(
      db,
      types,
      { textPatterns, mode: "any", date: null },
      input.includeArchived,
    );
  }

  // Only rung 1 applied the date token; on rungs 2 and 3 it earns nothing.
  const scoring: Scoring = { query, now, limit: input.limit, dateApplied: matchMode === "all" };
  const slices: Record<SearchResultType, TypeSlice> = {
    task: taskSlice(candidates.task, scoring),
    note: noteSlice(candidates.note, scoring),
    event: eventSlice(candidates.event, scoring),
    project: projectSlice(candidates.project, scoring),
    inbox_item: inboxSlice(candidates.inbox_item, scoring),
    mail_message: mailSlice(candidates.mail_message, scoring),
  };

  const counts: SearchCounts = {
    task: { returned: slices.task.ranked.length, total: slices.task.total },
    note: { returned: slices.note.ranked.length, total: slices.note.total },
    event: { returned: slices.event.ranked.length, total: slices.event.total },
    project: { returned: slices.project.ranked.length, total: slices.project.total },
    inbox_item: { returned: slices.inbox_item.ranked.length, total: slices.inbox_item.total },
    mail_message: { returned: slices.mail_message.ranked.length, total: slices.mail_message.total },
  };

  // `order=type`: concatenate in SEARCH_RESULT_TYPE_ORDER, each group already
  // in comparator order. `order=score`: one comparator over everything -- the
  // same comparator, so a group's internal order is identical either way.
  const grouped = SEARCH_RESULT_TYPE_ORDER.flatMap((type) => slices[type].ranked);
  const ordered =
    input.order === "type"
      ? grouped
      : [...grouped].sort((a, b) =>
          compareScored(
            { score: a.result.score, timestamp: a.timestamp, type: a.result.type, id: a.result.id },
            { score: b.result.score, timestamp: b.timestamp, type: b.result.type, id: b.result.id },
          ),
        );

  return SearchResponseSchema.parse({
    ...base,
    match_mode: matchMode,
    date_filter: dateFilter,
    truncated: Object.values(counts).some((count) => count.total > count.returned),
    counts,
    results: ordered.map((entry) => entry.result),
  } satisfies SearchResponse);
}

// ---------------------------------------------------------------------------
// getItemContext
// ---------------------------------------------------------------------------

const CONTEXT_TITLE_FALLBACK: Readonly<Record<SearchResultType, string>> = {
  task: "(untitled task)",
  note: "(untitled note)",
  event: "(untitled event)",
  project: "(untitled project)",
  inbox_item: "(no transcript)",
  mail_message: "(no subject)",
};

/**
 * ONE item, with a bounded body, for a caller that already holds its ref.
 *
 * The body is control-stripped FIRST and then hard-cut to
 * ITEM_CONTEXT_BODY_MAX_CHARS (surrogate-safe) -- the Checkpoint 8.1 ordering,
 * so invisible codepoints cannot spend the budget. `body_truncated` says
 * whether the cut lost anything. What is never here, by construction rather
 * than by filtering: an external event's description (the read model returns
 * null for it), a mail body (none exists under gmail.metadata), and every
 * identifier column the strict schema does not name.
 *
 * `citations` is the item itself: the one id a caller may cite for this
 * context. No agent runtime calls this (ADR-056); it is the bounded read a
 * future read-only lane would be given instead of table access.
 */
export async function getItemContext(
  db: Db,
  ref: ItemRef,
  options: { includeBody: boolean },
): Promise<ItemContext | null> {
  const row = await loadItemContextRow(db, ref.type, ref.id);
  if (row === null) return null;

  let body: string | null = null;
  let bodyTruncated = false;
  if (options.includeBody) {
    const stripped = stripUnsummarizableCharacters(row.body);
    if (stripped !== null && stripped !== "") {
      body = truncateProviderString(stripped, ITEM_CONTEXT_BODY_MAX_CHARS);
      bodyTruncated = body !== null && body.length < stripped.length;
    }
  }

  return ItemContextSchema.parse({
    type: row.type,
    id: row.id,
    title: searchTitle(row.title, CONTEXT_TITLE_FALLBACK[row.type]),
    body,
    body_truncated: bodyTruncated,
    timestamp: row.timestamp.toISOString(),
    status: row.status,
    archived: row.archived,
    origin: row.origin,
    project_id: row.projectId,
    citations: [{ type: row.type, id: row.id }],
  } satisfies ItemContext);
}
