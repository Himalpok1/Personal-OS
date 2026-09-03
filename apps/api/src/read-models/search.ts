import {
  SEARCH_SENDER_MAX_CHARS,
  searchPreview,
  searchTitle,
} from "@personal-os/core/search/preview";
import { LIKE_ESCAPE_CHARACTER, buildContainsPattern } from "@personal-os/core/search/query";
import { inboxItems, mailMessages, notes, tasks, type Db } from "@personal-os/db";
import {
  SearchResponseSchema,
  type SearchQuery,
  type SearchResponse,
  type SearchResult,
} from "@personal-os/schema";
import { and, asc, count, desc, isNull, sql, type Column, type SQL } from "drizzle-orm";

// Lexical search across the four searchable entities (Checkpoint 8.3).
//
// ===========================================================================
// WHY THERE IS NO INDEX, AND WHY THAT IS NOT AN OVERSIGHT
// ===========================================================================
//
// ADR-056 settles it: "Search in Phase 8 is therefore query-time and
// index-free." Three independent reasons stack up behind that, and any one of
// them alone would be enough:
//
//   1. SIZE. Production holds single-digit rows in tasks, notes and
//      inbox_items, and a few hundred mail_messages. A sequential scan over
//      that is faster than the round trip that carries it.
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
// infrastructure ADR, not a quietly-added index.
//
// ===========================================================================
// HOW USER INPUT REACHES SQL
// ===========================================================================
//
// The query is normalized and length-bounded by SearchQuerySchema before this
// module sees it, then turned into a pattern by `buildContainsPattern`, which
// escapes `\`, `%` and `_`. That pattern is passed as a BOUND PARAMETER, and so
// is the escape character -- `ilike $1 escape $2`, verified against this
// project's PostgreSQL 17 rather than assumed. Naming the escape character
// explicitly means this code does not depend on a server default that a reader
// would otherwise have to know.
//
// No fragment of the user's text is ever concatenated into SQL text. There is
// no `sql.raw` here, and there is none anywhere in this repository.

/**
 * One entity's slice of the response, before merging.
 *
 * `readonly T[]` so a slice of a narrow member type is assignable to
 * `EntitySlice<SearchResult>` when the four are collected together.
 */
interface EntitySlice<T extends SearchResult> {
  results: readonly T[];
  total: number;
}

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

async function searchTasks(
  db: Db,
  pattern: string,
  limit: number,
  includeArchived: boolean,
): Promise<EntitySlice<Extract<SearchResult, { type: "task" }>>> {
  const where = and(
    textMatch(pattern, tasks.title, tasks.body),
    includeArchived ? undefined : isNull(tasks.archivedAt),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(where)
      // Recency, then id. Both are needed: `id` alone is meaningless to a
      // reader, and `updated_at` alone is not a total order.
      .orderBy(desc(tasks.updatedAt), asc(tasks.id))
      .limit(limit),
    db.select({ total: count() }).from(tasks).where(where),
  ]);

  return {
    results: rows.map((row) => ({
      type: "task" as const,
      id: row.id,
      title: searchTitle(row.title, "(untitled task)"),
      preview: searchPreview(row.body),
      timestamp: row.updatedAt.toISOString(),
      status: row.status as Extract<SearchResult, { type: "task" }>["status"],
      archived: row.archivedAt !== null,
    })),
    total: totals[0]?.total ?? 0,
  };
}

async function searchNotes(
  db: Db,
  pattern: string,
  limit: number,
  includeArchived: boolean,
): Promise<EntitySlice<Extract<SearchResult, { type: "note" }>>> {
  const where = and(
    textMatch(pattern, notes.title, notes.body),
    includeArchived ? undefined : isNull(notes.archivedAt),
  );

  const [rows, totals] = await Promise.all([
    db.select().from(notes).where(where).orderBy(desc(notes.updatedAt), asc(notes.id)).limit(limit),
    db.select({ total: count() }).from(notes).where(where),
  ]);

  return {
    results: rows.map((row) => ({
      type: "note" as const,
      id: row.id,
      title: searchTitle(row.title, "(untitled note)"),
      preview: searchPreview(row.body),
      timestamp: row.updatedAt.toISOString(),
      archived: row.archivedAt !== null,
    })),
    total: totals[0]?.total ?? 0,
  };
}

