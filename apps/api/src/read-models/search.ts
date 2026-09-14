import { localDayWindowForDate } from "@personal-os/core";
import { LIKE_ESCAPE_CHARACTER, buildContainsPattern } from "@personal-os/core/search/query";
import {
  events,
  inboxItems,
  mailMessages,
  notes,
  occurrences,
  projects,
  tasks,
  type Db,
} from "@personal-os/db";
import type { SearchResultType } from "@personal-os/schema";
import { and, asc, desc, eq, isNull, sql, type Column, type SQL } from "drizzle-orm";

// Candidate queries for lexical search across the six searchable entities
// (Checkpoint 8.3, widened and tokenised by Checkpoint 9.6 / ADR-065).
//
// This module is the ONLY place search text reaches SQL. It returns CANDIDATE
// rows -- everything the predicate matches, capped at SEARCH_CANDIDATE_CAP --
// and the service (apps/api/src/search/service.ts) scores and ranks them in
// TypeScript. The split is deliberate: the WHERE clause decides which rows are
// candidates at all, and that is the whole of what user-derived text does to a
// query; ranking is a plain string operation over data this process already
// holds, so it lives where it can be unit-tested without a database and
// audited from the response alone.
//
// ===========================================================================
// WHY THERE IS NO INDEX, AND WHY THAT IS NOT AN OVERSIGHT
// ===========================================================================
//
// ADR-056 settles it: "Search in Phase 8 is therefore query-time and
// index-free." Three independent reasons stack up behind that, and any one of
// them alone would be enough:
//
//   1. SIZE. Production holds single-digit rows in tasks, notes, projects and
//      inbox_items, ~100 events and a few hundred mail_messages. A sequential
//      scan over that is faster than the round trip that carries it.
//   2. THE TOOLING FORBIDS IT. packages/db/scripts/reconcile-drizzle-tracking.ts
//      aborts on any index method other than btree, and on any index column
//      that is not a bare identifier. A GIN index, a trigram index and an
//      expression index on lower(title) each fail -- by the SAME code path that
//      would reject an HNSW vector index. There is no migration that adds one
//      and still reconciles.
//   3. THE ROLE FORBIDS THE EXTENSION. `posops_app` holds USAGE, not CREATE, on
//      `public`, so CREATE EXTENSION pg_trgm is not available to the
//      application at all.
//
// If the corpus ever grows enough for this to matter, the honest fix is an
// infrastructure ADR, not a quietly-added index. (Measured at 9.6 on a clone
// seeded with 5,000 rows per type -- roughly fifty times production: one
// token p95 ~40 ms, three tokens plus a date window ~63 ms, eight tokens
// ~110 ms.)
//
// ===========================================================================
// HOW USER INPUT REACHES SQL
// ===========================================================================
//
// The query is normalized and length-bounded by SearchQuerySchema, tokenised
// by packages/core/src/search/tokenize.ts, and each token is turned into a
// pattern by `buildContainsPattern`, which escapes `\`, `%` and `_`. That
// pattern is passed as a BOUND PARAMETER, and so is the escape character --
// `ilike $1 escape $2`, verified against this project's PostgreSQL 17 rather
// than assumed. Naming the escape character explicitly means this code does
// not depend on a server default that a reader would otherwise have to know.
//
// No fragment of the user's text is ever concatenated into SQL text. There is
// no `sql.raw` here, and there is none anywhere in this repository.
//
// ===========================================================================
// ONE STATEMENT PER TYPE
// ===========================================================================
//
// Each candidate query is a single SELECT carrying three computed columns:
//
//   total      count(*) over() -- how many rows the predicate matched BEFORE
//              the cap, so `counts.total` is honest even when the cap cut rows
//              (the same invariant Today's bounded sections keep).
//   title_all  every text token matches the TITLE column. Used as the first
//              ORDER BY key so that when more than SEARCH_CANDIDATE_CAP rows
//              match, the rows the scorer would rank highest are the ones that
//              survive the cap -- a cap that dropped the exact-title hit in
//              favour of a body mention would be a cap deciding the ranking.
//   title_any  at least one text token matches the TITLE column. The SECOND
//              ORDER BY key, for the same reason one rung down: a partial
//              title hit out-scores any body-only row (title_token is 10 a
//              token against body_token's 3), so it must out-survive one too.
//              Without it, 100 newer body-only rows evicted an older row whose
//              title carried half the query (Checkpoint 9.6 review).
//   date_hit   the date-window predicate matched (null when no window was
//              applied, or the type has no date axis). The scorer awards
//              `date_window` on it; recomputing the window in TS would be a
//              second implementation of the same rule.

