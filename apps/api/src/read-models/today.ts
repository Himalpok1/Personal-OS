import {
  buildActionableView,
  captureEffectiveNow,
  computeProjectProgress,
  isStalledProject,
  lastProjectActivity,
  localDayWindow,
  localDayWindowForDate,
  pickNextAction,
  type LocalDayWindow,
} from "@personal-os/core";
import { events, inboxItems, notes, occurrences, projects, tasks, type Db } from "@personal-os/db";
import {
  TodayResponseSchema,
  type TodayEventItem,
  type TodayQuery,
  type TodayProjectSummary,
  type TodayResponse,
  type TodayTaskItem,
} from "@personal-os/schema";
import type { EventRangeItem } from "@personal-os/schema";
import {
  and,
  asc,
  count,
  desc,
  eq,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
} from "drizzle-orm";
import { assembleEventRange } from "./event-range.js";

const OVERDUE_ITEM_CAP = 20;
const DUE_TODAY_ITEM_CAP = 25;
const UPCOMING_DAY_COUNT = 7;
const INBOX_ITEMS_CAP = 5;
const PROJECTS_CAP = 10;
// Padding on the range query's front edge so all-day/multi-day events that
// START before today's local midnight are still fetched -- the collector
// classifies all-day events by date string, and the range endpoint's own
// SQL bounds are UTC-calendar-date based, so a multi-day event starting
// yesterday (UTC) must be in the candidate set to be classified into today.
const EVENT_RANGE_FRONT_PADDING_MS = 24 * 60 * 60 * 1000;

