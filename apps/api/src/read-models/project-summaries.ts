// Shared project-aggregate collector for Checkpoint 5.2 (GET
// /projects/summaries and GET /projects/:id/detail's computed section).
// Mirrors read-models/today.ts's grouped-query style: one effectiveNow per
// build, per-signal batched queries keyed by project_id, pure predicates
// from @personal-os/core -- never per-project fan-out loops.
import {
  captureEffectiveNow,
  isStalledProject,
  lastProjectActivity,
  pickNextAction,
  type PrioritableTask,
} from "@personal-os/core";
import { events, notes, occurrences, projects, tasks, type Db } from "@personal-os/db";
import { ProjectSummaryItemSchema, type ProjectSummaryItem } from "@personal-os/schema";
import { and, eq, gte, inArray, isNotNull, isNull, lt, sql } from "drizzle-orm";

// Must mirror isStalledProject's default staleAfterDays (packages/core):
// the occurrence query's horizon has to cover exactly the interval the
// predicate treats as disqualifying stall.
const STALL_WINDOW_DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

// Drizzle's raw sql<T> expressions bypass column mappers, so aggregate
// min()/max() over timestamptz arrives as a plain string -- coerce
// explicitly before any Date method use (same as today.ts).
function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value as string);
}

export interface ProjectComputed {
  next_action: {
    task_id: string;
    title: string;
    due_at: string | null;
    priority: number | null;
  } | null;
  stalled: boolean;
  last_activity_at: string | null;
  counts: { open: number; done: number; overdue: number };
}

export interface ProjectSummariesOptions {
  includeArchived?: boolean;
  /** Injected for one-effectiveNow-per-build callers (frozen semantics). */
  now?: Date;
}

interface CandidateRow extends PrioritableTask {
  projectId: string;
  title: string;
}

