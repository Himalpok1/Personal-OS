import {
  resolveWallClockToInstant,
  toWallClockComponents,
  type WallClockComponents,
} from "./timezone.js";

// Frozen semantics: docs/ARCHITECTURE.md, "Today & agenda read models
// (frozen semantics, ADR-038/039/041)". Pure functions only -- every
// caller supplies its own single effectiveNow per read-model build.

export interface LocalDayWindow {
  startUtc: Date;
  endUtcExclusive: Date;
  localDate: string;
  timezone: string;
}

const LOCAL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

export function formatLocalDate(components: WallClockComponents): string {
  return `${String(components.year).padStart(4, "0")}-${pad2(components.month)}-${pad2(components.day)}`;
}

function nextCalendarDate(
  year: number,
  month: number,
  day: number,
): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day, 12) + 24 * 60 * 60 * 1000);
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

// Shifts a "YYYY-MM-DD" local calendar date by `days` (may be negative),
// anchored at noon UTC so month/year rollovers and DST can never skew the
// result by a day -- the same idiom nextCalendarDate above uses for a
// single-day step, generalized to an arbitrary offset.
export function addCalendarDays(localDate: string, days: number): string {
  const match = LOCAL_DATE.exec(localDate);
  if (!match) throw new Error(`invalid local date "${localDate}", expected YYYY-MM-DD`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const shifted = new Date(Date.UTC(year, month - 1, day, 12) + days * 24 * 60 * 60 * 1000);
  return `${String(shifted.getUTCFullYear()).padStart(4, "0")}-${pad2(shifted.getUTCMonth() + 1)}-${pad2(shifted.getUTCDate())}`;
}

function firstInstantOfLocalDate(timezone: string, target: WallClockComponents): Date {
  const localDate = formatLocalDate(target);
  const literalMidnight: WallClockComponents = {
    ...target,
    hour: 0,
    minute: 0,
    second: 0,
  };
  let candidate = resolveWallClockToInstant(literalMidnight, timezone);
  // In zones whose DST transition lands exactly on midnight, the resolved
  // instant can still render as the previous local date; advance until the
  // rendered date is the requested one (bounded scan, transitions are < 2h).
  for (let i = 0; i < 200; i += 1) {
    const rendered = formatLocalDate(toWallClockComponents(candidate, timezone));
    if (rendered === localDate) return candidate;
    candidate = new Date(candidate.getTime() + 15 * 60 * 1000);
  }
  throw new Error(`cannot resolve start of local day ${localDate} in "${timezone}"`);
}

function buildWindow(timezone: string, components: WallClockComponents): LocalDayWindow {
  const localDate = formatLocalDate(components);
  const startUtc = firstInstantOfLocalDate(timezone, components);
  const nextDay = nextCalendarDate(components.year, components.month, components.day);
  const endUtcExclusive = firstInstantOfLocalDate(timezone, {
    ...nextDay,
    hour: 0,
    minute: 0,
    second: 0,
  });
  if (endUtcExclusive.getTime() <= startUtc.getTime()) {
    throw new Error(`degenerate local day ${localDate} in "${timezone}"`);
  }
  return { startUtc, endUtcExclusive, localDate, timezone };
}

export function localDayWindow(timezone: string, at?: Date): LocalDayWindow {
  return buildWindow(timezone, toWallClockComponents(at ?? new Date(), timezone));
}

export function localDayWindowForDate(timezone: string, localDate: string): LocalDayWindow {
  const match = LOCAL_DATE.exec(localDate);
  if (!match) throw new Error(`invalid local date "${localDate}", expected YYYY-MM-DD`);
  return buildWindow(timezone, {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
    hour: 0,
    minute: 0,
    second: 0,
  });
}

export type ActionabilityCategory = "overdue" | "due_today" | "upcoming";

export function categorizeInstant(params: {
  instant: Date;
  effectiveNow: Date;
  window: LocalDayWindow;
}): ActionabilityCategory {
  const { instant, effectiveNow, window } = params;
  if (instant.getTime() < effectiveNow.getTime()) {
    return "overdue";
  }
  if (
    instant.getTime() >= window.startUtc.getTime() &&
    instant.getTime() < window.endUtcExclusive.getTime()
  ) {
    return "due_today";
  }
  return "upcoming";
}

interface Row<TTask> {
  task: TTask;
  sortInstant: Date | null;
  sortKey: string;
}

function compareRows<TTask>(a: Row<TTask>, b: Row<TTask>): number {
  if (a.sortInstant === null || b.sortInstant === null) {
    if (a.sortInstant === b.sortInstant) {
      return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
    }
    return a.sortInstant === null ? 1 : -1;
  }
  const delta = a.sortInstant.getTime() - b.sortInstant.getTime();
  if (delta !== 0) return delta;
  return a.sortKey < b.sortKey ? -1 : a.sortKey > b.sortKey ? 1 : 0;
}

export interface ActionableView<TTask> {
  overdue: TTask[];
  dueToday: TTask[];
  upcoming: TTask[];
}

export interface BuildActionableViewParams<TTask, TOcc> {
  effectiveNow: Date;
  window: LocalDayWindow;
  horizonEndUtc?: Date;
  tasks: TTask[];
  occurrences: TOcc[];
  taskKey: (t: TTask) => string;
  occParentKey: (o: TOcc) => string;
  occKey: (o: TOcc) => string;
  occStatus: (o: TOcc) => "scheduled" | "done" | "skipped";
  occOccursAt: (o: TOcc) => Date;
  actionableInstantOfTask: (t: TTask) => Date | null;
  mergeIntoOccurrence: (parent: TTask, occ: TOcc) => TTask;
}

export function buildActionableView<TTask, TOcc>(
  params: BuildActionableViewParams<TTask, TOcc>,
): ActionableView<TTask> {
  const buckets: Record<ActionabilityCategory, Row<TTask>[]> = {
    overdue: [],
    due_today: [],
    upcoming: [],
  };
  const place = (row: Row<TTask>): void => {
    if (row.sortInstant === null) {
      // Undated open work is actionable today; sorts last within the bucket.
      buckets.due_today.push(row);
      return;
    }
    buckets[
      categorizeInstant({
        instant: row.sortInstant,
        effectiveNow: params.effectiveNow,
        window: params.window,
      })
    ].push(row);
  };

  const parentByKey = new Map<string, TTask>();
  for (const task of params.tasks) {
    parentByKey.set(params.taskKey(task), task);
  }

  const scheduledByParent = new Map<string, TOcc[]>();
  const seenOccKeys = new Set<string>();
  for (const occ of params.occurrences) {
    if (params.occStatus(occ) !== "scheduled") continue;
    const occKey = params.occKey(occ);
    if (seenOccKeys.has(occKey)) continue;
    seenOccKeys.add(occKey);
    const parentKey = params.occParentKey(occ);
    if (!parentByKey.has(parentKey)) continue;
    const existing = scheduledByParent.get(parentKey);
    if (existing === undefined) {
      scheduledByParent.set(parentKey, [occ]);
    } else {
      existing.push(occ);
    }
  }

  // Scheduled occurrences are THE actionable representations of their parent
  // -- the bare parent is suppressed whenever any scheduled occurrence exists,
  // regardless of how the parent is flagged. Done/skipped occurrences are
  // excluded entirely.
  for (const [parentKey, occs] of scheduledByParent) {
    const parent = parentByKey.get(parentKey);
    if (parent === undefined) continue;
    for (const occ of occs) {
      place({
        task: params.mergeIntoOccurrence(parent, occ),
        sortInstant: params.occOccursAt(occ),
        sortKey: params.occKey(occ),
      });
    }
  }

  for (const task of params.tasks) {
    const key = params.taskKey(task);
    if (scheduledByParent.has(key)) continue;
    place({ task, sortInstant: params.actionableInstantOfTask(task), sortKey: key });
  }

  let upcomingRows = buckets.upcoming;
  if (params.horizonEndUtc !== undefined) {
    const horizon = params.horizonEndUtc.getTime();
    upcomingRows = upcomingRows.filter(
      (row) => row.sortInstant !== null && row.sortInstant.getTime() < horizon,
    );
  }

  const finish = (rows: Row<TTask>[]): TTask[] =>
    rows
      .slice()
      .sort(compareRows)
      .map((row) => row.task);

  return {
    overdue: finish(buckets.overdue),
    dueToday: finish(buckets.due_today),
    upcoming: finish(upcomingRows),
  };
}

export function captureEffectiveNow(now?: Date): Date {
  return now ?? new Date();
}
