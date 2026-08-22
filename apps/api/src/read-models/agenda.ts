import {
  addCalendarDays,
  buildActionableView,
  captureEffectiveNow,
  localDayWindowForDate,
  type LocalDayWindow,
} from "@personal-os/core";
import { events, occurrences, projects, tasks, type Db } from "@personal-os/db";
import {
  AgendaResponseSchema,
  type AgendaDay,
  type AgendaEventItem,
  type AgendaItem,
  type AgendaOccurrenceItem,
  type AgendaQuery,
  type AgendaResponse,
  type AgendaTaskItem,
  type EventRangeItem,
} from "@personal-os/schema";
import { and, eq, gte, inArray, isNull, lt } from "drizzle-orm";
import { assembleEventRange } from "./event-range.js";

// Front padding on the event-range query, identical in spirit to today.ts's
// EVENT_RANGE_FRONT_PADDING_MS: keeps all-day/multi-day events that START
// before the agenda's first local midnight in the candidate set, so
// date-string classification (below) can still place them correctly.
const EVENT_RANGE_FRONT_PADDING_MS = 24 * 60 * 60 * 1000;

// Discriminated build result -- mirrors GET /events/range's own
// EventRangeAssembly philosophy (apps/api/src/read-models/event-range.ts):
// a resource-limit failure during recurrence expansion fails the whole
// request explicitly, never a silently incomplete Agenda. The route maps
// this to the identical structured 400 the events route already uses.
export type AgendaBuildResult =
  | { readonly ok: true; readonly response: AgendaResponse }
  | { readonly ok: false; readonly eventId: string; readonly limit: number };

// Merged task/occurrence row shape used internally -- structurally the same
// convention as today.ts's TodayTaskRow: `dueAt` carries the occurrence's
// own occurs_at when occurrenceId is set (buildActionableView's
// mergeIntoOccurrence contract), and `id` stays the PARENT task's id in
// both cases (occurrence_id is the separate, occurrence-specific field).
// dueAt is always a real Date here (never null) -- undated tasks are
// excluded from Agenda entirely at the query level (frozen semantics item 5).
interface AgendaTaskRow {
  id: string;
  title: string;
  dueAt: Date;
  remindAt: Date | null;
  timezone: string;
  priority: number | null;
  projectId: string | null;
  projectName: string | null;
  rrule: string | null;
  parentTaskId: string | null;
  status: string;
  occurrenceId?: string;
}

interface AgendaOccurrenceRow {
  id: string;
  parentId: string;
  occursAt: Date;
  parentTitle: string;
  parentProjectId: string | null;
  parentProjectName: string | null;
  parentRrule: string | null;
  parentTimezone: string;
  parentRemindAt: Date | null;
  parentPriority: number | null;
}

function kindRank(kind: "event" | "occurrence" | "task"): number {
  return kind === "event" ? 0 : kind === "occurrence" ? 1 : 2;
}

