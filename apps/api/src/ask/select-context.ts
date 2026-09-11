// Cloud Ask -- the ONE body-reading query for this lane (design §7).
//
// A DEDICATED query over tasks and notes only, reusing only the escaping
// HELPERS from the search read model -- not `buildSearchResponse` itself. The
// design's first draft claimed reuse of that function; the adversarial review
// showed it does not fit: it fans out to four entities (two of which Ask must
// never touch), applies no status filter, and returns 200-character previews
// rather than full bodies. This is therefore the second and ONLY OTHER place
// in `apps/api` that reads a note or task BODY for anything other than the
// entity's own CRUD routes -- named explicitly in the mechanical ratchet at
// `ai-egress-guard.test.ts`.
//
// RANKING HAPPENS IN JAVASCRIPT, NOT SQL. The WHERE clause (which terms
// determine which rows are candidates at all) is the only place user-derived
// text reaches SQL, via the same `ILIKE ... ESCAPE` + bound-parameter
// discipline `read-models/search.ts` already established -- no `sql.raw`, no
// string-built predicate, every value bound. Once candidate rows are fetched,
// counting how many of the (already-bounded, already-escaped) terms a row's
// own title/body contain is a plain string operation over data this process
// already holds, and doing it in JS keeps the query itself simple enough to
// read in one sitting.
import { LIKE_ESCAPE_CHARACTER, buildContainsPattern } from "@personal-os/core/search/query";
import { notes, projects, tasks, type Db } from "@personal-os/db";
import { and, asc, desc, eq, isNull, notInArray, sql, type Column, type SQL } from "drizzle-orm";
import { assertGrant, type CloudAskGrant } from "./authorize.js";
import { ASK_MAX_PER_TYPE, ASK_MAX_RECORDS } from "./contracts.js";

/** A safety valve, not the product bound -- ASK_MAX_PER_TYPE is applied AFTER ranking, in JS. */
const CANDIDATE_FETCH_CAP = 500;

export interface AskCandidateRecord {
  type: "task" | "note";
  id: string;
  title: string;
  body: string | null;
  projectName: string | null;
  updatedAt: Date;
  matchCount: number;
}

/**
 * `(title ILIKE :p1 ESCAPE :e OR body ILIKE :p1 ESCAPE :e) OR (... :p2 ...) OR ...`
 *
 * Written with the `sql` template, exactly like `read-models/search.ts`'s
 * `textMatch` -- drizzle's `ilike()` helper emits no ESCAPE clause, so relying
 * on it would make the escaping correct only by an unstated server default.
 */
function anyPatternMatches(patterns: readonly string[], title: Column, body: Column): SQL {
  const perPattern = patterns.map(
    (pattern) =>
      sql`(${title} ilike ${pattern} escape ${LIKE_ESCAPE_CHARACTER} or ${body} ilike ${pattern} escape ${LIKE_ESCAPE_CHARACTER})`,
  );
  return perPattern.reduce((acc, clause) => sql`(${acc} or ${clause})`);
}

function countMatches(terms: readonly string[], title: string, body: string | null): number {
  const haystack = `${title}\n${body ?? ""}`.toLowerCase();
  return terms.reduce((count, term) => (haystack.includes(term) ? count + 1 : count), 0);
}

function rankAndCap(rows: readonly AskCandidateRecord[], limit: number): AskCandidateRecord[] {
  return [...rows]
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount;
      const byRecency = b.updatedAt.getTime() - a.updatedAt.getTime();
      if (byRecency !== 0) return byRecency;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .slice(0, limit);
}

async function selectTaskCandidates(
  db: Db,
  terms: readonly string[],
  patterns: readonly string[],
): Promise<AskCandidateRecord[]> {
  const where = and(
    anyPatternMatches(patterns, tasks.title, tasks.body),
    isNull(tasks.archivedAt),
    // Done/dropped tasks are excluded -- they are no longer live work, and
    // including them would make "what should I do about X" answer with
    // things already finished or abandoned.
    notInArray(tasks.status, ["done", "dropped"]),
  );

  const rows = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      body: tasks.body,
      updatedAt: tasks.updatedAt,
      projectName: projects.name,
    })
    .from(tasks)
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(where)
    .orderBy(desc(tasks.updatedAt), asc(tasks.id))
    .limit(CANDIDATE_FETCH_CAP);

  return rows.map((row) => ({
    type: "task" as const,
    id: row.id,
    title: row.title,
    body: row.body,
    projectName: row.projectName,
    updatedAt: row.updatedAt,
    matchCount: countMatches(terms, row.title, row.body),
  }));
}

async function selectNoteCandidates(
  db: Db,
  terms: readonly string[],
  patterns: readonly string[],
): Promise<AskCandidateRecord[]> {
  const where = and(anyPatternMatches(patterns, notes.title, notes.body), isNull(notes.archivedAt));

  const rows = await db
    .select({
      id: notes.id,
      title: notes.title,
      body: notes.body,
      updatedAt: notes.updatedAt,
      projectName: projects.name,
    })
    .from(notes)
    .leftJoin(projects, eq(notes.projectId, projects.id))
    .where(where)
    .orderBy(desc(notes.updatedAt), asc(notes.id))
    .limit(CANDIDATE_FETCH_CAP);

  return rows.map((row) => ({
    type: "note" as const,
    id: row.id,
    title: row.title,
    body: row.body,
    projectName: row.projectName,
    updatedAt: row.updatedAt,
    matchCount: countMatches(terms, row.title, row.body),
  }));
}

/**
 * Selects the final, already-ranked and already-capped candidate set: at most
 * `ASK_MAX_PER_TYPE` per type, at most `ASK_MAX_RECORDS` total.
 *
 * Requires a valid grant -- checked FIRST, before either query runs. Callers
 * must already have confirmed `terms.length > 0` (see
 * `apps/api/src/routes/ask.ts`); an empty term list here would build a
 * reduce-with-no-initial-value crash rather than a meaningful result, which is
 * intentional -- it is a caller bug, not a data condition to handle quietly.
 */
export async function selectAskContext(
  db: Db,
  grant: unknown,
  terms: readonly string[],
): Promise<AskCandidateRecord[]> {
  assertGrant(grant);
  const patterns = terms.map(buildContainsPattern);

  const [taskCandidates, noteCandidates] = await Promise.all([
    selectTaskCandidates(db, terms, patterns),
    selectNoteCandidates(db, terms, patterns),
  ]);

  const combined = [
    ...rankAndCap(taskCandidates, ASK_MAX_PER_TYPE),
    ...rankAndCap(noteCandidates, ASK_MAX_PER_TYPE),
  ];
  return rankAndCap(combined, ASK_MAX_RECORDS);
}

export type { CloudAskGrant };