/** Largest candidate set fetched per type before TypeScript scoring. */
export const SEARCH_CANDIDATE_CAP = 100;

/**
 * How the tokens combine. `all` (AND) is the first rung of the fallback ladder;
 * `any` (OR) is the third. The second rung is `all` with the date token removed
 * -- the service expresses it by passing `date: null` -- so it needs no mode of
 * its own here.
 */
export type SearchPredicateMode = "all" | "any";

/**
 * The one date token's window, resolved to instants in the caller's zone.
 *
 * `fromLocal`/`toLocal` are inclusive local calendar dates (for the DATE
 * columns -- `events.start_date`, `projects.target_date` -- which are pure
 * dates and must never be compared to an instant, ADR-042/045); `startUtc`/
 * `endUtcExclusive` bound the TIMESTAMPTZ columns. `textPattern` is the token's
 * own text as a contains-pattern: on rung 1 a date token matches by window OR
 * by text, so "september" also finds a note that merely says "september".
 */
export interface SearchDateWindow {
  fromLocal: string;
  toLocal: string;
  startUtc: Date;
  endUtcExclusive: Date;
  textPattern: string;
}

export interface SearchPredicate {
  /** Escaped `%...%` patterns, one per text token, in query order. */
  textPatterns: readonly string[];
  mode: SearchPredicateMode;
  /** Applied only on rung 1. Null on every other rung and when the query had no date token. */
  date: SearchDateWindow | null;
}

/**
 * Resolves a tokeniser date window (inclusive local dates) into the instants
 * the timestamptz predicates need. Lives here rather than in core because
 * `localDayWindowForDate` is on core's Node-only barrel, which the pure
 * `./search/*` subpath must not reach.
 */
export function resolveSearchDateWindow(input: {
  tz: string;
  from: string;
  to: string;
  tokenText: string;
}): SearchDateWindow {
  return {
    fromLocal: input.from,
    toLocal: input.to,
    startUtc: localDayWindowForDate(input.tz, input.from).startUtc,
    endUtcExclusive: localDayWindowForDate(input.tz, input.to).endUtcExclusive,
    textPattern: buildContainsPattern(input.tokenText),
  };
}

// ---------------------------------------------------------------------------
// Predicate construction
// ---------------------------------------------------------------------------

/**
 * `column ILIKE :pattern ESCAPE :escape`, OR-ed across the columns a given
 * entity exposes to search.
 *
 * Written with the `sql` template rather than drizzle's `ilike()` helper for
 * exactly one reason: the helper emits no ESCAPE clause. Relying on
 * PostgreSQL's default (which is backslash, and which this project verified)
 * would make the escaping in `buildContainsPattern` correct only by a
 * convention stated nowhere in the query.
 *
 * A NULL column never matches -- `NULL ILIKE x` is NULL, and NULL OR FALSE is
 * NULL -- which is the correct behaviour and is why nothing here coalesces.
 * `inbox_items.raw_text` is nullable precisely because a push-to-talk capture
 * exists before its transcript does, and an untranscribed capture genuinely
 * has no text to find.
 */