// Frozen Agenda sort, the task/occurrence half: ascending actionable
// instant, then kind (occurrence before task -- events are handled
// separately since they're merged in per-day, see compareDayItems), then
// priority ASC NULLS LAST (lower value = higher priority --
// packages/core/src/project-lifecycle.ts's frozen convention), then id ASC
// lexicographic. Deliberately NOT reused from buildActionableView's own
// internal sort (which only breaks ties by row key) -- that helper is used
// here strictly for the parent-suppression dedupe/bucketing, this
// comparator is the full frozen tie-break chain applied afterward.
function compareTaskRows(a: AgendaTaskRow, b: AgendaTaskRow): number {
  const instantDelta = a.dueAt.getTime() - b.dueAt.getTime();
  if (instantDelta !== 0) return instantDelta;
  const kindDelta =
    kindRank(a.occurrenceId !== undefined ? "occurrence" : "task") -
    kindRank(b.occurrenceId !== undefined ? "occurrence" : "task");
  if (kindDelta !== 0) return kindDelta;
  const pa = a.priority ?? Number.POSITIVE_INFINITY;
  const pb = b.priority ?? Number.POSITIVE_INFINITY;
  if (pa !== pb) return pa - pb;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function toAgendaTaskItem(row: AgendaTaskRow): AgendaTaskItem | AgendaOccurrenceItem {
  const base = {
    id: row.id,
    title: row.title,
    due_at: row.dueAt.toISOString(),
    remind_at: row.remindAt ? row.remindAt.toISOString() : null,
    timezone: row.timezone,
    priority: row.priority,
    project_id: row.projectId,
    project_name: row.projectName,
    rrule: row.rrule,
    parent_task_id: row.parentTaskId,
  };
  if (row.occurrenceId !== undefined) {
    return {
      ...base,
      kind: "occurrence" as const,
      occurrence_id: row.occurrenceId,
      // AgendaOccurrenceItemSchema requires a non-null parent_task_id; an
      // occurrence-merged row always has one (its own parent), so this is
      // never actually null in practice -- the fallback only satisfies the
      // type checker without weakening the runtime schema's own refine.
      parent_task_id: row.parentTaskId ?? row.id,
      occurs_at: row.dueAt.toISOString(),
    };
  }
  return { ...base, kind: "task" as const };
}

function eventStartMs(item: EventRangeItem): number | null {
  if (item.occurs_at) return Date.parse(item.occurs_at);
  if (item.starts_at) return Date.parse(item.starts_at);
  return null;
}

function eventEndMs(item: EventRangeItem): number | null {
  if (item.occurs_at) {
    return item.occurs_ends_at ? Date.parse(item.occurs_ends_at) : Date.parse(item.occurs_at);
  }
  if (item.starts_at) {
    return item.ends_at ? Date.parse(item.ends_at) : Date.parse(item.starts_at);
  }
  return null;
}

// Deliberate divergence from today.ts's classifyEventIntoWindows: Today
// places a multi-day event into only its FIRST matching window (`.find`),
// since it only ever renders one "today" bucket plus a 7-day upcoming
// strip keyed by day. Agenda instead places an event into EVERY local day
// it overlaps (`.filter`) -- a 3-day conference must appear on all 3 days,
// not just its first. All-day/multi-day overlap is inclusive calendar-date
// string comparison; timed events (including ones that cross midnight) use
// half-open instant overlap against each day's [startUtc, endUtcExclusive).
function classifyEventIntoAllWindows(
  item: EventRangeItem,
  windows: readonly LocalDayWindow[],
): LocalDayWindow[] {
  if (item.all_day && item.start_date !== null) {
    const end = item.end_date ?? item.start_date;
    return windows.filter((w) => item.start_date! <= w.localDate && w.localDate <= end);
  }
  const startMs = eventStartMs(item);
  if (startMs === null) return [];
  const endMs = eventEndMs(item) ?? startMs;
  // A timed event with no end (ends_at/occurs_ends_at null -- schema-legal:
  // EventCreateSchema only requires starts_at) is a zero-duration instant.
  // The half-open overlap test below degenerates to the EMPTY interval
  // [startMs, startMs) for it, which overlaps no window at all -- so an
  // event starting exactly at local midnight would vanish from every day
  // rather than appearing on one. Point membership is the correct test for
  // a zero-duration instant. Do NOT relax the general test to >= instead:
  // that would duplicate a real-duration event whose end lands exactly on a
  // day boundary into the following day as well.
  if (endMs === startMs) {
    return windows.filter(
      (w) => startMs >= w.startUtc.getTime() && startMs < w.endUtcExclusive.getTime(),
    );
  }
  return windows.filter(
    (w) => startMs < w.endUtcExclusive.getTime() && endMs > w.startUtc.getTime(),
  );
}

function toAgendaEventItem(
  item: EventRangeItem,
  meta: { projectId: string | null; rrule: string | null } | undefined,
): AgendaEventItem {
  return {
    kind: "event",
    id: item.id,
    title: item.title,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    all_day: item.all_day,
    start_date: item.start_date,
    end_date: item.end_date,
    location: item.location,
    project_id: meta?.projectId ?? null,
    rrule: meta?.rrule ?? null,
    parent_event_id: item.parent_event_id ?? null,
    occurs_at: item.occurs_at,
  };
}

// Combined day-item comparator (frozen): all-day events first (they carry
// no time-of-day), then EVERY remaining item -- tasks, occurrences, and
// timed events alike -- interleaved strictly by actionable instant
// ascending. Ties: kind order event < occurrence < task, then priority ASC
// NULLS LAST (events/occurrences with no priority sort after any that have
// one), then id ASC lexicographic.
function compareDayItems(a: AgendaItem, b: AgendaItem): number {
  const aAllDay = a.kind === "event" && a.all_day;
  const bAllDay = b.kind === "event" && b.all_day;
  if (aAllDay !== bAllDay) return aAllDay ? -1 : 1;

  const instantOf = (item: AgendaItem): number | null => {
    if (item.kind === "task") return item.due_at ? Date.parse(item.due_at) : null;
    if (item.kind === "occurrence") return Date.parse(item.occurs_at);
    return item.occurs_at
      ? Date.parse(item.occurs_at)
      : item.starts_at
        ? Date.parse(item.starts_at)
        : null;
  };
  const aInstant = instantOf(a);
  const bInstant = instantOf(b);
  if (aInstant !== null && bInstant !== null && aInstant !== bInstant) return aInstant - bInstant;

  const kindDelta = kindRank(a.kind) - kindRank(b.kind);
  if (kindDelta !== 0) return kindDelta;

  const priorityOf = (item: AgendaItem): number =>
    item.kind === "event" ? Number.POSITIVE_INFINITY : (item.priority ?? Number.POSITIVE_INFINITY);
  const priorityDelta = priorityOf(a) - priorityOf(b);
  if (priorityDelta !== 0) return priorityDelta;

  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export async function buildAgendaResponse(db: Db, query: AgendaQuery): Promise<AgendaBuildResult> {
  // Frozen semantics item 1: exactly one effectiveNow per build.
  const effectiveNow = captureEffectiveNow();

  const localDates: string[] = [];
  let cursor = query.from;
  // Defensive bound only -- AgendaQuerySchema already rejects a span over
  // 90 days, this just prevents a pathological infinite loop if that
  // invariant is ever violated upstream.
  for (let i = 0; i < 400 && cursor <= query.to; i += 1) {
    localDates.push(cursor);
    cursor = addCalendarDays(cursor, 1);
  }
  const windows = localDates.map((date) => localDayWindowForDate(query.tz, date));
  const rangeStartUtc = windows[0]!.startUtc;
  const rangeEndUtc = windows[windows.length - 1]!.endUtcExclusive;

  const projectFilter =
    query.project_id !== undefined ? eq(tasks.projectId, query.project_id) : undefined;

  // Tasks: NON-RECURRING open tasks with a due_at strictly inside the
  // requested range (frozen semantics item 5). A recurring parent is never
  // eligible as a standalone item here -- even one whose own template
  // due_at happens to fall inside the range -- because item 6 forbids a
  // recurring parent leaking in as a bare row when its occurrences fall
  // outside the range; excluding rrule-bearing tasks entirely from this
  // query (rather than trying to special-case that overlap) makes that
  // leak structurally impossible. Recurring parents enter the actionable
  // set below only via their occurrence rows. Undated tasks are excluded
  // from Agenda entirely -- they belong to Inbox/Today, not a date-scoped
  // view.
  const taskRows: AgendaTaskRow[] = (
    await db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueAt: tasks.dueAt,
        remindAt: tasks.remindAt,
        timezone: tasks.timezone,
        priority: tasks.priority,
        projectId: tasks.projectId,
        projectName: projects.name,
        rrule: tasks.rrule,
        parentTaskId: tasks.parentTaskId,
        status: tasks.status,
      })
      .from(tasks)
      .leftJoin(projects, eq(tasks.projectId, projects.id))
      .where(
        and(
          isNull(tasks.archivedAt),
          isNull(tasks.rrule),
          inArray(tasks.status, ["inbox", "active"]),
          gte(tasks.dueAt, rangeStartUtc),
          lt(tasks.dueAt, rangeEndUtc),
          projectFilter,
        ),
      )
  ).map((row) => ({ ...row, dueAt: row.dueAt! }));

  // Occurrences: the materialized row IS the actionable item for a
  // recurring parent (frozen dedupe rule). Only status='scheduled';
  // done/skipped excluded. Project filter applies to the PARENT task's own
  // project_id (occurrences carry no project column of their own), same
  // join pattern project-summaries.ts uses.
  const occurrenceRows: AgendaOccurrenceRow[] = await db
    .select({
      id: occurrences.id,
      parentId: occurrences.parentId,
      occursAt: occurrences.occursAt,
      parentTitle: tasks.title,
      parentProjectId: tasks.projectId,
      parentProjectName: projects.name,
      parentRrule: tasks.rrule,
      parentTimezone: tasks.timezone,
      parentRemindAt: tasks.remindAt,
      parentPriority: tasks.priority,
    })
    .from(occurrences)
    .innerJoin(tasks, eq(occurrences.parentId, tasks.id))
    .leftJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(occurrences.parentType, "task"),
        eq(occurrences.status, "scheduled"),
        isNull(tasks.archivedAt),
        inArray(tasks.status, ["inbox", "active"]),
        gte(occurrences.occursAt, rangeStartUtc),
        lt(occurrences.occursAt, rangeEndUtc),
        projectFilter,
      ),
    );

  // buildActionableView requires every occurrence's parent to be present in
  // its `tasks` array or the occurrence is silently dropped -- but a
  // recurring parent's own due_at (its original template value, if any) is
  // usually outside this exact request's range, so `taskRows` above
  // (deliberately range-AND-non-recurring-filtered) will rarely contain it.
  // Synthesize a parent row per distinct occurrence parent directly from
  // the already-joined occurrence columns (no extra query needed) and merge
  // it in. These synthetic rows always have >=1 scheduled occurrence by
  // construction, so buildActionableView will always suppress them as a
  // bare task -- the placeholder dueAt is never actually surfaced.
  const mergedTaskRowsById = new Map<string, AgendaTaskRow>();
  for (const row of taskRows) mergedTaskRowsById.set(row.id, row);
  for (const occ of occurrenceRows) {
    if (mergedTaskRowsById.has(occ.parentId)) continue;
    mergedTaskRowsById.set(occ.parentId, {
      id: occ.parentId,
      title: occ.parentTitle,
      dueAt: occ.occursAt,
      remindAt: occ.parentRemindAt,
      timezone: occ.parentTimezone,
      priority: occ.parentPriority,
      projectId: occ.parentProjectId,
      projectName: occ.parentProjectName,
      rrule: occ.parentRrule,
      parentTaskId: null,
      status: "active",
    });
  }
  const mergedTaskRows = [...mergedTaskRowsById.values()];

  // buildActionableView owns the parent-suppression dedupe only: window is
  // set to the range's first day and horizonEndUtc to the range's own end,
  // so its `dueToday` bucket (== items on the first local day) plus
  // `upcoming` bucket (== items after day 1, capped at the range end)
  // together cover every non-overdue day in [from, to]; `overdue` covers
  // everything with an actionable instant before effectiveNow. All three
  // buckets are already scoped to the pre-filtered rows above, so overdue
  // here is naturally bounded to the requested range too (frozen semantics
  // item 3/4), unlike Today's unbounded-backward overdue section.
  const actionability = buildActionableView<AgendaTaskRow, AgendaOccurrenceRow>({
    effectiveNow,
    window: windows[0]!,
    horizonEndUtc: rangeEndUtc,
    tasks: mergedTaskRows,
    occurrences: occurrenceRows,
    taskKey: (t) => t.id,
    occParentKey: (o) => o.parentId,
    occKey: (o) => o.id,
    occStatus: () => "scheduled",
    occOccursAt: (o) => o.occursAt,
    actionableInstantOfTask: (t) => t.dueAt,
    mergeIntoOccurrence: (parent, occ) => ({
      id: parent.id,
      title: parent.title,
      dueAt: occ.occursAt,
      remindAt: parent.remindAt,
      timezone: parent.timezone,
      priority: parent.priority,
      projectId: parent.projectId,
      projectName: parent.projectName,
      rrule: parent.rrule,
      parentTaskId: parent.id,
      status: parent.status,
      occurrenceId: occ.id,
    }),
  });

  const overdueRows = actionability.overdue.slice().sort(compareTaskRows);
  const nonOverdueRows = [...actionability.dueToday, ...actionability.upcoming];

  // Events: identical three-source assembly as Today/GET /events/range,
  // classified into every overlapping local day (see
  // classifyEventIntoAllWindows's comment for why this diverges from
  // Today's single-bucket placement). A resource-limit failure fails the
  // whole build rather than returning a partial Agenda.
  const assembled = await assembleEventRange(db, {
    from: new Date(rangeStartUtc.getTime() - EVENT_RANGE_FRONT_PADDING_MS),
    to: rangeEndUtc,
    includeArchived: false,
  });
  if (!assembled.ok) {
    return { ok: false, eventId: assembled.eventId, limit: assembled.limit };
  }

  // project_id/rrule are stripped by EventRangeItemSchema, so source them
  // for the candidate event ids directly -- same pattern as today.ts.
  const candidateEventIds = [...new Set(assembled.items.map((item) => item.id))];
  const eventMetaById = new Map<string, { projectId: string | null; rrule: string | null }>();
  if (candidateEventIds.length > 0) {
    const metaRows = await db
      .select({ id: events.id, projectId: events.projectId, rrule: events.rrule })
      .from(events)
      .where(inArray(events.id, candidateEventIds));
    for (const row of metaRows) {
      eventMetaById.set(row.id, { projectId: row.projectId, rrule: row.rrule });
    }
  }

  // Project filter applies to the event's OWN project_id, not the
  // project's own lifecycle -- an event under a paused/completed/archived
  // project still appears when that project is requested (matches the
  // unanimous existing convention: tasks.ts/events.ts/notes.ts all filter
  // on a bare eq(...projectId, ...)).
  const filteredEventItems =
    query.project_id !== undefined
      ? assembled.items.filter((item) => eventMetaById.get(item.id)?.projectId === query.project_id)
      : assembled.items;

  const eventsByDay = new Map<string, EventRangeItem[]>();
  for (const item of filteredEventItems) {
    for (const target of classifyEventIntoAllWindows(item, windows)) {
      const existing = eventsByDay.get(target.localDate);
      if (existing) existing.push(item);
      else eventsByDay.set(target.localDate, [item]);
    }
  }

  const days: AgendaDay[] = windows.map((dayWindow) => {
    const dayTaskItems: AgendaItem[] = nonOverdueRows
      .filter(
        (row) =>
          row.dueAt.getTime() >= dayWindow.startUtc.getTime() &&
          row.dueAt.getTime() < dayWindow.endUtcExclusive.getTime(),
      )
      .map(toAgendaTaskItem);
    const dayEventItems: AgendaItem[] = (eventsByDay.get(dayWindow.localDate) ?? []).map((item) =>
      toAgendaEventItem(item, eventMetaById.get(item.id)),
    );
    const items = [...dayTaskItems, ...dayEventItems].sort(compareDayItems);
    return { date: dayWindow.localDate, items };
  });

  const generatedAt = effectiveNow.toISOString();
  const response = AgendaResponseSchema.parse({
    tz: query.tz,
    from: query.from,
    to: query.to,
    generated_at: generatedAt,
    effective_now: generatedAt,
    overdue: overdueRows.map(toAgendaTaskItem),
    days,
  });
  return { ok: true, response };
}
