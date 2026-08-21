// Pure project-lifecycle invariants for the Phase 5 computed read models
// (docs/ARCHITECTURE.md "Today & agenda read models" items 6-8, ADR-039).
// No DB imports: everything here runs on plain values so apps/api and the
// mobile UI cannot disagree about next-action ordering or stall detection.

export const PROJECT_STATUSES = ["active", "paused", "completed"] as const;
export type ProjectStatus = (typeof PROJECT_STATUSES)[number];

/** Status transitions only. Archiving is the separate `archived_at` axis
 * (ADR-039 axis-collision rule); no predicate here consults it. */
export function canPauseProject(status: ProjectStatus): boolean {
  return status === "active";
}

export function canResumeProject(status: ProjectStatus): boolean {
  return status === "paused";
}

export function canCompleteProject(status: ProjectStatus): boolean {
  return status === "active" || status === "paused";
}

export function canReopenProject(status: ProjectStatus): boolean {
  return status === "completed";
}

export const PROJECT_TRANSITIONS: Record<ProjectStatus, readonly ProjectStatus[]> = {
  active: ["paused", "completed"],
  paused: ["active", "completed"],
  completed: ["active"],
};

/** tasks.priority is a nullable unconstrained smallint written only by AI
 * capture. FROZEN convention (read-model item 6): lower value = higher
 * priority, P1-style; nothing may assume otherwise without changing that rule. */
export interface PrioritableTask {
  id: string;
  dueAt: Date | null;
  priority: number | null;
  createdAt: Date | null;
}

function compareNullableAsc(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** FROZEN comparator (read-model item 7): dueAt ASC NULLS LAST ->
 * priority ASC NULLS LAST (lower wins) -> createdAt DESC NULLS LAST ->
 * id ASC lexicographic. Pure ms math, DST-irrelevant, deterministic. */
export function compareNextAction(a: PrioritableTask, b: PrioritableTask): number {
  if (a.dueAt !== null && b.dueAt !== null) {
    const due = a.dueAt.getTime() - b.dueAt.getTime();
    if (due !== 0) return due < 0 ? -1 : 1;
  } else if (a.dueAt === null && b.dueAt !== null) {
    return 1;
  } else if (a.dueAt !== null && b.dueAt === null) {
    return -1;
  }

  const priority = compareNullableAsc(a.priority, b.priority);
  if (priority !== 0) return priority;

  if (a.createdAt !== null && b.createdAt !== null) {
    const created = b.createdAt.getTime() - a.createdAt.getTime();
    if (created !== 0) return created < 0 ? -1 : 1;
  } else if (a.createdAt === null && b.createdAt !== null) {
    return 1;
  } else if (a.createdAt !== null && b.createdAt === null) {
    return -1;
  }

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** The single project next action per the frozen order, or null when the
 * project has no candidate tasks. */
export function pickNextAction<T extends PrioritableTask>(tasks: Iterable<T>): T | null {
  let best: T | null = null;
  for (const task of tasks) {
    if (best === null || compareNextAction(task, best) < 0) best = task;
  }
  return best;
}

export interface ProjectActivitySignals {
  taskCompletions: Date[];
  noteWrites: Date[];
  occurrenceCompletions: Date[];
}

export function lastProjectActivity(signals: ProjectActivitySignals): Date | null {
  let latest: Date | null = null;
  for (const at of [
    ...signals.taskCompletions,
    ...signals.noteWrites,
    ...signals.occurrenceCompletions,
  ]) {
    if (latest === null || at.getTime() > latest.getTime()) latest = at;
  }
  return latest;
}

export interface StalledProjectInput {
  status: string;
  openTaskCount: number;
  lastActivityAt: Date | null;
  nextLinkedEventStart: Date | null;
  effectiveNow: Date;
  staleAfterDays?: number;
}

/** FROZEN stall rule (read-model item 8): an active project with >= 1 open
 * task is stalled when its last activity signal is >= staleAfterDays old
 * (never any signal => stalled) AND no linked event starts within the
 * window [effectiveNow, effectiveNow + staleAfterDays). A past event or one
 * beyond the window neither qualifies nor disqualifies. */
export function isStalledProject(input: StalledProjectInput): boolean {
  if (input.status !== "active") return false;
  if (input.openTaskCount < 1) return false;

  const windowMs = (input.staleAfterDays ?? 14) * 24 * 60 * 60 * 1000;
  const nowMs = input.effectiveNow.getTime();

  if (
    input.nextLinkedEventStart !== null &&
    nowMs <= input.nextLinkedEventStart.getTime() &&
    input.nextLinkedEventStart.getTime() < nowMs + windowMs
  ) {
    return false;
  }

  if (input.lastActivityAt === null) return true;
  return nowMs - input.lastActivityAt.getTime() >= windowMs;
}

export interface ProjectProgressInput {
  openTaskCount: number;
  overdueTaskCount: number;
  doneTaskCount: number;
  lastActivityAt: Date | null;
}

export interface ProjectProgress {
  open: number;
  overdue: number;
  done: number;
  lastActivityAt: Date | null;
}

/** Identity-style pass-through: UIs render honest stored/derived counts.
 * No percentages, nothing additionally derived. */
export function computeProjectProgress(input: ProjectProgressInput): ProjectProgress {
  return {
    open: input.openTaskCount,
    overdue: input.overdueTaskCount,
    done: input.doneTaskCount,
    lastActivityAt: input.lastActivityAt,
  };
}