function textMatch(pattern: string, first: Column, ...rest: readonly Column[]): SQL {
  const clause = (column: Column): SQL =>
    sql`${column} ilike ${pattern} escape ${LIKE_ESCAPE_CHARACTER}`;
  return rest.reduce<SQL>(
    (accumulated, column) => sql`(${accumulated} or ${clause(column)})`,
    clause(first),
  );
}

function allOf(clauses: readonly SQL[]): SQL {
  return clauses.reduce((accumulated, clause) => sql`(${accumulated} and ${clause})`);
}

function anyOf(clauses: readonly SQL[]): SQL {
  return clauses.reduce((accumulated, clause) => sql`(${accumulated} or ${clause})`);
}

interface EntityPredicate {
  /** The WHERE fragment for the tokens; null when nothing can match (no tokens at all). */
  where: SQL | null;
  /** `title_all` -- every text token matches the title column. */
  titleAll: SQL;
  /** `title_any` -- at least one text token matches the title column. */
  titleAny: SQL;
  /** `date_hit` -- the window predicate, or a SQL NULL when none applies. */
  dateHit: SQL;
}

/**
 * Builds the three computed fragments for one entity.
 *
 * `columns` is every searchable text column (title first); `title` is the one
 * `title_all` is computed over; `dateClause` is the entity's window predicate
 * for the resolved window, or null for a type with no date axis (notes).
 */
function entityPredicate(
  predicate: SearchPredicate,
  title: Column,
  columns: readonly [Column, ...Column[]],
  dateClause: ((window: SearchDateWindow) => SQL) | null,
): EntityPredicate {
  const tokenClauses = predicate.textPatterns.map((pattern) => textMatch(pattern, ...columns));

  let dateHit: SQL = sql`null::boolean`;
  if (predicate.date !== null) {
    const window = predicate.date;
    const byText = textMatch(window.textPattern, ...columns);
    if (dateClause === null) {
      // No date axis: the date token is text like any other, and `date_hit`
      // stays null so the scorer cannot award a window it never tested.
      tokenClauses.push(byText);
    } else {
      const byWindow = dateClause(window);
      dateHit = byWindow;
      tokenClauses.push(sql`(${byWindow} or ${byText})`);
    }
  }

  const where =
    tokenClauses.length === 0
      ? null
      : predicate.mode === "all"
        ? allOf(tokenClauses)
        : anyOf(tokenClauses);

  const titleClauses = predicate.textPatterns.map((pattern) => textMatch(pattern, title));
  const titleAll = titleClauses.length === 0 ? sql`(1 = 0)` : allOf(titleClauses);
  const titleAny = titleClauses.length === 0 ? sql`(1 = 0)` : anyOf(titleClauses);

  return { where, titleAll, titleAny, dateHit };
}

/** `count(*) over()` arrives as a bigint; cast so `pg` hands back a number. */
const total = sql<number>`(count(*) over())::int`;

function inWindow(column: Column, window: SearchDateWindow): SQL {
  return sql`(${column} >= ${window.startUtc} and ${column} < ${window.endUtcExclusive})`;
}

/**
 * A pure-date comparison. `column` is a DATE column, or a wall-clock
 * TIMESTAMP (`occurrences.occurs_local`) whose date part is what matters; the
 * `::date` cast on the column is a no-op for the former and the intended
 * projection for the latter. The bounds are the inclusive local dates.
 */
function dateInRange(column: Column, window: SearchDateWindow): SQL {
  return sql`(${column}::date >= ${window.fromLocal}::date and ${column}::date <= ${window.toLocal}::date)`;
}

