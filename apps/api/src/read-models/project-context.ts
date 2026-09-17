// GET /projects/:id/detail's task/event section queries, extracted so
// GET /projects/:id/context (Checkpoint 10.5) reuses them instead of
// duplicating the same filter/ordering SQL a second time -- routes/projects.ts
// calls fetchProjectTaskSection/fetchProjectEventSection for /detail exactly
// as it did inline before this file existed; nothing about /detail's
// response shape changed.
//
// PRIVACY BOUNDARY (Checkpoint 10.5): this file selects `tasks.canvas_
// assignment_id` -- a plain uuid column on the tasks row, provenance the
// OWNER set on their own task -- and returns it as an opaque id only. It
// imports nothing from `@personal-os/canvas-providers`, never queries a
// canvas_* table, and never surfaces a Canvas-authored title or course name.
// Guard 5 (apps/api/src/ask/ai-egress-guard.test.ts) does not apply to this
// file directly -- it is not read-models/academic.ts and it lives outside
// every AI lane directory -- and this boundary is additionally structural:
// there is no canvas_* table binding anywhere in this file for a future edit
// to accidentally widen.
import { captureEffectiveNow } from "@personal-os/core";
import { events, inboxItems, notes, occurrences, projects, tasks, type Db } from "@personal-os/db";
import {
  PROJECT_CONTEXT_EVENTS_ITEM_CAP,
  PROJECT_CONTEXT_RECENT_ACTIVITY_ITEM_CAP,
  PROJECT_CONTEXT_RECENT_ACTIVITY_WINDOW_DAYS,
  PROJECT_CONTEXT_RELATED_CAPTURES_ITEM_CAP,
  PROJECT_CONTEXT_TASKS_ITEM_CAP,
  ProjectContextResponseSchema,
  type ProjectActivityItem,
  type ProjectActivityType,
  type ProjectContextResponse,
  type ProjectContextTask,
  type ProjectDetailEvent,
  type ProjectDetailTask,
  type ProjectRelatedCapture,
} from "@personal-os/schema";
import { and, asc, count, eq, gte, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import { toProjectPayload } from "./project-summaries.js";

const DAY_MS = 24 * 60 * 60 * 1000;
const compareStrings = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

// ---------------------------------------------------------------------------
// Shared task/event section queries (reused by routes/projects.ts's own
// /detail handler -- see its call sites)
// ---------------------------------------------------------------------------

interface ProjectTaskRow {
  id: string;
  title: string;
  status: string;
  dueAt: Date | null;
  priority: number | null;
  rrule: string | null;
  completedAt: Date | null;
  canvasAssignmentId: string | null;
}

/** Open statuses first (due_at ASC NULLS LAST, then newest-created), closed
 * statuses after by completed_at DESC NULLS LAST; id tiebreak. The exact
 * ordering GET /projects/:id/detail has used since Checkpoint 5.2. */
export async function fetchProjectTaskSection(
  db: Db,
  projectId: string,
  limit: number,
): Promise<{ items: ProjectTaskRow[]; total: number }> {
  const items = await db
    .select({
      id: tasks.id,
      title: tasks.title,
      status: tasks.status,
      dueAt: tasks.dueAt,
      priority: tasks.priority,
      rrule: tasks.rrule,
      completedAt: tasks.completedAt,
      canvasAssignmentId: tasks.canvasAssignmentId,
    })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)))
    .orderBy(
      sql`case when ${tasks.status} in ('inbox','active') then 0 else 1 end`,
      sql`case when ${tasks.status} in ('inbox','active') then ${tasks.dueAt} end asc nulls last`,
      sql`case when ${tasks.status} in ('inbox','active') then ${tasks.createdAt} end desc`,
      sql`case when ${tasks.status} in ('done','dropped') then ${tasks.completedAt} end desc nulls last`,
      asc(tasks.id),
    )
    .limit(limit);
  const [totalRow] = await db
    .select({ total: count() })
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt)));
  return { items, total: Number(totalRow?.total ?? 0) };
}

export function toDetailTaskItem(row: ProjectTaskRow): ProjectDetailTask {
  return {
    id: row.id,
    title: row.title,
    status: row.status as ProjectDetailTask["status"],
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    priority: row.priority,
    rrule: row.rrule,
    completed_at: row.completedAt ? row.completedAt.toISOString() : null,
  };
}

export function toContextTaskItem(row: ProjectTaskRow): ProjectContextTask {
  return { ...toDetailTaskItem(row), canvas_assignment_id: row.canvasAssignmentId };
}

interface ProjectEventRow {
  id: string;
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
  startDate: string | null;
  endDate: string | null;
  location: string | null;
  rrule: string | null;
}

/** Series rows only -- detached occurrence children (parent_event_id IS NOT
 * NULL) excluded so an overridden instance never duplicates its series. */
