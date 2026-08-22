// Server-side review context collectors for Checkpoint 5.3 (GET
// /reviews/context/daily and /reviews/context/weekly). One captureEffectiveNow
// per build, threaded through every section; responses are schema-parsed
// before returning so the frozen Daily/WeeklyReviewContext contracts cannot
// drift silently.
//
// DUPLICATION-FOR-NOW: the task-row mapping, event classification, ordering,
// and metadata backfill below deliberately mirror read-models/today.ts's
// internals instead of extracting shared helpers. Refactoring today.ts into
// those shared pieces belongs to another in-flight change; until it lands
// this file stays self-contained so the two agents never edit the same
// module. When the extraction lands, these copies should be deleted in favor
// of the shared versions.
import {
  buildActionableView,
  captureEffectiveNow,
  dailyPeriodStart,
  localDayWindow,
  localDayWindowForDate,
  weeklyPeriodStart,
  type ActionableView,
  type LocalDayWindow,
} from "@personal-os/core";
import { events, inboxItems, occurrences, projects, tasks, type Db } from "@personal-os/db";
import {
  DailyReviewContextSchema,
  WeeklyReviewContextSchema,
  type DailyReviewContext,
  type EventRangeItem,
  type ProjectSummaryItem,
  type ReviewContextProject,
  type ReviewInboxAttentionSection,
  type ReviewRecentlyCompletedItem,
  type TodayEventItem,
  type TodayTaskItem,
  type WeeklyReviewContext,
} from "@personal-os/schema";
import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { assembleEventRange } from "./event-range.js";
import { collectRecentlyCompleted } from "./recent-completed.js";
import { computeProjectSummaries } from "./project-summaries.js";

const OVERDUE_ITEM_CAP = 20;
const DUE_TODAY_ITEM_CAP = 25;
const EVENTS_TODAY_ITEM_CAP = 30;
const INBOX_ITEMS_CAP = 5;
const PROJECTS_CAP = 10;
const UPCOMING_DAY_COUNT = 7;
const UPCOMING_TASKS_PER_DAY_CAP = 5;
const UPCOMING_EVENTS_PER_DAY_CAP = 5;
// Same front padding as today.ts: fetch all-day/multi-day events that START
// before the window's first local midnight so date-string classification can
// still pull them in.
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

// Frozen classification: all-day events belong to a local day by calendar-
// date string comparison only; timed events by which day window contains
// their effective start instant.
function classifyEventIntoWindows(
  item: EventRangeItem,
  windows: readonly LocalDayWindow[],
): LocalDayWindow | null {
  if (item.all_day && item.start_date !== null) {
    const end = item.end_date ?? item.start_date;
    return windows.find((w) => item.start_date! <= w.localDate && w.localDate <= end) ?? null;
  }
  const effectiveStart = item.occurs_at ?? item.starts_at;
  if (effectiveStart === null) return null;
  const startMs = Date.parse(effectiveStart);
  return (
    windows.find((w) => startMs >= w.startUtc.getTime() && startMs < w.endUtcExclusive.getTime()) ??
    null
  );
}

// Timed events first (ascending effective start -- preserved from the range
// assembly's own ordering), then all-day events ascending by id.
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
    // Stripped by EventRangeItemSchema's parse (not declared there), so they
    // are sourced from the series rows directly; recurring instances share
    // their series row's id and inherit the parent's project/rule.
    project_id: meta?.projectId ?? null,
    rrule: meta?.rrule ?? null,
    parent_event_id: item.parent_event_id ?? null,
    occurs_at: item.occurs_at,
  };
}

function toReviewContextProject(item: ProjectSummaryItem): ReviewContextProject {
  return {
    id: item.id,
    name: item.name,
    color: item.color,
    status: item.status,
    target_date: item.target_date,
    next_action: item.next_action,
    stalled: item.stalled,
  };
}

async function collectInboxAttentionSection(db: Db): Promise<ReviewInboxAttentionSection> {
  const statusRows = await db
    .select({ status: inboxItems.status, total: count() })
    .from(inboxItems)
    .where(inArray(inboxItems.status, ["pending", "needs_confirm", "failed"]))
    .groupBy(inboxItems.status);
  const countOf = (status: string): number =>
    Number(statusRows.find((row) => row.status === status)?.total ?? 0);

  const attentionRows = await db
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

  return {
    pending_count: countOf("pending"),
    needs_confirm_count: countOf("needs_confirm"),
    failed_count: countOf("failed"),
    items: attentionRows.map((row) => ({
      id: row.id,
      raw_text: row.rawText,
      // Enforced to this vocabulary by the inbox_items_status CHECK
      // constraint.
      status: row.status as ReviewInboxAttentionSection["items"][number]["status"],
      captured_at: row.capturedAt.toISOString(),
      entity_type: row.entityType,
    })),
  };
}