/**
 * A materialized occurrence of the parent falls in the window. This is what
 * makes "dentist september" find a monthly series whose parent row carries
 * only the anchor date: the occurrences table is the series' calendar.
 *
 * `allDay` is the parent's `all_day` column, for events. An all-day series'
 * occurrences are anchored at LOCAL NOON of each instance date (ADR-042) and
 * that anchor is implementation metadata which must never be read as a time
 * (ADR-045): compared as an instant against a window resolved in the
 * CALLER's zone, noon in America/Chicago is already the next calendar day in
 * Pacific/Auckland, and "today" would find tomorrow's instance. So an all-day
 * parent is matched on the occurrence's LOCAL DATE against the inclusive
 * local date bounds -- a pure date against pure dates -- and only a timed
 * parent compares `occurs_at` to the instant window.
 */
function occurrenceInWindow(
  parentType: "task" | "event",
  parent: Column,
  window: SearchDateWindow,
  allDay: Column | null = null,
) {
  const timed = inWindow(occurrences.occursAt, window);
  const when =
    allDay === null
      ? timed
      : sql`(case when ${allDay} then ${dateInRange(occurrences.occursLocal, window)} else ${timed} end)`;
  return sql`exists (select 1 from ${occurrences} where ${occurrences.parentType} = ${parentType} and ${occurrences.parentId} = ${parent} and ${when})`;
}

// ---------------------------------------------------------------------------
// Candidate rows
// ---------------------------------------------------------------------------
//
// Each candidate carries exactly the columns the service needs to score, label
// and emit a result -- and nothing else. External identifiers, `client_uuid`,
// `audio_path`, `parse_result`, `confidence`, `from_address` and `from_domain`
// are never selected, so they cannot reach the response by accident; the
// strict result schemas would reject them anyway, but not selecting them is
// the layer that costs nothing.

interface CandidateComputed {
  total: number;
  titleAll: boolean;
  dateHit: boolean | null;
}

export interface TaskCandidate extends CandidateComputed {
  id: string;
  title: string;
  body: string | null;
  status: string;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface NoteCandidate extends CandidateComputed {
  id: string;
  title: string;
  body: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface EventCandidate extends CandidateComputed {
  id: string;
  title: string;
  location: string | null;
  description: string | null;
  origin: string;
  allDay: boolean;
  startsAt: Date | null;
  startDate: string | null;
  rrule: string | null;
  parentEventId: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface ProjectCandidate extends CandidateComputed {
  id: string;
  name: string;
  goal: string | null;
  status: string;
  targetDate: string | null;
  archivedAt: Date | null;
  updatedAt: Date;
}

export interface InboxCandidate extends CandidateComputed {
  id: string;
  rawText: string | null;
  status: string;
  entityType: string | null;
  entityId: string | null;
  capturedAt: Date;
}

export interface MailCandidate extends CandidateComputed {
  id: string;
  subject: string | null;
  fromDisplayName: string | null;
  hasAttachment: boolean;
  internalDate: Date;
}

/**
 * No per-call cap: SEARCH_CANDIDATE_CAP is a constant of the read model, not
 * a knob. A caller-supplied cap would let one code path fetch more than the
 * measured, documented bound (or fewer, and silently change which rows the
 * scorer ever sees).
 */
export interface SearchCandidateOptions {
  predicate: SearchPredicate;
  includeArchived: boolean;
}

export async function searchTaskCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<TaskCandidate[]> {
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    tasks.title,
    [tasks.title, tasks.body],
    (window) =>
      sql`(${inWindow(tasks.dueAt, window)} or ${occurrenceInWindow("task", tasks.id, window)})`,
  );
  if (where === null) return [];

  return (
    db
      .select({
        id: tasks.id,
        title: tasks.title,
        body: tasks.body,
        status: tasks.status,
        archivedAt: tasks.archivedAt,
        updatedAt: tasks.updatedAt,
        total,
        titleAll: sql<boolean>`${titleAll}`,
        dateHit: sql<boolean | null>`${dateHit}`,
      })
      .from(tasks)
      .where(and(where, options.includeArchived ? undefined : isNull(tasks.archivedAt)))
      // Title-complete rows first, then any-title-hit rows (see the module
      // comment on the cap), then recency, then id. `id` is needed:
      // `updated_at` alone is not a total order, and Checkpoint 8.2 observed
      // 98 rows sharing one instant.
      .orderBy(desc(sql`${titleAll}`), desc(sql`${titleAny}`), desc(tasks.updatedAt), asc(tasks.id))
      .limit(SEARCH_CANDIDATE_CAP)
  );
}

export async function searchNoteCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<NoteCandidate[]> {
  // Notes have no date axis: a date token matches by text only, and
  // `date_hit` is null so the scorer never awards a window here.
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    notes.title,
    [notes.title, notes.body],
    null,
  );
  if (where === null) return [];

  return db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      archivedAt: notes.archivedAt,
      updatedAt: notes.updatedAt,
      total,
      titleAll: sql<boolean>`${titleAll}`,
      dateHit: sql<boolean | null>`${dateHit}`,
    })
    .from(notes)
    .where(and(where, options.includeArchived ? undefined : isNull(notes.archivedAt)))
    .orderBy(desc(sql`${titleAll}`), desc(sql`${titleAny}`), desc(notes.updatedAt), asc(notes.id))
    .limit(SEARCH_CANDIDATE_CAP);
}

