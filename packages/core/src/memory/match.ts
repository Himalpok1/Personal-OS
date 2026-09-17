// Memory → recommendation matching (Checkpoint 10.7, ADR-077 §5): the ONLY
// place Personal OS reads a saved memory to influence anything, and it does
// so deterministically, by EXPLICIT TYPED LINK, on the client.
//
// Pure, total, no clock, no database, no Node builtin; ships to the Expo
// bundle through `./memory/*` (packages/core/package.json) exactly like
// `./academic/*` and `./focus-now/*`. Core never imports `@personal-os/schema`
// at runtime, so the input is a minimal structural shape (`MemoryLinkInput`)
// the client projects from `MemoryItem` (packages/schema/src/memories.ts).
//
// ===========================================================================
// MATCHING IS BY LINK. THERE IS NO TEXT MATCHING, NO SIMILARITY, NO MODEL.
// ===========================================================================
//
// A memory reaches a Focus Now row through one of exactly two nullable,
// owner-set foreign keys (ADR-077 §1):
//
//   memories.project_id       = the row's project          → `supports_goal`
//                                                           (a `goal` memory)
//   memories.project_id       = the row's project, OR
//   memories.canvas_course_id = the assignment's course    → `matches_preference`
//                                                           (a `preference` or
//                                                            `fact` memory)
//
// `matchMemoriesForRow` therefore takes ids only -- it cannot see a title,
// a body or a statement, so "the statement mentions the task" can never be
// a match (pinned in match.test.ts). At most ONE memory is returned per
// reason, so the +15 bonus (reasons.ts) is earned once per reason no matter
// how many memories are linked; the one returned is chosen by a total order
// (below) so identical inputs pick the identical memory.
//
// Selection order, per reason:
//   supports_goal        the row's project's `goal` memories, by statement
//                        then id
//   matches_preference   project-linked `preference`/`fact` memories first,
//                        then course-linked; within a bucket `preference`
//                        before `fact` (the label says "preference"), then
//                        statement, then id
//
// ===========================================================================
// THE ONE STRUCTURED READ OVER MEMORY TEXT: WORKING HOURS, BY FIXED GRAMMAR
// ===========================================================================
//
// `memoryWorkingHours` is the ONLY inference core performs over a memory's
// text, and it is not inference in any interesting sense: a single, closed,
// documented regular expression (`MEMORY_WORKING_HOURS_PATTERN`) that
// recognises a statement of the shape
//
//   "<work|working|study|studying|focus> hour(s)[:|-] H[:MM] <-|–|to> H[:MM]"
//
//   e.g. "Working hours 9-18" · "Study hours: 09:00 to 21:00" · "focus hours 7–12"
//
// and nothing else. The literal `hours`/`hour` token is REQUIRED on purpose:
// "I work 9 to 5 most days" is not recognised, because recognising it would
// mean deciding which numbers in free prose are hours, which is exactly the
// kind of open-ended reading of the owner's text 10.7 forbids. The owner can
// always rephrase to the documented form; the grammar never guesses. It is
// not similarity, not a model, and every other memory influence is by link.
// Hours must be 0–23 with start < end (the same-day working window
// `freeBlocks` already models); minutes, when written, must be `00` because
// the window is whole hours -- anything else yields null, never a rounded
// guess. The first matching `preference` memory in `id` order wins.
//
// ===========================================================================
// THE SWITCH GATES USE, NOT STORAGE (ADR-077 §7)
// ===========================================================================
//
// `buildMemoryIndex(memories, { enabled: false })` is an EMPTY index -- every
// lookup returns nothing -- and `memoryWorkingHours(..., { enabled: false })`
// is null, so a composer that received memories while the global switch is
// off behaves byte-identically to one that received none.

/** The closed memory kinds (mirrors `MEMORY_KINDS` in packages/schema; CHECKed in packages/db). */
export type MemoryLinkKind = "preference" | "goal" | "fact";