function addLocalDays(localDate: string, days: number): string {
  const [year, month, day] = localDate.split("-").map(Number);
  const next = new Date(Date.UTC(year!, month! - 1, day, 12) + days * 86_400_000);
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${String(next.getUTCFullYear()).padStart(4, "0")}-${pad(next.getUTCMonth() + 1)}-${pad(next.getUTCDate())}`;
}

interface TodayTaskRow {
  id: string;
  title: string;
  dueAt: Date | null;
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

interface TodayOccurrenceRow {
  id: string;
  parentId: string;
  occursAt: Date;
  parentTitle: string;
  parentProjectId: string | null;
  parentProjectName: string | null;
  parentPriority: number | null;
  parentRrule: string | null;
  parentTimezone: string;
  parentRemindAt: Date | null;
}

// Drizzle's raw sql<T> expressions bypass column mappers (it overrides the
// driver's timestamp parsers), so aggregate max()/min() over timestamptz
// arrives as a plain string -- coerce explicitly before any Date method use.
function toDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(value as string);
}

function toTodayTaskItem(row: TodayTaskRow): TodayTaskItem {
  return {
    id: row.id,
    title: row.title,
    due_at: row.dueAt ? row.dueAt.toISOString() : null,
    remind_at: row.remindAt ? row.remindAt.toISOString() : null,
    timezone: row.timezone,
    priority: row.priority,
    project_id: row.projectId,
    project_name: row.projectName ?? null,
    rrule: row.rrule,
    parent_task_id: row.parentTaskId,
    ...(row.occurrenceId !== undefined ? { occurrence_id: row.occurrenceId } : {}),
  };
}

function eventStartMs(item: EventRangeItem): number | null {
  if (item.occurs_at) return Date.parse(item.occurs_at);
  if (item.starts_at) return Date.parse(item.starts_at);
  return null;
}

// Frozen classification for Today (fixes the route's UTC-bucket
// simplification locally, without changing the route's own behavior):
// all-day events belong to a local day by pure calendar-date string
// comparison; timed events by which day window contains their effective
// start instant.
function classifyEventIntoWindows(
  item: EventRangeItem,
  windows: readonly LocalDayWindow[],
): LocalDayWindow | null {
  if (item.all_day && item.start_date !== null) {
    const end = item.end_date ?? item.start_date;
    return windows.find((w) => item.start_date! <= w.localDate && w.localDate <= end) ?? null;
  }
  const startMs = eventStartMs(item);
  if (startMs === null) return null;
  return (
    windows.find((w) => startMs >= w.startUtc.getTime() && startMs < w.endUtcExclusive.getTime()) ??
    null
  );
}

// Timed events first (ascending effective start -- preserved from the range
// assembly's own ordering), then all-day events (ascending start_date).
function orderEventsForDay(items: readonly EventRangeItem[]): EventRangeItem[] {
  return [
    ...items.filter((i) => !i.all_day),
    ...items.filter((i) => i.all_day).sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  ];
}

function toTodayEventItem(
  item: EventRangeItem,
  meta: { projectId: string | null; rrule: string | null } | undefined,
): TodayEventItem {
  return {
    id: item.id,
    title: item.title,
    starts_at: item.starts_at,
    ends_at: item.ends_at,
    all_day: item.all_day,
    start_date: item.start_date,
    end_date: item.end_date,
    location: item.location,
    // Not part of the frozen EventRangeItemSchema (its parse strips unknown
    // keys), so the collector sources them itself -- a recurring instance
    // shares its series row's id, so this transparently inherits the
    // parent's project/rule; a detached child carries its own.
    project_id: meta?.projectId ?? null,
    rrule: meta?.rrule ?? null,
    parent_event_id: item.parent_event_id ?? null,
    occurs_at: item.occurs_at,
  };
}

export async function buildTodayResponse(db: Db, query: TodayQuery): Promise<TodayResponse> {
  // Frozen semantics item 1: exactly one effectiveNow per build.
  const effectiveNow = captureEffectiveNow();
  const window = localDayWindow(query.tz, effectiveNow);

  // Horizon: the 7 local calendar days AFTER today. horizonEndUtc is the
  // end-exclusive boundary of day+7 (== start of day+8).
  const upcomingWindows: LocalDayWindow[] = [];
  for (let i = 1; i <= UPCOMING_DAY_COUNT; i += 1) {
    upcomingWindows.push(localDayWindowForDate(query.tz, addLocalDays(window.localDate, i)));
  }
  const horizonEndUtc = localDayWindowForDate(
    query.tz,
    addLocalDays(window.localDate, UPCOMING_DAY_COUNT),
  ).endUtcExclusive;

  const taskRows: TodayTaskRow[] = await db
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
        inArray(tasks.status, ["inbox", "active"]),
        or(isNull(tasks.dueAt), lt(tasks.dueAt, horizonEndUtc)),
      ),
    )
    .orderBy(sql`${tasks.dueAt} asc nulls last`);

  const occurrenceRows: TodayOccurrenceRow[] = await db
    .select({
      id: occurrences.id,
      parentId: occurrences.parentId,
      occursAt: occurrences.occursAt,
      parentTitle: tasks.title,
      parentProjectId: tasks.projectId,
      parentProjectName: projects.name,
      parentPriority: tasks.priority,
      parentRrule: tasks.rrule,
      parentTimezone: tasks.timezone,
      parentRemindAt: tasks.remindAt,
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
        lt(occurrences.occursAt, horizonEndUtc),
      ),
    )
    .orderBy(asc(occurrences.occursAt));

  // Frozen dedupe (ADR-038 amendment 2): scheduled occurrences are THE
  // actionable representations of their recurring parent -- the bare parent
  // is suppressed wherever any scheduled occurrence exists.
  const actionability = buildActionableView<TodayTaskRow, TodayOccurrenceRow>({
    effectiveNow,
    window,
    horizonEndUtc,
    tasks: taskRows,
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

  // Honest totals BEFORE any section caps: read straight off the view
  // buckets, which already apply the frozen precedence (overdue > window)
  // AND the recurring dedupe -- an occurrence IS the actionable
  // representation of its parent, so counting raw task+occurrence
  // candidates separately would double-count recurring work and make the
  // summary contradict the sections. The buckets hold every placed row
  // from the candidate queries; only the item slices below are capped.
  const overdueTotal = actionability.overdue.length;
  const dueTodayTotal = actionability.dueToday.length;

  // Events: candidates via the extracted three-source assembly (identical
  // recurrence/expansion semantics as GET /events/range), then classified
  // into LOCAL days here. The 24h front padding keeps multi-day/all-day
  // events starting yesterday visible for date-string filtering.
  const assembled = await assembleEventRange(db, {
    from: new Date(window.startUtc.getTime() - EVENT_RANGE_FRONT_PADDING_MS),
    to: horizonEndUtc,
    includeArchived: false,
  });
  if (!assembled.ok) {
    // Matches the range endpoint's own philosophy: fail loudly rather than
    // render a silently incomplete Today view.
    throw new Error("event recurrence expansion limit exceeded while building Today read model");
  }

  const allWindows = [window, ...upcomingWindows];
  const eventsByDay = new Map<string, EventRangeItem[]>();
  for (const item of assembled.items) {
    const target = classifyEventIntoWindows(item, allWindows);
    if (!target) continue;
    const existing = eventsByDay.get(target.localDate);
    if (existing) existing.push(item);
    else eventsByDay.set(target.localDate, [item]);
  }

  // project_id/rrule are stripped by EventRangeItemSchema (not declared
  // there), so fetch them for the candidate event ids directly. Recurring
  // instances share their series row's id; detached children carry their own.
  const eventMetaById = new Map<string, { projectId: string | null; rrule: string | null }>();
  const candidateEventIds = [...new Set(assembled.items.map((item) => item.id))];
  if (candidateEventIds.length > 0) {
    const metaRows = await db
      .select({ id: events.id, projectId: events.projectId, rrule: events.rrule })
      .from(events)
      .where(inArray(events.id, candidateEventIds));
    for (const row of metaRows) {
      eventMetaById.set(row.id, { projectId: row.projectId, rrule: row.rrule });
    }
  }
  const toEventItem = (item: EventRangeItem): TodayEventItem =>
    toTodayEventItem(item, eventMetaById.get(item.id));

  const eventsToday = orderEventsForDay(eventsByDay.get(window.localDate) ?? []).map(toEventItem);

  const upcomingDays = upcomingWindows.map((dayWindow) => {
    const dayTasks = actionability.upcoming
      .filter((row) => {
        if (row.dueAt === null) return false;
        const ms = row.dueAt.getTime();
        return ms >= dayWindow.startUtc.getTime() && ms < dayWindow.endUtcExclusive.getTime();
      })
      .map(toTodayTaskItem);
    const dayEvents = orderEventsForDay(eventsByDay.get(dayWindow.localDate) ?? []).map(
      toEventItem,
    );
    return {
      date: dayWindow.localDate,
      tasks: dayTasks,
      events: dayEvents,
      total: dayTasks.length + dayEvents.length,
    };
  });

  const inboxStatusRows = await db
    .select({ status: inboxItems.status, total: count() })
    .from(inboxItems)
    .where(inArray(inboxItems.status, ["pending", "needs_confirm", "failed"]))
    .groupBy(inboxItems.status);
  const inboxCountOf = (status: string): number =>
    Number(inboxStatusRows.find((row) => row.status === status)?.total ?? 0);
  const pendingCount = inboxCountOf("pending");
  const needsConfirmCount = inboxCountOf("needs_confirm");
  const failedCount = inboxCountOf("failed");

  const attentionItems = await db
    .select({
      id: inboxItems.id,
      rawText: inboxItems.rawText,
      status: inboxItems.status,
      capturedAt: inboxItems.capturedAt,
      entityType: inboxItems.entityType,
    })
    .from(inboxItems)
    .where(inArray(inboxItems.status, ["needs_confirm", "failed"]))
    .orderBy(desc(inboxItems.capturedAt))
    .limit(INBOX_ITEMS_CAP);

  // Today's projects section is ACTIVE projects only: non-archived AND
  // status='active'. Paused/completed/archived never appear here, and by
  // construction every row passed to the stalled predicate below is active.
  const projectRows = await db
    .select()
    .from(projects)
    .where(and(isNull(projects.archivedAt), eq(projects.status, "active")));

  const taskAggregates = new Map(
    (
      await db
        .select({
          projectId: tasks.projectId,
          openCount:
            sql<number>`count(*) filter (where ${tasks.status} in ('inbox','active') and ${tasks.archivedAt} is null)`.mapWith(
              Number,
            ),
          overdueCount:
            sql<number>`count(*) filter (where ${tasks.status} in ('inbox','active') and ${tasks.archivedAt} is null and (${tasks.dueAt} < ${effectiveNow} or exists (select 1 from occurrences oc where oc.parent_type = 'task' and oc.parent_id = "tasks"."id" and oc.status = 'scheduled' and oc.occurs_at < ${effectiveNow})))`.mapWith(
              Number,
            ),
          doneCount:
            sql<number>`count(*) filter (where ${tasks.status} = 'done' and ${tasks.archivedAt} is null)`.mapWith(
              Number,
            ),
          lastCompletion: sql<Date | null>`max(${tasks.completedAt})`.mapWith(toDateOrNull),
          lastWrite:
            sql<Date | null>`max(greatest(${tasks.createdAt}, ${tasks.updatedAt}))`.mapWith(
              toDateOrNull,
            ),
        })
        .from(tasks)
        .where(isNotNull(tasks.projectId))
        .groupBy(tasks.projectId)
    ).map((row) => [row.projectId as string, row]),
  );

  const noteAggregates = new Map(
    (
      await db
        .select({
          projectId: notes.projectId,
          lastWrite:
            sql<Date | null>`max(greatest(${notes.updatedAt}, ${notes.createdAt}))`.mapWith(
              toDateOrNull,
            ),
        })
        .from(notes)
        .where(isNotNull(notes.projectId))
        .groupBy(notes.projectId)
    ).map((row) => [row.projectId as string, row]),
  );

  const occurrenceCompletions = new Map(
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
          ),
        )
        .groupBy(tasks.projectId)
    ).map((row) => [row.projectId as string, row]),
  );

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
            gte(events.startsAt, effectiveNow),
            isNull(events.archivedAt),
          ),
        )
        .groupBy(events.projectId)
    ).map((row) => [row.projectId as string, row]),
  );

  // Recurring series' template starts_at is a historical anchor; their real
  // upcoming starts live in occurrences (parent_type='event'). Fold those in
  // so an active recurring series disqualifies stall exactly like a one-off
  // event would.
  // Mirrors isStalledProject's default window (packages/core); the query
  // horizon must cover the exact interval the predicate treats as
  // disqualifying: [effectiveNow, effectiveNow + staleAfterDays).
  const stallHorizon = new Date(effectiveNow.getTime() + 14 * 24 * 60 * 60 * 1000);
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

  const nextActionCandidates = await db
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
      ),
    );

  const projectItems: TodayProjectSummary[] = projectRows.map((project) => {
    const taskAgg = taskAggregates.get(project.id);
    const noteAgg = noteAggregates.get(project.id);
    const occAgg = occurrenceCompletions.get(project.id);
    const progress = computeProjectProgress({
      openTaskCount: taskAgg?.openCount ?? 0,
      overdueTaskCount: taskAgg?.overdueCount ?? 0,
      doneTaskCount: taskAgg?.doneCount ?? 0,
      lastActivityAt: null,
    });
    const lastActivityAt = lastProjectActivity({
      taskCompletions: taskAgg?.lastCompletion ? [taskAgg.lastCompletion] : [],
      taskWrites: taskAgg?.lastWrite ? [taskAgg.lastWrite] : [],
      noteWrites: noteAgg?.lastWrite ? [noteAgg.lastWrite] : [],
      occurrenceCompletions: occAgg?.lastCompletion ? [occAgg.lastCompletion] : [],
    });

    const candidates = nextActionCandidates
      .filter((task) => task.projectId === project.id)
      .map((task) => ({
        id: task.id,
        title: task.title,
        dueAt: task.dueAt,
        priority: task.priority,
        createdAt: task.createdAt,
      }));
    const nextAction = pickNextAction(candidates);

    return {
      id: project.id,
      name: project.name,
      color: project.color,
      // Enforced to this vocabulary by the projects_status CHECK constraint.
      status: project.status as TodayProjectSummary["status"],
      target_date: project.targetDate ?? null,
      next_action: nextAction
        ? {
            task_id: nextAction.id,
            title: nextAction.title,
            due_at: nextAction.dueAt ? nextAction.dueAt.toISOString() : null,
            priority: nextAction.priority,
          }
        : null,
      open_task_count: progress.open,
      overdue_task_count: progress.overdue,
      done_task_count: progress.done,
      last_activity_at: lastActivityAt ? lastActivityAt.toISOString() : null,
      stalled: isStalledProject({
        status: project.status,
        openTaskCount: progress.open,
        lastActivityAt,
        nextLinkedEventStart: nextEventStarts.get(project.id)?.nextStart ?? null,
        effectiveNow,
      }),
    };
  });

  // Stalled first, then earliest next-action due ascending (nulls last),
  // deterministic id tiebreak, capped at 10. active_count stays the TRUE
  // non-archived status='active' count regardless of the cap.
  projectItems.sort((a, b) => {
    if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
    const aDue = a.next_action?.due_at ? Date.parse(a.next_action.due_at) : null;
    const bDue = b.next_action?.due_at ? Date.parse(b.next_action.due_at) : null;
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    const aNull = aDue === null;
    const bNull = bDue === null;
    if (aNull !== bNull) return aNull ? 1 : -1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const generatedAt = effectiveNow.toISOString();
  return TodayResponseSchema.parse({
    generated_at: generatedAt,
    effective_now: generatedAt,
    tz: query.tz,
    local_date: window.localDate,
    summary: {
      overdue_total: overdueTotal,
      due_today_total: dueTodayTotal,
      inbox_attention_total: pendingCount + needsConfirmCount + failedCount,
      active_project_count: projectRows.length,
    },
    overdue: {
      items: actionability.overdue.slice(0, OVERDUE_ITEM_CAP).map(toTodayTaskItem),
      total: overdueTotal,
    },
    due_today: {
      items: actionability.dueToday.slice(0, DUE_TODAY_ITEM_CAP).map(toTodayTaskItem),
      total: dueTodayTotal,
    },
    events_today: { items: eventsToday },
    upcoming: { days: upcomingDays },
    inbox: {
      pending_count: pendingCount,
      needs_confirm_count: needsConfirmCount,
      failed_count: failedCount,
      items: attentionItems.map((item) => ({
        id: item.id,
        raw_text: item.rawText,
        status: item.status,
        captured_at: item.capturedAt.toISOString(),
        entity_type: item.entityType,
      })),
    },
    projects: { active_count: projectRows.length, items: projectItems.slice(0, PROJECTS_CAP) },
    reviews: { last_daily_review_at: null, last_weekly_review_at: null },
    brief: null,
  });
}