// Open tasks via archived-null status inbox/active + scheduled occurrences of
// their recurring parents, merged with the same actionability semantics as
// /today (scheduled occurrences are THE actionable representation of their
// parent; undated open work lands in due_today).
async function collectTaskActionability(
  db: Db,
  tz: string,
  effectiveNow: Date,
  window: LocalDayWindow,
  horizonEndUtc: Date,
): Promise<ActionableView<TodayTaskRow>> {
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

  return buildActionableView<TodayTaskRow, TodayOccurrenceRow>({
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
}

// Event candidates via assembleEventRange (identical recurrence/expansion
// semantics as GET /events/range), classified into LOCAL day windows, then
// rendered with each series' project/rule backfilled.
async function collectEventsByDay(
  db: Db,
  windows: readonly LocalDayWindow[],
): Promise<Map<string, TodayEventItem[]>> {
  const firstWindow = windows[0];
  const lastWindow = windows[windows.length - 1];
  if (!firstWindow || !lastWindow) return new Map();

  const assembled = await assembleEventRange(db, {
    from: new Date(firstWindow.startUtc.getTime() - EVENT_RANGE_FRONT_PADDING_MS),
    to: lastWindow.endUtcExclusive,
    includeArchived: false,
  });
  if (!assembled.ok) {
    throw new Error("event recurrence expansion limit exceeded while building review context");
  }

  const grouped = new Map<string, EventRangeItem[]>();
  for (const item of assembled.items) {
    const target = classifyEventIntoWindows(item, windows);
    if (!target) continue;
    const existing = grouped.get(target.localDate);
    if (existing) existing.push(item);
    else grouped.set(target.localDate, [item]);
  }

  const eventMetaById = new Map<string, { projectId: string | null; rrule: string | null }>();
  const candidateIds = [...new Set(assembled.items.map((item) => item.id))];
  if (candidateIds.length > 0) {
    const metaRows = await db
      .select({ id: events.id, projectId: events.projectId, rrule: events.rrule })
      .from(events)
      .where(inArray(events.id, candidateIds));
    for (const row of metaRows) {
      eventMetaById.set(row.id, { projectId: row.projectId, rrule: row.rrule });
    }
  }

  const rendered = new Map<string, TodayEventItem[]>();
  for (const [localDate, items] of grouped) {
    rendered.set(
      localDate,
      orderEventsForDay(items).map((item) => toTodayEventItem(item, eventMetaById.get(item.id))),
    );
  }
  return rendered;
}

function boundTaskSection(
  rows: TodayTaskRow[],
  cap: number,
): { items: TodayTaskItem[]; total: number } {
  return { items: rows.slice(0, cap).map(toTodayTaskItem), total: rows.length };
}

// Honest totals BEFORE caps; sections derived by filtering one summaries pass
// so active/paused/stalled/without-next-action can never disagree with the
// underlying list endpoint.
function buildProjectSections(summaries: ProjectSummaryItem[]) {
  const active = summaries.filter((item) => item.status === "active");
  const paused = summaries.filter((item) => item.status === "paused");
  const stalled = summaries.filter((item) => item.stalled);
  const withoutNextAction = active.filter((item) => item.next_action === null);
  return {
    active_projects: {
      items: active.slice(0, PROJECTS_CAP).map(toReviewContextProject),
      total: active.length,
    },
    paused_projects: {
      items: paused.slice(0, PROJECTS_CAP).map(toReviewContextProject),
      total: paused.length,
    },
    stalled_projects: {
      items: stalled.slice(0, PROJECTS_CAP).map(toReviewContextProject),
      total: stalled.length,
    },
    projects_without_next_action: {
      items: withoutNextAction.slice(0, PROJECTS_CAP).map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
      })),
      total: withoutNextAction.length,
    },
  };
}

interface CollectedSections {
  effectiveNow: Date;
  window: LocalDayWindow;
  upcomingWindows: LocalDayWindow[];
  actionability: ActionableView<TodayTaskRow>;
  eventsByDay: Map<string, TodayEventItem[]>;
  inboxAttention: ReviewInboxAttentionSection;
  recentlyCompleted: { items: ReviewRecentlyCompletedItem[]; total: number };
  projectSections: ReturnType<typeof buildProjectSections>;
}