export async function searchEventCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<EventCandidate[]> {
  // `description` is MATCHED for every event -- an external event's
  // description is where a third party wrote the agenda the user remembers --
  // but the service never EMITS it for an `external` row (ADR-064/065): it is
  // also where conference links and passcodes live. Matching a column and
  // showing it are different decisions.
  //
  // One result per ROW: a series parent is one candidate (its occurrences
  // contribute only to the date predicate), and a detached instance is its own
  // row with its own text.
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    events.title,
    [events.title, events.location, events.description],
    (window) =>
      sql`(${inWindow(events.startsAt, window)} or ${dateInRange(events.startDate, window)} or ${occurrenceInWindow("event", events.id, window, events.allDay)})`,
  );
  if (where === null) return [];

  return db
    .select({
      id: events.id,
      title: events.title,
      location: events.location,
      description: events.description,
      origin: events.origin,
      allDay: events.allDay,
      startsAt: events.startsAt,
      startDate: events.startDate,
      rrule: events.rrule,
      parentEventId: events.parentEventId,
      archivedAt: events.archivedAt,
      updatedAt: events.updatedAt,
      total,
      titleAll: sql<boolean>`${titleAll}`,
      dateHit: sql<boolean | null>`${dateHit}`,
    })
    .from(events)
    .where(and(where, options.includeArchived ? undefined : isNull(events.archivedAt)))
    .orderBy(desc(sql`${titleAll}`), desc(sql`${titleAny}`), desc(events.updatedAt), asc(events.id))
    .limit(SEARCH_CANDIDATE_CAP);
}

export async function searchProjectCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<ProjectCandidate[]> {
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    projects.name,
    [projects.name, projects.goal],
    (window) => dateInRange(projects.targetDate, window),
  );
  if (where === null) return [];

  return db
    .select({
      id: projects.id,
      name: projects.name,
      goal: projects.goal,
      status: projects.status,
      targetDate: projects.targetDate,
      archivedAt: projects.archivedAt,
      updatedAt: projects.updatedAt,
      total,
      titleAll: sql<boolean>`${titleAll}`,
      dateHit: sql<boolean | null>`${dateHit}`,
    })
    .from(projects)
    .where(and(where, options.includeArchived ? undefined : isNull(projects.archivedAt)))
    .orderBy(
      desc(sql`${titleAll}`),
      desc(sql`${titleAny}`),
      desc(projects.updatedAt),
      asc(projects.id),
    )
    .limit(SEARCH_CANDIDATE_CAP);
}