/** The minimal structural projection of a `MemoryItem` this module reads. */
export interface MemoryLinkInput {
  id: string;
  kind: MemoryLinkKind;
  statement: string;
  /** `memories.project_id` */
  projectId: string | null;
  /** `memories.canvas_course_id` */
  canvasCourseId: string | null;
}

export interface MemoryIndexOptions {
  /** `memory_settings.enabled`; false yields an index that matches nothing. */
  enabled: boolean;
}

/** An index over memories by their two link columns. Build once per render, query per row. */
export interface MemoryIndex {
  readonly enabled: boolean;
  /** Memories whose `projectId` is the key, in selection order (see the module comment). */
  readonly byProject: ReadonlyMap<string, readonly MemoryLinkInput[]>;
  /** Memories whose `canvasCourseId` is the key, in selection order. */
  readonly byCourse: ReadonlyMap<string, readonly MemoryLinkInput[]>;
}

/** The link ids a Focus Now row exposes; either may be absent, undefined or null. */
export interface MemoryRowLinks {
  projectId?: string | null;
  canvasCourseId?: string | null;
}

/** At most ONE memory per reason -- the +15 bonus is earned once per reason, never per memory. */
export interface MemoryRowMatch {
  matchesPreference: MemoryLinkInput | null;
  supportsGoal: MemoryLinkInput | null;
}

/** The boolean projection `scoreFocusNowTask` / `focusNowCandidateFromAcademic` take as `memory`. */
export interface MemoryMatchFlags {
  matchesPreference: boolean;
  supportsGoal: boolean;
}

/** The working window a `preference` memory may state (feeds `freeBlocks`' existing bounds). */
export interface MemoryWorkingHours {
  dayStartHour: number;
  dayEndHour: number;
}

const KIND_RANK: Readonly<Record<MemoryLinkKind, number>> = { preference: 0, goal: 1, fact: 2 };