async function collectProjectComputeds(
  db: Db,
  projectRows: (typeof projects.$inferSelect)[],
  effectiveNow: Date,
): Promise<Map<string, ProjectComputed>> {
  const computeds = new Map<string, ProjectComputed>();
  if (projectRows.length === 0) return computeds;

  const projectIds = projectRows.map((row) => row.id);

  // Eligible = status IN ('inbox','active') AND non-archived. Overdue folds
  // in past scheduled occurrences of the SAME task via EXISTS, so a
  // recurring parent is counted once even when several of its occurrence
  // slots are already past -- counting tasks, not occurrences, makes
  // parent+occurrence double-counting structurally impossible.
  const countsById = new Map(
    (
      await db
        .select({
          projectId: tasks.projectId,
          openCount:
            sql<number>`count(*) filter (where ${tasks.status} in ('inbox','active'))`.mapWith(
              Number,
            ),
          doneCount: sql<number>`count(*) filter (where ${tasks.status} = 'done')`.mapWith(Number),
          overdueCount:
            sql<number>`count(*) filter (where ${tasks.status} in ('inbox','active') and (${tasks.dueAt} < ${effectiveNow} or exists (select 1 from occurrences oc where oc.parent_type = 'task' and oc.parent_id = "tasks"."id" and oc.status = 'scheduled' and oc.occurs_at < ${effectiveNow})))`.mapWith(
              Number,
            ),
        })
        .from(tasks)
        .where(and(isNull(tasks.archivedAt), inArray(tasks.projectId, projectIds)))
        .groupBy(tasks.projectId)
    )
      .filter((row) => row.projectId !== null)
      .map((row) => [row.projectId as string, row]),
  );

  // Activity signals include ARCHIVED children uniformly -- a completion or
  // write is a historical fact regardless of later archiving (5.1 precedent).
  const taskActivityById = new Map(
    (
      await db
        .select({
          projectId: tasks.projectId,
          lastCompletion: sql<Date | null>`max(${tasks.completedAt})`.mapWith(toDateOrNull),
          lastWrite:
            sql<Date | null>`max(greatest(${tasks.createdAt}, ${tasks.updatedAt}))`.mapWith(
              toDateOrNull,
            ),
        })
        .from(tasks)
        .where(and(isNotNull(tasks.projectId), inArray(tasks.projectId, projectIds)))
        .groupBy(tasks.projectId)
    )
      .filter((row) => row.projectId !== null)
      .map((row) => [row.projectId as string, row]),
  );

  const noteActivityById = new Map(
    (
      await db
        .select({
          projectId: notes.projectId,
          lastWrite:
            sql<Date | null>`max(greatest(${notes.createdAt}, ${notes.updatedAt}))`.mapWith(
              toDateOrNull,
            ),
        })
        .from(notes)
        .where(and(isNotNull(notes.projectId), inArray(notes.projectId, projectIds)))
        .groupBy(notes.projectId)
    )
      .filter((row) => row.projectId !== null)
      .map((row) => [row.projectId as string, row]),
  );

  // Occurrence completions attribute to the PARENT TASK's project.
  const occurrenceActivityById = new Map(
    (
      await db
        .select({
          projectId: tasks.projectId,
          lastCompletion: sql<Date | null>`max(${occurrences.completedAt})`.mapWith(toDateOrNull),
        })
        .from(occurrences)
        .innerJoin(tasks, eq(occurrences.parentId, tasks.id))
        .where(
          and(
            eq(occurrences.parentType, "task"),
            isNotNull(occurrences.completedAt),
            isNotNull(tasks.projectId),
            inArray(tasks.projectId, projectIds),
          ),
        )
        .groupBy(tasks.projectId)
    )
      .filter((row) => row.projectId !== null)
      .map((row) => [row.projectId as string, row]),
  );

  const candidatesByProject = new Map<string, CandidateRow[]>();
  for (const row of await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      title: tasks.title,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      createdAt: tasks.createdAt,
    })
    .from(tasks)
    .where(
      and(
        isNull(tasks.archivedAt),
        inArray(tasks.status, ["inbox", "active"]),
        isNotNull(tasks.projectId),
        inArray(tasks.projectId, projectIds),
      ),
    )) {
    if (row.projectId === null) continue;
    const candidate: CandidateRow = { ...row, projectId: row.projectId };
    const list = candidatesByProject.get(candidate.projectId);
    if (list) list.push(candidate);
    else candidatesByProject.set(candidate.projectId, [candidate]);
  }

  // nextLinkedEventStart: min over non-archived TEMPLATE event starts plus
  // scheduled EVENT-TYPE occurrences, both bounded to the stall window
  // [effectiveNow, effectiveNow + staleAfterDays). Outside that window a
  // start neither qualifies nor disqualifies, so bounding here is exactly
  // equivalent to letting the pure predicate apply the horizon (today.ts
  // folds the same two sources into one map).
  const stallHorizon = new Date(effectiveNow.getTime() + STALL_WINDOW_DAYS * DAY_MS);
  const nextEventStarts = new Map(
    (
      await db
        .select({
          projectId: events.projectId,
          nextStart: sql<Date | null>`min(${events.startsAt})`.mapWith(toDateOrNull),
        })
        .from(events)
        .where(
          and(
            isNotNull(events.projectId),
            isNotNull(events.startsAt),
            isNull(events.archivedAt),
            gte(events.startsAt, effectiveNow),
            lt(events.startsAt, stallHorizon),
          ),
        )
        .groupBy(events.projectId)
    )
      .filter((row) => row.projectId !== null)
      .map((row) => [row.projectId as string, row]),
  );
  for (const row of await db
    .select({
      projectId: events.projectId,
      nextStart: sql<Date | null>`min(${occurrences.occursAt})`.mapWith(toDateOrNull),
    })
    .from(occurrences)
    .innerJoin(events, eq(occurrences.parentId, events.id))
    .where(
      and(
        eq(occurrences.parentType, "event"),
        eq(occurrences.status, "scheduled"),
        isNotNull(events.projectId),
        inArray(events.projectId, projectIds),
        gte(occurrences.occursAt, effectiveNow),
        lt(occurrences.occursAt, stallHorizon),
      ),
    )
    .groupBy(events.projectId)) {
    if (row.projectId === null || row.nextStart === null) continue;
    const existing = nextEventStarts.get(row.projectId);
    if (
      existing === undefined ||
      existing.nextStart === null ||
      row.nextStart < existing.nextStart
    ) {
      nextEventStarts.set(row.projectId, { projectId: row.projectId, nextStart: row.nextStart });
    }
  }

  for (const project of projectRows) {
    const id = project.id;
    const countsRow = countsById.get(id);
    const counts = {
      open: countsRow?.openCount ?? 0,
      done: countsRow?.doneCount ?? 0,
      overdue: countsRow?.overdueCount ?? 0,
    };

    const taskActivity = taskActivityById.get(id);
    const noteActivity = noteActivityById.get(id);
    const occurrenceActivity = occurrenceActivityById.get(id);
    const lastActivityAt = lastProjectActivity({
      taskCompletions: taskActivity?.lastCompletion ? [taskActivity.lastCompletion] : [],
      taskWrites: taskActivity?.lastWrite ? [taskActivity.lastWrite] : [],
      noteWrites: noteActivity?.lastWrite ? [noteActivity.lastWrite] : [],
      occurrenceCompletions: occurrenceActivity?.lastCompletion
        ? [occurrenceActivity.lastCompletion]
        : [],
    });

    const winner = pickNextAction(candidatesByProject.get(id) ?? []);

    computeds.set(id, {
      next_action: winner
        ? {
            task_id: winner.id,
            title: winner.title,
            due_at: winner.dueAt ? winner.dueAt.toISOString() : null,
            priority: winner.priority,
          }
        : null,
      // Archiving is a separate axis from lifecycle status (ADR-039); an
      // archived project is NEVER reported stalled even when its underlying
      // status is still 'active'.
      stalled:
        project.archivedAt === null &&
        isStalledProject({
          status: project.status,
          openTaskCount: counts.open,
          lastActivityAt,
          nextLinkedEventStart: nextEventStarts.get(id)?.nextStart ?? null,
          effectiveNow,
        }),
      last_activity_at: lastActivityAt ? lastActivityAt.toISOString() : null,
      counts,
    });
  }

  return computeds;
}