export async function fetchProjectEventSection(
  db: Db,
  projectId: string,
  limit: number,
): Promise<{ items: ProjectEventRow[]; total: number }> {
  const filter = and(
    eq(events.projectId, projectId),
    isNull(events.archivedAt),
    isNull(events.parentEventId),
  );
  const items = await db
    .select({
      id: events.id,
      title: events.title,
      startsAt: events.startsAt,
      endsAt: events.endsAt,
      allDay: events.allDay,
      startDate: events.startDate,
      endDate: events.endDate,
      location: events.location,
      rrule: events.rrule,
    })
    .from(events)
    .where(filter)
    .orderBy(sql`${events.startsAt} desc nulls last`, asc(events.id))
    .limit(limit);
  const [totalRow] = await db.select({ total: count() }).from(events).where(filter);
  return { items, total: Number(totalRow?.total ?? 0) };
}

export function toDetailEventItem(row: ProjectEventRow): ProjectDetailEvent {
  return {
    id: row.id,
    title: row.title,
    starts_at: row.startsAt ? row.startsAt.toISOString() : null,
    ends_at: row.endsAt ? row.endsAt.toISOString() : null,
    all_day: row.allDay,
    start_date: row.startDate ?? null,
    end_date: row.endDate ?? null,
    location: row.location,
    rrule: row.rrule,
  };
}

// ---------------------------------------------------------------------------
// GET /projects/:id/context only, from here down
// ---------------------------------------------------------------------------

/** Every unarchived task/note/event id belonging to this project -- the
 * COMPLETE membership set, not the capped display sections above, so the
 * capture join below cannot miss a capture whose entity fell outside a
 * section's cap. */
async function fetchProjectEntityIds(
  db: Db,
  projectId: string,
): Promise<{ taskIds: string[]; noteIds: string[]; eventIds: string[] }> {
  const [taskRows, noteRows, eventRows] = await Promise.all([
    db
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.projectId, projectId), isNull(tasks.archivedAt))),
    db
      .select({ id: notes.id })
      .from(notes)
      .where(and(eq(notes.projectId, projectId), isNull(notes.archivedAt))),
    db
      .select({ id: events.id })
      .from(events)
      .where(and(eq(events.projectId, projectId), isNull(events.archivedAt))),
  ]);
  return {
    taskIds: taskRows.map((r) => r.id),
    noteIds: noteRows.map((r) => r.id),
    eventIds: eventRows.map((r) => r.id),
  };
}

function compareCapturesNewestFirst(a: ProjectRelatedCapture, b: ProjectRelatedCapture): number {
  const delta = new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime();
  if (delta !== 0) return delta < 0 ? -1 : 1;
  return compareStrings(a.id, b.id);
}

/** Captures that BECAME one of this project's own items -- a deterministic
 * join through inbox_items.entity_type/entity_id against the COMPLETE
 * membership set above, never a text match or a guess. Archived captures are
 * excluded, matching Today's own inbox-count convention. */
async function fetchRelatedCaptures(
  db: Db,
  ids: { taskIds: string[]; noteIds: string[]; eventIds: string[] },
): Promise<{ items: ProjectRelatedCapture[]; total: number }> {
  const entityMatches = [
    ids.taskIds.length > 0
      ? and(eq(inboxItems.entityType, "task"), inArray(inboxItems.entityId, ids.taskIds))
      : undefined,
    ids.noteIds.length > 0
      ? and(eq(inboxItems.entityType, "note"), inArray(inboxItems.entityId, ids.noteIds))
      : undefined,
    ids.eventIds.length > 0
      ? and(eq(inboxItems.entityType, "event"), inArray(inboxItems.entityId, ids.eventIds))
      : undefined,
  ].filter((clause): clause is NonNullable<typeof clause> => clause !== undefined);
  if (entityMatches.length === 0) return { items: [], total: 0 };

  const rows = await db
    .select({
      id: inboxItems.id,
      rawText: inboxItems.rawText,
      source: inboxItems.source,
      status: inboxItems.status,
      capturedAt: inboxItems.capturedAt,
      entityType: inboxItems.entityType,
      entityId: inboxItems.entityId,
    })
    .from(inboxItems)
    .where(and(isNull(inboxItems.archivedAt), or(...entityMatches)));

  const items: ProjectRelatedCapture[] = rows.map((row) => ({
    id: row.id,
    raw_text: row.rawText,
    source: row.source,
    status: row.status,
    captured_at: row.capturedAt.toISOString(),
    // Safe: this row matched one of the entity-typed clauses above, so
    // entityType/entityId are both non-null by construction.
    entity_type: row.entityType as ProjectRelatedCapture["entity_type"],
    entity_id: row.entityId as string,
  }));
  items.sort(compareCapturesNewestFirst);
  return {
    items: items.slice(0, PROJECT_CONTEXT_RELATED_CAPTURES_ITEM_CAP),
    total: items.length,
  };
}