// Everything both context variants share, computed once against a single
// effectiveNow captured by the caller.
async function collectSections(
  db: Db,
  tz: string,
  effectiveNow: Date,
  window: LocalDayWindow,
  upcomingWindows: LocalDayWindow[],
): Promise<CollectedSections> {
  const allWindows = [window, ...upcomingWindows];
  const horizonEndUtc =
    upcomingWindows.length > 0
      ? upcomingWindows[upcomingWindows.length - 1]!.endUtcExclusive
      : window.endUtcExclusive;

  const [actionability, eventsByDay, inboxAttention, projectSummaries, recentlyCompleted] =
    await Promise.all([
      collectTaskActionability(db, tz, effectiveNow, window, horizonEndUtc),
      collectEventsByDay(db, allWindows),
      collectInboxAttentionSection(db),
      computeProjectSummaries(db, { includeArchived: false, now: effectiveNow }),
      collectRecentlyCompleted(db, { tz, now: effectiveNow }),
    ]);

  return {
    effectiveNow,
    window,
    upcomingWindows,
    actionability,
    eventsByDay,
    inboxAttention,
    recentlyCompleted,
    projectSections: buildProjectSections(projectSummaries),
  };
}

export async function buildDailyReviewContext(db: Db, tz: string): Promise<DailyReviewContext> {
  const effectiveNow = captureEffectiveNow();
  const window = localDayWindow(tz, effectiveNow);

  const collected = await collectSections(db, tz, effectiveNow, window, []);

  const generatedAt = effectiveNow.toISOString();
  return DailyReviewContextSchema.parse({
    generated_at: generatedAt,
    effective_now: generatedAt,
    tz,
    period_start: dailyPeriodStart(tz, effectiveNow),
    inbox_attention: collected.inboxAttention,
    overdue: boundTaskSection(collected.actionability.overdue, OVERDUE_ITEM_CAP),
    due_today: boundTaskSection(collected.actionability.dueToday, DUE_TODAY_ITEM_CAP),
    events_today: {
      items: (collected.eventsByDay.get(window.localDate) ?? []).slice(0, EVENTS_TODAY_ITEM_CAP),
    },
    active_projects: collected.projectSections.active_projects,
    stalled_projects: collected.projectSections.stalled_projects,
    projects_without_next_action: collected.projectSections.projects_without_next_action,
    recently_completed: {
      items: collected.recentlyCompleted.items,
      total: collected.recentlyCompleted.total,
    },
  });
}

export async function buildWeeklyReviewContext(db: Db, tz: string): Promise<WeeklyReviewContext> {
  const effectiveNow = captureEffectiveNow();
  const window = localDayWindow(tz, effectiveNow);
  const upcomingWindows: LocalDayWindow[] = [];
  for (let i = 1; i <= UPCOMING_DAY_COUNT; i += 1) {
    upcomingWindows.push(localDayWindowForDate(tz, addLocalDays(window.localDate, i)));
  }

  const collected = await collectSections(db, tz, effectiveNow, window, upcomingWindows);

  const upcomingDays = collected.upcomingWindows.map((dayWindow) => {
    const dayTasks = collected.actionability.upcoming
      .filter((row) => {
        if (row.dueAt === null) return false;
        const ms = row.dueAt.getTime();
        return ms >= dayWindow.startUtc.getTime() && ms < dayWindow.endUtcExclusive.getTime();
      })
      .map(toTodayTaskItem);
    const dayEvents = collected.eventsByDay.get(dayWindow.localDate) ?? [];
    // Caps apply to the emitted lists only -- the day's total stays honest.
    return {
      date: dayWindow.localDate,
      tasks: dayTasks.slice(0, UPCOMING_TASKS_PER_DAY_CAP),
      events: dayEvents.slice(0, UPCOMING_EVENTS_PER_DAY_CAP),
      total: dayTasks.length + dayEvents.length,
    };
  });

  const generatedAt = effectiveNow.toISOString();
  return WeeklyReviewContextSchema.parse({
    generated_at: generatedAt,
    effective_now: generatedAt,
    tz,
    period_start: weeklyPeriodStart(tz, effectiveNow),
    inbox_attention: collected.inboxAttention,
    overdue: boundTaskSection(collected.actionability.overdue, OVERDUE_ITEM_CAP),
    active_projects: collected.projectSections.active_projects,
    paused_projects: collected.projectSections.paused_projects,
    stalled_projects: collected.projectSections.stalled_projects,
    projects_without_next_action: collected.projectSections.projects_without_next_action,
    upcoming_7d: { days: upcomingDays },
    recently_completed: {
      items: collected.recentlyCompleted.items,
      total: collected.recentlyCompleted.total,
    },
  });
}