// Single source of truth for the base-row wire mapping -- routes and read
// models must not drift apart on the frozen ProjectSchema field names.
export function toProjectPayload(row: typeof projects.$inferSelect) {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    color: row.color,
    goal: row.goal,
    target_date: row.targetDate ?? null,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  };
}

function summaryRank(row: typeof projects.$inferSelect): number {
  if (row.archivedAt !== null) return 3;
  switch (row.status) {
    case "paused":
      return 1;
    case "completed":
      return 2;
    default:
      return 0;
  }
}

/** Full enriched list for GET /projects/summaries: base rows plus the shared
 * aggregates, group-ranked active < paused < completed < archived with name
 * ASC inside each group, every row ProjectSummaryItemSchema-parsed. */
export async function computeProjectSummaries(
  db: Db,
  options: ProjectSummariesOptions = {},
): Promise<ProjectSummaryItem[]> {
  const effectiveNow = options.now ?? captureEffectiveNow();
  const rows = await db
    .select()
    .from(projects)
    .where(options.includeArchived ? undefined : isNull(projects.archivedAt));
  if (rows.length === 0) return [];

  const computeds = await collectProjectComputeds(db, rows, effectiveNow);

  rows.sort((a, b) => {
    const rank = summaryRank(a) - summaryRank(b);
    if (rank !== 0) return rank;
    if (a.name < b.name) return -1;
    if (a.name > b.name) return 1;
    return 0;
  });

  return rows.map((row) =>
    ProjectSummaryItemSchema.parse({
      ...toProjectPayload(row),
      ...(computeds.get(row.id) ?? {
        next_action: null,
        stalled: false,
        last_activity_at: null,
        counts: { open: 0, done: 0, overdue: 0 },
      }),
    }),
  );
}

/** Computed section for GET /projects/:id/detail, built from the same batched
 * machinery as summaries but scoped to one project. Callers 404 unknown ids
 * first; a missing row yields an all-zero aggregate rather than an error. */
export async function computeProjectComputed(
  db: Db,
  projectId: string,
): Promise<ProjectComputed | null> {
  const effectiveNow = captureEffectiveNow();
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row) return null;
  const computeds = await collectProjectComputeds(db, [row], effectiveNow);
  return computeds.get(projectId) ?? null;
}
