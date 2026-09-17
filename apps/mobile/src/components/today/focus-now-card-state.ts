import type {
  AcademicPriorityItem,
  AcademicTodayResponse,
  TodayResponse,
  TodayTaskItem,
} from "@personal-os/schema";
import { academicTodayWindows } from "@personal-os/core/academic/buckets";
import {
  FOCUS_NOW_CAP,
  focusNowCandidateFromAcademic,
  focusNowCandidateFromTask,
  rankFocusNowCandidates,
  type FocusNowCandidate,
} from "@personal-os/core/focus-now/score";

// Pure, React-free rendering rules for the "Focus Now" card (Checkpoint
// 10.4, ADR-072) -- the same split academic-today-card-state.ts uses: the
// decision of WHAT the card shows is tested here as data, and
// focus-now-card.tsx only lays it out.
//
// This is the ONE client-side merge of `GET /today` and `GET /academic/
// today` into a single ranked list. It exists on the client because
// `apps/api/src/ask/ai-egress-guard.test.ts`'s Guard 5 forbids every
// read-model file (today.ts included) from importing the academic read
// model, so a server-side merge is structurally off the table -- see
// packages/core/src/focus-now/score.ts's own header for the full argument.
// Nothing here re-derives an academic score; `packages/core` does the
// scoring (a task's, freshly; an assignment's, verbatim) and this file only
// interleaves and shapes the two already-scored lists for the screen.

export interface FocusNowTaskRow extends FocusNowCandidate {
  kind: "task";
  task: TodayTaskItem;
}

export interface FocusNowAcademicRow extends FocusNowCandidate {
  kind: "academic_assignment";
  priorityItem: AcademicPriorityItem;
}

export type FocusNowRow = FocusNowTaskRow | FocusNowAcademicRow;

function toDate(iso: string | null): Date | null {
  return iso === null ? null : new Date(iso);
}

/** Today's overdue + due-today tasks, scored on the shared ladder. Today has no `due_this_week` bucket of its own. */
function taskRows(
  today: TodayResponse,
  effectiveNow: Date,
  horizonEndUtc: Date,
): FocusNowTaskRow[] {
  const items = [...today.overdue.items, ...today.due_today.items];
  return items.map((task) => ({
    ...focusNowCandidateFromTask(
      { id: task.id, title: task.title, dueAt: toDate(task.due_at), priority: task.priority },
      effectiveNow,
      horizonEndUtc,
    ),
    kind: "task",
    task,
  }));
}

/** The academic Today response's already-ranked "Do next" candidates, wrapped verbatim. */
function academicRows(academic: AcademicTodayResponse): FocusNowAcademicRow[] {
  const items = academic.priorities?.items ?? [];
  return items.map((priorityItem) => ({
    ...focusNowCandidateFromAcademic({
      id: priorityItem.assignment.id,
      title: priorityItem.assignment.title,
      dueAt: toDate(priorityItem.assignment.due_at),
      score: priorityItem.score,
      reasons: priorityItem.reasons,
    }),
    kind: "academic_assignment",
    priorityItem,
  }));
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
  return rankFocusNowCandidates(rows).slice(0, FOCUS_NOW_CAP);
}
