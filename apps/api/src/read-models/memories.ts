// The Personal Memory layer's READ projection (Checkpoint 10.7, ADR-077).
//
// ===========================================================================
// READS ONLY. WRITES LIVE IN routes/memories.ts, routes/memory-settings.ts
// AND routes/memory-suggestions.ts.
// ===========================================================================
//
// Guard 6 (apps/api/src/ask/ai-egress-guard.test.ts) pins three things about
// this file: it contains no write verb of any kind (no `.insert(`/`.update(`/
// `.delete(`, no `onConflict`, no `.execute(`, no `.transaction(`, no
// write-verb `sql` template); it imports neither the AI SDK, the provider
// package nor an AI lane; and NO other read model imports or re-exports it,
// nor names the memory tables -- so memory can never become an input to
// `buildTodayResponse`, the one object both AI collectors are built from. The
// one exception is read-models/user-export.ts, which reads the flat rows for
// GET /export and deliberately does NOT import this file: the export is an
// allowlist that must stay readable in one place.
//
// Suggestions (ADR-077 §4) are COMPUTED here at request time from columns the
// owner already sees on the project screen, and are never stored. Only the
// owner's answer persists, in `memory_suggestions`, which this module reads
// solely to know which keys are already answered.
import { truncateField } from "@personal-os/core";
import {
  MEMORY_SETTINGS_SINGLETON_ID,
  canvasCourses,
  memories,
  memorySettings,
  memorySuggestions,
  projects,
  type Db,
} from "@personal-os/db";
import {
  MEMORY_STATEMENT_MAX_CHARS,
  MemoryItemSchema,
  MemoryListResponseSchema,
  MemorySettingsSchema,
  MemorySuggestionSchema,
  memorySuggestionKey,
  type MemoryItem,
  type MemoryListQuery,
  type MemoryListResponse,
  type MemorySettings,
  type MemorySuggestion,
} from "@personal-os/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  or,
  sql,
} from "drizzle-orm";

/**
 * A transaction handle is accepted wherever a `Db` is, so the decide route
 * can re-read the item it just wrote inside the same transaction (the shape
 * routes/tasks.ts and routes/events.ts already use).
 */
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
export type MemoryReader = Db | Tx;

/** At most this many pending suggestions are offered per request. */
export const MEMORY_SUGGESTIONS_MAX = 20;

// ---- The list/detail item ---------------------------------------------------

/**
 * One row of the joined selection below: the memory plus the display names
 * its two links resolve to. Both joins are LEFT joins on purpose -- an
 * archived project or course still resolves (the memory keeps its context);
 * only a deleted row, which the FK's `set null` has already cleared on the
 * memory, is gone.
 */
const memoryItemSelection = {
  memory: memories,
  projectName: projects.name,
  courseName: canvasCourses.name,
  courseCode: canvasCourses.courseCode,
};

type MemoryItemRow = {
  memory: typeof memories.$inferSelect;
  projectName: string | null;
  courseName: string | null;
  courseCode: string | null;
};

/** Named fields only -- never a spread -- so a future column is a decision. */
export function toMemoryItem(row: MemoryItemRow): MemoryItem {
  const { memory } = row;
  return MemoryItemSchema.parse({
    id: memory.id,
    kind: memory.kind,
    statement: memory.statement,
    note: memory.note,
    source: memory.source,
    suggestion_id: memory.suggestionId,
    project_id: memory.projectId,
    canvas_course_id: memory.canvasCourseId,
    created_at: memory.createdAt.toISOString(),
    updated_at: memory.updatedAt.toISOString(),
    project:
      memory.projectId !== null && row.projectName !== null
        ? { id: memory.projectId, name: row.projectName }
        : null,
    course:
      memory.canvasCourseId !== null && row.courseName !== null
        ? { id: memory.canvasCourseId, name: row.courseName, course_code: row.courseCode }
        : null,
  });
}

function selectMemoryItems(db: MemoryReader) {
  return db
    .select(memoryItemSelection)
    .from(memories)
    .leftJoin(projects, eq(memories.projectId, projects.id))
    .leftJoin(canvasCourses, eq(memories.canvasCourseId, canvasCourses.id));
}

export async function getMemoryItem(db: MemoryReader, id: string): Promise<MemoryItem | null> {
  const [row] = await selectMemoryItems(db).where(eq(memories.id, id)).limit(1);
  return row ? toMemoryItem(row) : null;
}

/**
 * The Memory Center list: newest edit first, `id` as the total-order tie
 * break, an honest `total` beside the page.
 */
