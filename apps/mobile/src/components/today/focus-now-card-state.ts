import type {
  AcademicPriorityItem,
  AcademicTodayResponse,
  TodayResponse,
  TodayTaskItem,
} from "@personal-os/schema";
import { academicTodayWindows } from "@personal-os/core/academic/buckets";
import {
  explainFocusNowCandidate,
  type FocusNowCandidateExplanation,
} from "@personal-os/core/focus-now/explain";
import {
  FOCUS_NOW_CAP,
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  mergeLinkedCandidates,
  rankFocusNowCandidates,
  type FocusNowCandidate,
} from "@personal-os/core/focus-now/score";
import {
  buildMemoryIndex,
  matchMemoriesForRow,
  memoryMatchFlags,
  type MemoryIndex,
  type MemoryLinkInput,
  type MemoryRowMatch,
} from "@personal-os/core/memory/match";

// Pure, React-free rendering rules for the "Focus Now" card (Checkpoint
// 10.4, ADR-072; context reasons, the linked-assignment merge and the
// explanation added by Checkpoint 10.6, ADR-075) -- the same split
// academic-today-card-state.ts uses: the decision of WHAT the card shows is
// tested here as data, and focus-now-card.tsx only lays it out.
//
// This is the ONE client-side merge of `GET /today` and `GET /academic/
// today` into a single ranked list. It exists on the client because
// `apps/api/src/ask/ai-egress-guard.test.ts`'s Guard 5 forbids every
// read-model file (today.ts included) from importing the academic read
// model, so a server-side merge is structurally off the table -- see
// packages/core/src/focus-now/score.ts's own header for the full argument.
// Nothing here re-derives an academic score; `packages/core` does the
// scoring (a task's, freshly; an assignment's, verbatim) and this file only
// feeds it the context every row already carries on the wire and shapes the
// two already-scored lists for the screen.
//
// CONTEXT INPUTS (ADR-075 §2), each read from the response it lives on:
//   a task's `canvas_assignment_id`  -> the merge key (ADR-075 §3)
//   a task's `remind_at`             -> `reminder_set` (informational)
//   a task's `snoozed_until`         -> `snoozed` (informational)
//   a task's project's `stalled`     -> `project_stalled` (+25), looked up
//                                       by `project_id` in `today.projects`
//   an assignment's submission status -> `no_submission` (informational)
//   its course's attention `high`     -> `course_attention_high` (+25),
//                                       looked up in `course_attention`
//
// MEMORY INPUTS (Checkpoint 10.7, ADR-077 §5), by TYPED LINK ONLY, through
// core's `memory/match` -- never by text, never by a model:
//   a task's `project_id`            -> a `goal` memory linked to that
//                                       project: `supports_goal` (+15); a
//                                       `preference`/`fact` memory linked to
//                                       it: `matches_preference` (+15)
//   a task's `canvas_assignment_id`  -> the COURSE of that assignment, when
//                                       the assignment is among today's
//                                       priority items (looked up there; no
//                                       other source is consulted), so a
//                                       course-linked preference reaches the
//                                       task too
//   an assignment's `course_id`      -> a `preference`/`fact` memory linked
//                                       to that course: `matches_preference`
// The scorer receives only the two booleans (`memoryMatchFlags`); the matched
// memories ride on the row as `memoryMatch` so the explanation can say
// "You said: <statement>". A merged task+assignment row (below) unions the
// two sides' matches and, through core's reason union, earns each memory
// bonus ONCE. With the switch off, or while the memory queries have not
// loaded or have errored, `memory` is absent and nothing here changes.

/** The memory inputs `focusNowRows` takes (from `memory-inputs.ts`'s projection of the two memory queries). */
export interface FocusNowMemoryOptions {
  /** Every memory as a typed-link input; null when absent (loading, errored, or the switch off). */
  memories: readonly MemoryLinkInput[] | null;
  /** `memory_settings.enabled`; false makes every memory absent (ADR-077 §7). */
  memoryEnabled: boolean;
}

export interface FocusNowTaskRow extends FocusNowCandidate {
  kind: "task";
  task: TodayTaskItem;
  /** The memories this row's two memory reasons came from (ADR-077 §5); null when none matched. */
  memoryMatch: MemoryRowMatch | null;
  /**
   * The priority item this task was merged with (ADR-075 §3): the task IS
   * the row, but the assignment's course label and Canvas link still render
   * from here. Null for an unlinked task, or one linked to an assignment
   * that is not among today's candidates.
   */
  linkedPriorityItem: AcademicPriorityItem | null;
}