interface ActivityCandidate {
  type: ProjectActivityType;
  description: string;
  at: Date;
  /** Not on the wire -- final tiebreak only, same "every ordering ends in
   * id" convention every other read model in this repo follows. */
  sourceId: string;
}

function compareActivityNewestFirst(a: ActivityCandidate, b: ActivityCandidate): number {
  const delta = b.at.getTime() - a.at.getTime();
  if (delta !== 0) return delta < 0 ? -1 : 1;
  if (a.type !== b.type) return compareStrings(a.type, b.type);
  return compareStrings(a.sourceId, b.sourceId);
}

/** The project's recent-activity feed: task completions, note writes/
 * updates, occurrence completions within the last
 * PROJECT_CONTEXT_RECENT_ACTIVITY_WINDOW_DAYS days -- exactly the three
 * signal categories packages/core's isStalledProject/lastProjectActivity
 * reasoning already names (ProjectActivitySignals), reused here rather than
 * a fourth invented category. Newest first, capped with an honest total. */
async function fetchRecentActivity(
  db: Db,
  projectId: string,
  effectiveNow: Date,
): Promise<{ items: ProjectActivityItem[]; total: number }> {
  const windowStart = new Date(
    effectiveNow.getTime() - PROJECT_CONTEXT_RECENT_ACTIVITY_WINDOW_DAYS * DAY_MS,
  );

  const [completedTasks, writtenNotes, completedOccurrences] = await Promise.all([
    db
      .select({ id: tasks.id, title: tasks.title, completedAt: tasks.completedAt })
      .from(tasks)
      .where(
        and(
          eq(tasks.projectId, projectId),
          isNull(tasks.archivedAt),
          isNotNull(tasks.completedAt),
          gte(tasks.completedAt, windowStart),
        ),
      ),
    db
      .select({
        id: notes.id,
        title: notes.title,
        createdAt: notes.createdAt,
        updatedAt: notes.updatedAt,
      })
      .from(notes)
      .where(
        and(
          eq(notes.projectId, projectId),
          isNull(notes.archivedAt),
          gte(sql`greatest(${notes.createdAt}, ${notes.updatedAt})`, windowStart),
        ),
      ),
    db
      .select({ id: occurrences.id, title: tasks.title, completedAt: occurrences.completedAt })
      .from(occurrences)
      .innerJoin(tasks, eq(occurrences.parentId, tasks.id))
      .where(
        and(
          eq(occurrences.parentType, "task"),
          eq(tasks.projectId, projectId),
          isNotNull(occurrences.completedAt),
          gte(occurrences.completedAt, windowStart),
        ),
      ),
  ]);

  const candidates: ActivityCandidate[] = [];
  for (const row of completedTasks) {
    if (!row.completedAt) continue;
    candidates.push({
      type: "task_completed",
      description: `Completed task "${row.title}"`,
      at: row.completedAt,
      sourceId: row.id,
    });
  }
  for (const row of writtenNotes) {
    const wasUpdated = row.updatedAt.getTime() > row.createdAt.getTime();
    candidates.push({
      type: "note_written",
      description: `${wasUpdated ? "Updated" : "Wrote"} note "${row.title}"`,
      at: wasUpdated ? row.updatedAt : row.createdAt,
      sourceId: row.id,
    });
  }
  for (const row of completedOccurrences) {
    if (!row.completedAt) continue;
    candidates.push({
      type: "occurrence_completed",
      description: `Completed occurrence of "${row.title}"`,
      at: row.completedAt,
      sourceId: row.id,
    });
  }
  candidates.sort(compareActivityNewestFirst);

  return {
    items: candidates
      .slice(0, PROJECT_CONTEXT_RECENT_ACTIVITY_ITEM_CAP)
      .map(({ type, description, at }) => ({ type, description, at: at.toISOString() })),
    total: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// GET /projects/:id/context
// ---------------------------------------------------------------------------

export async function buildProjectContext(
  db: Db,
  projectId: string,
  options?: { now?: Date },
): Promise<ProjectContextResponse | null> {
  const effectiveNow = captureEffectiveNow(options?.now);
  const [row] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!row) return null;

  const [taskSection, eventSection, entityIds] = await Promise.all([
    fetchProjectTaskSection(db, projectId, PROJECT_CONTEXT_TASKS_ITEM_CAP),
    fetchProjectEventSection(db, projectId, PROJECT_CONTEXT_EVENTS_ITEM_CAP),
    fetchProjectEntityIds(db, projectId),
  ]);
  const [relatedCaptures, recentActivity] = await Promise.all([
    fetchRelatedCaptures(db, entityIds),
    fetchRecentActivity(db, projectId, effectiveNow),
  ]);

  return ProjectContextResponseSchema.parse({
    project: toProjectPayload(row),
    tasks: { items: taskSection.items.map(toContextTaskItem), total: taskSection.total },
    events: { items: eventSection.items.map(toDetailEventItem), total: eventSection.total },
    related_captures: relatedCaptures,
    recent_activity: recentActivity,
  });
}