async function searchInboxItems(
  db: Db,
  pattern: string,
  limit: number,
): Promise<EntitySlice<Extract<SearchResult, { type: "inbox_item" }>>> {
  // No archive axis exists on this table, so `include_archived` is not
  // applicable rather than ignored. Every status is searchable, including
  // `failed` -- a capture whose parse failed is exactly the kind of thing a
  // person goes looking for.
  const where = textMatch(pattern, inboxItems.rawText);

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(inboxItems)
      // `captured_at`, not `created_at`: this table has no `updated_at`, and
      // capture time is what the user remembers.
      .where(where)
      .orderBy(desc(inboxItems.capturedAt), asc(inboxItems.id))
      .limit(limit),
    db.select({ total: count() }).from(inboxItems).where(where),
  ]);

  return {
    results: rows.map((row) => ({
      type: "inbox_item" as const,
      id: row.id,
      // The capture text IS the title -- there is no separate title column, so
      // `preview` stays null rather than repeating a prefix of the same string.
      title: searchTitle(row.rawText, "(no transcript)"),
      preview: null,
      timestamp: row.capturedAt.toISOString(),
      status: row.status as Extract<SearchResult, { type: "inbox_item" }>["status"],
      entity_type: row.entityType as Extract<SearchResult, { type: "inbox_item" }>["entity_type"],
      entity_id: row.entityId,
    })),
    total: totals[0]?.total ?? 0,
  };
}

async function searchMailMessages(
  db: Db,
  pattern: string,
  limit: number,
): Promise<EntitySlice<Extract<SearchResult, { type: "mail_message" }>>> {
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
  // are still stored -- no prune job exists (ADR-057 finding #2). Hiding rows
  // that are demonstrably in the table would be the dishonest option.
  const where = and(
    textMatch(pattern, mailMessages.subject, mailMessages.fromDisplayName),
    isNull(mailMessages.deletedAt),
  );

  const [rows, totals] = await Promise.all([
    db
      .select()
      .from(mailMessages)
      .where(where)
      .orderBy(desc(mailMessages.internalDate), asc(mailMessages.id))
      .limit(limit),
    db.select({ total: count() }).from(mailMessages).where(where),
  ]);

  return {
    results: rows.map((row) => ({
      type: "mail_message" as const,
      id: row.id,
      title: searchTitle(row.subject, "(no subject)"),
      preview: null,
      timestamp: row.internalDate.toISOString(),
      // Display name only. `from_address` and `from_domain` are stored but
      // never emitted here -- see MailSearchResultSchema.
      sender: searchPreview(row.fromDisplayName, SEARCH_SENDER_MAX_CHARS),
      has_attachment: row.hasAttachment,
    })),
    total: totals[0]?.total ?? 0,
  };
}

/**
 * Runs the four searches and assembles the frozen response shape.
 *
 * The four run CONCURRENTLY and are capped INDEPENDENTLY, which together are
 * what stop a large mail table from deciding how many notes the user gets back
 * (see SearchQuerySchema's note on the per-type cap).
 *
 * Result order is the contract's: types in SEARCH_RESULT_TYPE_ORDER, and within
 * a type the order the query already applied. Concatenating the slices in that
 * fixed order is the whole implementation -- there is no post-hoc sort, so
 * there is no second place for the ordering rule to drift to.
 */
export async function buildSearchResponse(db: Db, query: SearchQuery): Promise<SearchResponse> {
  const pattern = buildContainsPattern(query.q);
  const { limit } = query;

  const [task, note, inboxItem, mailMessage] = await Promise.all([
    searchTasks(db, pattern, limit, query.include_archived),
    searchNotes(db, pattern, limit, query.include_archived),
    searchInboxItems(db, pattern, limit),
    searchMailMessages(db, pattern, limit),
  ]);

  // Annotated, not inferred: without it TypeScript unifies the four slice
  // types to the first element's and rejects the rest.
  const slices: readonly EntitySlice<SearchResult>[] = [task, note, inboxItem, mailMessage];

  return SearchResponseSchema.parse({
    query: query.q,
    limit,
    truncated: slices.some((slice) => slice.total > slice.results.length),
    counts: {
      task: { returned: task.results.length, total: task.total },
      note: { returned: note.results.length, total: note.total },
      inbox_item: { returned: inboxItem.results.length, total: inboxItem.total },
      mail_message: { returned: mailMessage.results.length, total: mailMessage.total },
    },
    results: slices.flatMap((slice) => slice.results),
  } satisfies SearchResponse);
}