export interface FocusNowAcademicRow extends FocusNowCandidate {
  kind: "academic_assignment";
  priorityItem: AcademicPriorityItem;
  /** The memories this row's two memory reasons came from (ADR-077 §5); null when none matched. */
  memoryMatch: MemoryRowMatch | null;
}

export type FocusNowRow = FocusNowTaskRow | FocusNowAcademicRow;

function toDate(iso: string | null | undefined): Date | null {
  return iso === null || iso === undefined ? null : new Date(iso);
}

const NO_MEMORY: MemoryIndex = buildMemoryIndex([], { enabled: false });

/** The index the rows match against: empty (matches nothing) whenever memory is absent or switched off. */
function memoryIndexFor(memory: FocusNowMemoryOptions | undefined): MemoryIndex {
  if (memory === undefined || memory.memories === null || !memory.memoryEnabled) return NO_MEMORY;
  return buildMemoryIndex(memory.memories, { enabled: true });
}

/** A match with at least one memory, or null -- so a row without memory evidence carries `null`, never two nulls. */
function matchOrNull(match: MemoryRowMatch): MemoryRowMatch | null {
  return match.matchesPreference === null && match.supportsGoal === null ? null : match;
}

/**
 * `assignment id -> course id` over today's priority items -- the ONLY
 * place a task's `canvas_assignment_id` is resolved to a course, so a
 * course-linked preference can reach a task linked to one of today's
 * assignments. A task linked to an assignment that is not a candidate today
 * resolves to no course (nothing else is consulted).
 */
function courseIdByAssignmentId(academic: AcademicTodayResponse): Map<string, string> {
  return new Map(
    (academic.priorities?.items ?? []).map((item) => [
      item.assignment.id,
      item.assignment.course_id,
    ]),
  );
}

/** `project_id -> stalled` over Today's own project summaries (docs/ARCHITECTURE.md rule 8, server-computed). */
function stalledProjectIds(today: TodayResponse): Set<string> {
  return new Set(
    today.projects.items.filter((project) => project.stalled).map((project) => project.id),
  );
}

/** Today's overdue + due-today tasks, scored on the shared ladder. Today has no `due_this_week` bucket of its own. */
function taskRows(
  today: TodayResponse,
  academic: AcademicTodayResponse,
  effectiveNow: Date,
  horizonEndUtc: Date,
  memory: MemoryIndex,
): FocusNowTaskRow[] {
  const stalled = stalledProjectIds(today);
  const courseByAssignment = courseIdByAssignmentId(academic);
  const items = [...today.overdue.items, ...today.due_today.items];
  return items.map((task) => {
    const canvasAssignmentId = task.canvas_assignment_id ?? null;
    const match = matchMemoriesForRow(memory, {
      projectId: task.project_id,
      canvasCourseId:
        canvasAssignmentId === null ? null : (courseByAssignment.get(canvasAssignmentId) ?? null),
    });
    return {
      ...focusNowCandidateFromTask(
        {
          id: task.id,
          title: task.title,
          dueAt: toDate(task.due_at),
          priority: task.priority,
          canvasAssignmentId,
          remindAt: toDate(task.remind_at),
          snoozedUntil: toDate(task.snoozed_until),
          projectStalled: task.project_id !== null && stalled.has(task.project_id),
          memory: memoryMatchFlags(match),
        },
        effectiveNow,
        horizonEndUtc,
      ),
      kind: "task",
      task,
      linkedPriorityItem: null,
      memoryMatch: matchOrNull(match),
    };
  });
}

/** The course ids the server rates at attention `high` (ADR-071); an older server omits the key. */
function highAttentionCourseIds(academic: AcademicTodayResponse): Set<string> {
  return new Set(
    (academic.course_attention?.items ?? [])
      .filter((course) => course.attention === "high")
      .map((course) => course.course_id),
  );
}

/** The academic Today response's already-ranked "Do next" candidates, wrapped verbatim. */
function academicRows(academic: AcademicTodayResponse, memory: MemoryIndex): FocusNowAcademicRow[] {
  const highAttention = highAttentionCourseIds(academic);
  const items = academic.priorities?.items ?? [];
  return items.map((priorityItem) => {
    const match = matchMemoriesForRow(memory, {
      canvasCourseId: priorityItem.assignment.course_id,
    });
    return {
      ...focusNowCandidateFromAcademic({
        id: priorityItem.assignment.id,
        title: priorityItem.assignment.title,
        dueAt: toDate(priorityItem.assignment.due_at),
        score: priorityItem.score,
        reasons: priorityItem.reasons,
        submissionUnsubmitted: priorityItem.assignment.submission.status === "unsubmitted",
        courseAttentionHigh: highAttention.has(priorityItem.assignment.course_id),
        memory: memoryMatchFlags(match),
      }),
      kind: "academic_assignment",
      priorityItem,
      memoryMatch: matchOrNull(match),
    };
  });
}