export async function searchInboxCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<InboxCandidate[]> {
  // Since Checkpoint 9.3 (migration 0017) this table has a user archive axis.
  // A dismissed capture is excluded UNCONDITIONALLY -- `include_archived`
  // does not apply here, because the inbox_item result member carries no
  // `archived` flag (unlike task/note), so an included row would be
  // indistinguishable from a live one. Every status is still searchable,
  // including `failed` -- a capture whose parse failed is exactly the kind of
  // thing a person goes looking for.
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    inboxItems.rawText,
    [inboxItems.rawText],
    (window) => inWindow(inboxItems.capturedAt, window),
  );
  if (where === null) return [];

  return (
    db
      .select({
        id: inboxItems.id,
        rawText: inboxItems.rawText,
        status: inboxItems.status,
        entityType: inboxItems.entityType,
        entityId: inboxItems.entityId,
        capturedAt: inboxItems.capturedAt,
        total,
        titleAll: sql<boolean>`${titleAll}`,
        dateHit: sql<boolean | null>`${dateHit}`,
      })
      .from(inboxItems)
      .where(and(where, isNull(inboxItems.archivedAt)))
      // `captured_at`, not `created_at`: this table has no `updated_at`, and
      // capture time is what the user remembers.
      .orderBy(
        desc(sql`${titleAll}`),
        desc(sql`${titleAny}`),
        desc(inboxItems.capturedAt),
        asc(inboxItems.id),
      )
      .limit(SEARCH_CANDIDATE_CAP)
  );
}

export async function searchMailCandidates(
  db: Db,
  options: SearchCandidateOptions,
): Promise<MailCandidate[]> {
  // METADATA ONLY -- there is no body column to search and, under the
  // `gmail.metadata` scope, no body to fetch (ADR-053).
  //
  // `deleted_at` is excluded unconditionally, and `include_archived` does NOT
  // reach here. That column is a provider-reconciliation tombstone: the
  // provider stopped returning the message. It is not a user archive, so a flag
  // about the user's archive has no business toggling it.
  //
  // Deliberately NOT filtered on `mail_connections.status`. The digest joins
  // and requires an active connection because it answers "what needs attention
  // today"; search answers "is this stored", and a disconnected mailbox's rows
  // are still stored until the 8.6C retention window prunes them. Hiding rows
  // that are demonstrably in the table would be the dishonest option.
  const { where, titleAll, titleAny, dateHit } = entityPredicate(
    options.predicate,
    mailMessages.subject,
    [mailMessages.subject, mailMessages.fromDisplayName],
    (window) => inWindow(mailMessages.internalDate, window),
  );
  if (where === null) return [];

  return db
    .select({
      id: mailMessages.id,
      subject: mailMessages.subject,
      // Display name only. `from_address` and `from_domain` are stored and
      // never selected here -- see MailSearchResultSchema.
      fromDisplayName: mailMessages.fromDisplayName,
      hasAttachment: mailMessages.hasAttachment,
      internalDate: mailMessages.internalDate,
      total,
      titleAll: sql<boolean>`${titleAll}`,
      dateHit: sql<boolean | null>`${dateHit}`,
    })
    .from(mailMessages)
    .where(and(where, isNull(mailMessages.deletedAt)))
    .orderBy(
      desc(sql`${titleAll}`),
      desc(sql`${titleAny}`),
      desc(mailMessages.internalDate),
      asc(mailMessages.id),
    )
    .limit(SEARCH_CANDIDATE_CAP);
}

// ---------------------------------------------------------------------------
// Item context loaders (getItemContext)
// ---------------------------------------------------------------------------
//
// One row by id, with exactly the columns ItemContextSchema can carry. Kept in
// this file rather than in the service so that every `.from(tasks|notes)` in
// the search feature stays inside the one reader the body-access ratchet
// (apps/api/src/ask/ai-egress-guard.test.ts) already sanctions.

export interface ItemContextRow {
  type: SearchResultType;
  id: string;
  title: string;
  /** Raw stored body; the service bounds and strips it. Null when the type has none or it is withheld. */
  body: string | null;
  timestamp: Date;
  status: string | null;
  archived: boolean;
  origin: "local" | "external" | null;
  projectId: string | null;
}