export async function listMemories(
  db: MemoryReader,
  query: MemoryListQuery,
): Promise<MemoryListResponse> {
  const where = and(
    query.kind ? eq(memories.kind, query.kind) : undefined,
    query.project_id ? eq(memories.projectId, query.project_id) : undefined,
    query.canvas_course_id ? eq(memories.canvasCourseId, query.canvas_course_id) : undefined,
  );

  const [rows, totals] = await Promise.all([
    selectMemoryItems(db)
      .where(where)
      .orderBy(desc(memories.updatedAt), asc(memories.id))
      .limit(query.limit)
      .offset(query.offset),
    db.select({ total: count() }).from(memories).where(where),
  ]);

  return MemoryListResponseSchema.parse({
    items: rows.map(toMemoryItem),
    limit: query.limit,
    offset: query.offset,
    total: totals[0]?.total ?? 0,
  });
}

// ---- The global switch ------------------------------------------------------

/**
 * `enabled` when the singleton row is absent -- the layer ships ON (ADR-077
 * §7) and PATCH /memory-settings materialises the row lazily. The switch gates
 * USE (suggestions here; Focus Now / the briefing on the client), never
 * storage, so nothing in this module hides a row because of it.
 */
export async function isMemoryEnabled(db: MemoryReader): Promise<boolean> {
  const [row] = await db
    .select({ enabled: memorySettings.enabled })
    .from(memorySettings)
    .where(eq(memorySettings.id, MEMORY_SETTINGS_SINGLETON_ID))
    .limit(1);
  return row ? row.enabled : true;
}

export async function getMemorySettings(db: MemoryReader): Promise<MemorySettings> {
  const [enabled, totals] = await Promise.all([
    isMemoryEnabled(db),
    db.select({ total: count() }).from(memories),
  ]);
  return MemorySettingsSchema.parse({ enabled, memory_count: totals[0]?.total ?? 0 });
}

// ---- Suggestions: computed at request time, never stored --------------------

/**
 * The one 10.7 trigger, `project_goal` (ADR-077 §4): every unarchived project
 * with a non-blank `goal` that has neither a `goal` memory linked to it nor a
 * standing answer for its key -- `accepted` or `never` silence it for good,
 * `dismissed` until `ask_again_after` has passed. `now` is a parameter so the
 * "offer again after 14 days" edge can be proven without a clock.
 *
 * The statement offered is the goal itself, trimmed, and bounded to the
 * memory statement's own maximum so what is shown is always acceptable as
 * shown (a goal may be up to PROJECT_GOAL_MAX_CHARS, twice the memory bound).
 * The evidence line cites the row the sentence came from, so the owner can
 * check the claim on the project screen. Empty when the switch is off.
 */
export async function listPendingMemorySuggestions(
  db: MemoryReader,
  now: Date = new Date(),
): Promise<MemorySuggestion[]> {
  if (!(await isMemoryEnabled(db))) return [];

  const suggestionKeyFor = sql<string>`${memorySuggestionKey("project_goal", "")} || ${projects.id}::text`;

  const rows = await db
    .select({ id: projects.id, name: projects.name, goal: projects.goal })
    .from(projects)
    .where(
      and(
        isNull(projects.archivedAt),
        isNotNull(projects.goal),
        ne(sql`btrim(${projects.goal})`, ""),
        notExists(
          db
            .select({ one: sql`1` })
            .from(memories)
            .where(and(eq(memories.kind, "goal"), eq(memories.projectId, projects.id))),
        ),
        notExists(
          db
            .select({ one: sql`1` })
            .from(memorySuggestions)
            .where(
              and(
                eq(memorySuggestions.suggestionKey, suggestionKeyFor),
                or(
                  inArray(memorySuggestions.status, ["accepted", "never"]),
                  and(
                    eq(memorySuggestions.status, "dismissed"),
                    gt(memorySuggestions.askAgainAfter, now),
                  ),
                ),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(projects.updatedAt), asc(projects.id))
    .limit(MEMORY_SUGGESTIONS_MAX);

  return rows.map((row) =>
    MemorySuggestionSchema.parse({
      key: memorySuggestionKey("project_goal", row.id),
      kind: "project_goal",
      memory_kind: "goal",
      statement: truncateField((row.goal ?? "").trim(), MEMORY_STATEMENT_MAX_CHARS).text,
      evidence: `From the goal you set on ${row.name}`,
      project: { id: row.id, name: row.name },
    }),
  );
}