/**
 * The merged row's memory evidence: per reason, the task's own matched
 * memory first (core's own project-before-course selection order), else the
 * assignment's. Core's `mergeLinkedCandidates` already unions the REASONS,
 * so a preference both sides matched is one `matches_preference` and +15
 * once (ADR-077 §5); this only keeps the memory the sheet will name.
 */
function mergeMemoryMatches(
  task: MemoryRowMatch | null,
  academic: MemoryRowMatch | null,
): MemoryRowMatch | null {
  if (task === null) return academic;
  if (academic === null) return task;
  return {
    matchesPreference: task.matchesPreference ?? academic.matchesPreference,
    supportsGoal: task.supportsGoal ?? academic.supportsGoal,
  };
}

/**
 * Core's `mergeLinkedCandidates` collapses a linked task and its assignment
 * into one `task` row but only knows the candidate shape; this re-attaches
 * the consumed priority item to the surviving task row so the screen can
 * still show the course and offer the Canvas link.
 */
function mergeRows(rows: readonly FocusNowRow[]): FocusNowRow[] {
  const academicById = new Map<string, FocusNowAcademicRow>();
  for (const row of rows) {
    if (row.kind === "academic_assignment") academicById.set(row.id, row);
  }
  return mergeLinkedCandidates(rows).map((row) => {
    if (row.kind !== "task" || row.linkedAssignmentId === null) return row;
    const linked = academicById.get(row.linkedAssignmentId) ?? null;
    return linked === null
      ? row
      : {
          ...row,
          linkedPriorityItem: linked.priorityItem,
          memoryMatch: mergeMemoryMatches(row.memoryMatch, linked.memoryMatch),
        };
  });
}

/**
 * The merged, ranked, capped Focus Now list, or null when the card should
 * render nothing: either source not yet loaded, an unreadable device
 * timezone, or (once merged) nothing to show. `effectiveNow` is the
 * caller's one instant -- Today's own query `dataUpdatedAt`, never a clock
 * read in render. `memory` is optional and never gates the list (ADR-077
 * §5's soft degradation): absent, loading or switched off, the rows are
 * exactly the pre-10.7 rows.
 */
export function focusNowRows(
  today: TodayResponse | undefined,
  academic: AcademicTodayResponse | undefined,
  effectiveNow: Date,
  memory?: FocusNowMemoryOptions,
): FocusNowRow[] | null {
  if (today === undefined || academic === undefined) return null;

  let horizonEndUtc: Date;
  try {
    horizonEndUtc = academicTodayWindows(today.tz, effectiveNow).horizonEndUtc;
  } catch {
    // An unknown zone cannot define a local day (the same guard
    // components/academic/assignment-urgency.ts's urgencyContext applies) --
    // no rows is safer than a wrong ladder.
    return null;
  }

  const index = memoryIndexFor(memory);
  const rows: FocusNowRow[] = [
    ...taskRows(today, academic, effectiveNow, horizonEndUtc, index),
    ...academicRows(academic, index),
  ];
  if (rows.length === 0) return null;
  return rankFocusNowCandidates(mergeRows(rows)).slice(0, FOCUS_NOW_CAP);
}

/**
 * The row's explanation (ADR-075 §1): every reason with its why and source,
 * and the auditable equation. The row's own `memoryMatch` is what lets a
 * memory reason read "You said: <statement>" (ADR-077 §5) -- so the task
 * sheet, the assignment sheet and the briefing, which all receive the ROW,
 * name the memory without a second lookup.
 */
export function focusNowExplanation(row: FocusNowRow): FocusNowCandidateExplanation {
  return explainFocusNowCandidate(row, { memory: row.memoryMatch });
}

/** The priority item a row can show assignment detail for: its own, or the one it was merged with. */
export function focusNowRowPriorityItem(row: FocusNowRow): AcademicPriorityItem | null {
  return row.kind === "academic_assignment" ? row.priorityItem : row.linkedPriorityItem;
}