/** The total selection order within one link bucket: kind (preference, goal, fact), statement, id. */
export function compareMemoryLinkInputs(a: MemoryLinkInput, b: MemoryLinkInput): number {
  const kind = KIND_RANK[a.kind] - KIND_RANK[b.kind];
  if (kind !== 0) return kind;
  if (a.statement < b.statement) return -1;
  if (a.statement > b.statement) return 1;
  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

const EMPTY_INDEX: MemoryIndex = Object.freeze({
  enabled: false,
  byProject: new Map<string, readonly MemoryLinkInput[]>(),
  byCourse: new Map<string, readonly MemoryLinkInput[]>(),
});

function push(
  map: Map<string, MemoryLinkInput[]>,
  key: string | null,
  memory: MemoryLinkInput,
): void {
  if (key === null || key === "") return;
  const bucket = map.get(key);
  if (bucket === undefined) map.set(key, [memory]);
  else bucket.push(memory);
}

/**
 * Indexes memories by their two link columns. A memory with neither link is
 * unreachable from any row and is simply not indexed; one with both links
 * appears under both keys. Disabled ⇒ the shared empty index. Pure: the
 * input array and its memories are never mutated.
 */
export function buildMemoryIndex(
  memories: readonly MemoryLinkInput[],
  options: MemoryIndexOptions,
): MemoryIndex {
  if (!options.enabled) return EMPTY_INDEX;
  const byProject = new Map<string, MemoryLinkInput[]>();
  const byCourse = new Map<string, MemoryLinkInput[]>();
  for (const memory of memories) {
    push(byProject, memory.projectId, memory);
    push(byCourse, memory.canvasCourseId, memory);
  }
  for (const bucket of byProject.values()) bucket.sort(compareMemoryLinkInputs);
  for (const bucket of byCourse.values()) bucket.sort(compareMemoryLinkInputs);
  return { enabled: true, byProject, byCourse };
}

const NO_MATCH: MemoryRowMatch = Object.freeze({ matchesPreference: null, supportsGoal: null });

function firstOfKinds(
  bucket: readonly MemoryLinkInput[] | undefined,
  kinds: ReadonlySet<MemoryLinkKind>,
): MemoryLinkInput | null {
  if (bucket === undefined) return null;
  for (const memory of bucket) {
    if (kinds.has(memory.kind)) return memory;
  }
  return null;
}

const GOAL_KINDS: ReadonlySet<MemoryLinkKind> = new Set(["goal"]);
const PREFERENCE_KINDS: ReadonlySet<MemoryLinkKind> = new Set(["preference", "fact"]);

/**
 * The memories a row earns its two memory reasons from -- by id equality on
 * the two link columns only (see the module comment). A disabled index, a
 * row with no links, or links nothing is attached to all yield `NO_MATCH`.
 */
export function matchMemoriesForRow(index: MemoryIndex, row: MemoryRowLinks): MemoryRowMatch {
  if (!index.enabled) return NO_MATCH;
  const projectBucket =
    row.projectId === undefined || row.projectId === null
      ? undefined
      : index.byProject.get(row.projectId);
  const courseBucket =
    row.canvasCourseId === undefined || row.canvasCourseId === null
      ? undefined
      : index.byCourse.get(row.canvasCourseId);
  const supportsGoal = firstOfKinds(projectBucket, GOAL_KINDS);
  const matchesPreference =
    firstOfKinds(projectBucket, PREFERENCE_KINDS) ?? firstOfKinds(courseBucket, PREFERENCE_KINDS);
  if (supportsGoal === null && matchesPreference === null) return NO_MATCH;
  return { matchesPreference, supportsGoal };
}

/** Projects a match onto the booleans the scorer takes (`FocusNowTaskInput.memory` / `FocusNowAcademicInput.memory`). */
export function memoryMatchFlags(match: MemoryRowMatch): MemoryMatchFlags {
  return {
    matchesPreference: match.matchesPreference !== null,
    supportsGoal: match.supportsGoal !== null,
  };
}

// ---------------------------------------------------------------------------
// Working hours -- the one fixed grammar (see the module comment)
// ---------------------------------------------------------------------------

/**
 * The closed working-hours grammar. Groups: 1 start hour, 2 start minutes,
 * 3 end hour, 4 end minutes. The `hours?` token is required; the separator
 * may be `-`, `–` or `to`; an optional `:`/`-` may follow the word "hours".
 */
export const MEMORY_WORKING_HOURS_PATTERN =
  /\b(?:work|working|study|studying|focus)\s+hours?\s*[:-]?\s*(\d{1,2})(?::(\d{2}))?\s*(?:-|–|to)\s*(\d{1,2})(?::(\d{2}))?\b/i;

/**
 * Parses ONE statement against the grammar. Null unless it matches with
 * hours in 0–23, start < end, and any written minutes equal to `00`.
 */
export function parseWorkingHoursStatement(statement: string): MemoryWorkingHours | null {
  const match = MEMORY_WORKING_HOURS_PATTERN.exec(statement);
  if (match === null) return null;
  const [, startHour, startMinutes, endHour, endMinutes] = match;
  if (startHour === undefined || endHour === undefined) return null;
  if (startMinutes !== undefined && startMinutes !== "00") return null;
  if (endMinutes !== undefined && endMinutes !== "00") return null;
  const dayStartHour = Number(startHour);
  const dayEndHour = Number(endHour);
  if (dayStartHour < 0 || dayStartHour > 23) return null;
  if (dayEndHour < 0 || dayEndHour > 23) return null;
  if (dayStartHour >= dayEndHour) return null;
  return { dayStartHour, dayEndHour };
}

/**
 * The working window the owner's `preference` memories state, or null: the
 * first `preference` memory (by `id`, ascending -- never by array position)
 * whose statement matches the grammar. Only `preference` memories are read;
 * a `goal` or `fact` that happens to contain the phrase is ignored. Disabled
 * ⇒ null.
 */
export function memoryWorkingHours(
  memories: readonly MemoryLinkInput[],
  options: MemoryIndexOptions,
): MemoryWorkingHours | null {
  if (!options.enabled) return null;
  const preferences = memories
    .filter((memory) => memory.kind === "preference")
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const memory of preferences) {
    const hours = parseWorkingHoursStatement(memory.statement);
    if (hours !== null) return hours;
  }
  return null;
}