export async function loadItemContextRow(
  db: Db,
  type: SearchResultType,
  id: string,
): Promise<ItemContextRow | null> {
  switch (type) {
    case "task": {
      const [row] = await db
        .select({
          id: tasks.id,
          title: tasks.title,
          body: tasks.body,
          status: tasks.status,
          archivedAt: tasks.archivedAt,
          updatedAt: tasks.updatedAt,
          projectId: tasks.projectId,
        })
        .from(tasks)
        .where(eq(tasks.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.id,
        title: row.title,
        body: row.body,
        timestamp: row.updatedAt,
        status: row.status,
        archived: row.archivedAt !== null,
        origin: null,
        projectId: row.projectId,
      };
    }
    case "note": {
      const [row] = await db
        .select({
          id: notes.id,
          title: notes.title,
          body: notes.body,
          archivedAt: notes.archivedAt,
          updatedAt: notes.updatedAt,
          projectId: notes.projectId,
        })
        .from(notes)
        .where(eq(notes.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.id,
        title: row.title,
        body: row.body,
        timestamp: row.updatedAt,
        status: null,
        archived: row.archivedAt !== null,
        origin: null,
        projectId: row.projectId,
      };
    }
    case "event": {
      const [row] = await db
        .select({
          id: events.id,
          title: events.title,
          description: events.description,
          origin: events.origin,
          archivedAt: events.archivedAt,
          updatedAt: events.updatedAt,
          projectId: events.projectId,
        })
        .from(events)
        .where(eq(events.id, id))
        .limit(1);
      if (!row) return null;
      const origin = row.origin === "local" ? "local" : "external";
      return {
        type,
        id: row.id,
        title: row.title,
        // An external event's description is withheld here for the same
        // reason search never previews it: third-party text carrying links
        // and passcodes is matched, never surfaced.
        body: origin === "local" ? row.description : null,
        timestamp: row.updatedAt,
        status: null,
        archived: row.archivedAt !== null,
        origin,
        projectId: row.projectId,
      };
    }
    case "project": {
      const [row] = await db
        .select({
          id: projects.id,
          name: projects.name,
          goal: projects.goal,
          status: projects.status,
          archivedAt: projects.archivedAt,
          updatedAt: projects.updatedAt,
        })
        .from(projects)
        .where(eq(projects.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.id,
        title: row.name,
        body: row.goal,
        timestamp: row.updatedAt,
        status: row.status,
        archived: row.archivedAt !== null,
        origin: null,
        projectId: null,
      };
    }
    case "inbox_item": {
      const [row] = await db
        .select({
          id: inboxItems.id,
          rawText: inboxItems.rawText,
          status: inboxItems.status,
          archivedAt: inboxItems.archivedAt,
          capturedAt: inboxItems.capturedAt,
        })
        .from(inboxItems)
        .where(eq(inboxItems.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.id,
        // The capture text IS the title (there is no title column); it is also
        // the body, so a caller reading context gets the whole capture.
        title: row.rawText ?? "",
        body: row.rawText,
        timestamp: row.capturedAt,
        status: row.status,
        archived: row.archivedAt !== null,
        origin: null,
        projectId: null,
      };
    }
    case "mail_message": {
      const [row] = await db
        .select({
          id: mailMessages.id,
          subject: mailMessages.subject,
          internalDate: mailMessages.internalDate,
          deletedAt: mailMessages.deletedAt,
        })
        .from(mailMessages)
        .where(eq(mailMessages.id, id))
        .limit(1);
      if (!row) return null;
      return {
        type,
        id: row.id,
        title: row.subject ?? "",
        // No body exists under gmail.metadata (ADR-053), and none is invented.
        body: null,
        timestamp: row.internalDate,
        status: null,
        archived: row.deletedAt !== null,
        origin: null,
        projectId: null,
      };
    }
  }
}
