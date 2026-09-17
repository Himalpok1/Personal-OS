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

export interface FocusNowTaskRow extends FocusNowCandidate {
  kind: "task";
  task: TodayTaskItem;
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
}

export type FocusNowRow = FocusNowTaskRow | FocusNowAcademicRow;

function toDate(iso: string | null | undefined): Date | null {
  return iso === null || iso === undefined ? null : new Date(iso);
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
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowTaskRow[] {
  const stalled = stalledProjectIds(today);
  const items = [...today.overdue.items, ...today.due_today.items];
  return items.map((task) => ({
    ...focusNowCandidateFromTask(
      {
        id: task.id,
        title: task.title,
        dueAt: toDate(task.due_at),
        priority: task.priority,
        canvasAssignmentId: task.canvas_assignment_id ?? null,
        remindAt: toDate(task.remind_at),
        snoozedUntil: toDate(task.snoozed_until),
        projectStalled: task.project_id !== null && stalled.has(task.project_id),
      },
      effectiveNow,
      horizonEndUtc,
    ),
    kind: "task",
    task,
    linkedPriorityItem: null,
  }));
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
function academicRows(academic: AcademicTodayResponse): FocusNowAcademicRow[] {
  const highAttention = highAttentionCourseIds(academic);
  const items = academic.priorities?.items ?? [];
  return items.map((priorityItem) => ({
    ...focusNowCandidateFromAcademic({
      id: priorityItem.assignment.id,
      title: priorityItem.assignment.title,
      dueAt: toDate(priorityItem.assignment.due_at),
      score: priorityItem.score,
      reasons: priorityItem.reasons,
      submissionUnsubmitted: priorityItem.assignment.submission.status === "unsubmitted",
      courseAttentionHigh: highAttention.has(priorityItem.assignment.course_id),
    }),
    kind: "academic_assignment",
    priorityItem,
  }));
}

/**
 * Core's `mergeLinkedCandidates` collapses a linked task and its assignment
 * into one `task` row but only knows the candidate shape; this re-attaches
 * the consumed priority item to the surviving task row so the screen can
 * still show the course and offer the Canvas link.
 */
function mergeRows(rows: readonly FocusNowRow[]): FocusNowRow[] {
  const priorityById = new Map<string, AcademicPriorityItem>();
  for (const row of rows) {
    if (row.kind === "academic_assignment") priorityById.set(row.id, row.priorityItem);
  }
  return mergeLinkedCandidates(rows).map((row) => {
    if (row.kind !== "task" || row.linkedAssignmentId === null) return row;
    const linked = priorityById.get(row.linkedAssignmentId) ?? null;
    return linked === null ? row : { ...row, linkedPriorityItem: linked };
  });
}

/**
 * The merged, ranked, capped Focus Now list, or null when the card should
 * render nothing: either source not yet loaded, an unreadable device
 * timezone, or (once merged) nothing to show. `effectiveNow` is the
 * caller's one instant -- Today's own query `dataUpdatedAt`, never a clock
 * read in render.
 */
export function focusNowRows(
  today: TodayResponse | undefined,
  academic: AcademicTodayResponse | undefined,
  effectiveNow: Date,
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

  const rows: FocusNowRow[] = [
    ...taskRows(today, effectiveNow, horizonEndUtc),
    ...academicRows(academic),
  ];
  if (rows.length === 0) return null;
  return rankFocusNowCandidates(mergeRows(rows)).slice(0, FOCUS_NOW_CAP);
}

/** The row's explanation (ADR-075 §1): every reason with its why and source, and the auditable equation. */
export function focusNowExplanation(row: FocusNowRow): FocusNowCandidateExplanation {
  return explainFocusNowCandidate(row);
}

/** The priority item a row can show assignment detail for: its own, or the one it was merged with. */
export function focusNowRowPriorityItem(row: FocusNowRow): AcademicPriorityItem | null {
  return row.kind === "academic_assignment" ? row.priorityItem : row.linkedPriorityItem;
}
