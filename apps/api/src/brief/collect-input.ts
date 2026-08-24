// Checkpoint 5.5 -- deterministic collector for the manual AI Daily Brief
// (ADR-041). Builds the bounded, id-free BriefInput snapshot (contracts.ts)
// that is the ONLY thing ever reaching a prompt.
//
// Deliberately derives everything from buildTodayResponse rather than
// re-querying the database directly: Today already owns the frozen
// overdue/due-today/recurring-dedupe/stalled-project semantics
// (docs/ARCHITECTURE.md, "Today & agenda read models"), and re-deriving
// those rules here would be exactly the kind of duplication
// apps/api/src/read-models/review-contexts.ts already carries as debt. One
// effectiveNow is captured up front and threaded into Today's internal
// `options.now` test/derivation seam, so the brief and the Today screen can
// never disagree about "now".

import { captureEffectiveNow, truncateField } from "@personal-os/core";
import type { Db } from "@personal-os/db";
import type {
  TodayEventItem,
  TodayInboxItem,
  TodayProjectSummary,
  TodayResponse,
  TodayTaskItem,
  TodayUpcomingDay,
} from "@personal-os/schema";
import { buildTodayResponse } from "../read-models/today.js";
import {
  BRIEF_DUE_TODAY_CAP,
  BRIEF_EVENTS_TODAY_CAP,
  BRIEF_INBOX_SNIPPET_CAP,
  BRIEF_INBOX_SNIPPET_MAX_CHARS,
  BRIEF_LOCATION_MAX_CHARS,
  BRIEF_OVERDUE_CAP,
  BRIEF_PROJECTS_CAP,
  BRIEF_TITLE_MAX_CHARS,
  BRIEF_UPCOMING_PER_DAY_CAP,
  BRIEF_UPCOMING_TOTAL_CAP,
  MAX_BRIEF_INPUT_CHARS,
  type BriefEventItem,
  type BriefInput,
  type BriefProjectItem,
  type BriefTaskItem,
  type BriefUpcomingItem,
} from "./contracts.js";

function truncated(value: string, maxChars: number): string {
  return truncateField(value, maxChars).text;
}

// recurring = the Today item carries a non-null rrule (the series template)
// OR a non-null occurrence_id (it IS a materialized occurrence of one) --
// either signal alone means "this is part of a recurring series".
function toBriefTaskItem(item: TodayTaskItem): BriefTaskItem {
  return {
    title: truncated(item.title, BRIEF_TITLE_MAX_CHARS),
    due_at: item.due_at,
    project_name:
      item.project_name !== null ? truncated(item.project_name, BRIEF_TITLE_MAX_CHARS) : null,
    recurring: item.rrule !== null || Boolean(item.occurrence_id),
  };
}

function taskInstantMs(item: TodayTaskItem): number | null {
  return item.due_at !== null ? Date.parse(item.due_at) : null;
}

// For a TIMED recurring instance, TodayEventItem.starts_at stays the series
// template's original start (ADR-042) while occurs_at carries that instance's
// real instant, so preferring occurs_at reports the event's actual time.
//
// For an ALL-DAY event this is wrong and was the Checkpoint 5.7.1 defect:
// ADR-042 anchors an all-day series' DTSTART at LOCAL NOON, so a materialized
// all-day instance has starts_at === null and occurs_at === noon-local-as-UTC.
// Handing that to the model produced the production brief sentence
// "an all-day weekly event beginning at 12:00 PM".
//
// The all_day short-circuit is therefore load-bearing and must stay FIRST.
// (apps/api/src/read-models/review-contexts.ts holds the same expression and
// is safe only because a date-string branch returns above it.)
function eventEffectiveStart(item: TodayEventItem): string | null {
  if (item.all_day) return null;
  return item.occurs_at ?? item.starts_at;
}

// The instance's own calendar date, already re-pointed per instance by
// assembleEventRange (ADR-042). This is the only correct way to say *when* an
// all-day event happens.
function eventAllDayDate(item: TodayEventItem): string | null {
  return item.all_day ? item.start_date : null;
}

// Ordering only -- never rendered, never sent to the model. All-day items are
// hoisted ahead of timed ones by the caller before this is consulted, and this
// deliberately reads the raw fields (not eventEffectiveStart, which is now
// null for all-day) so that ordering behaviour is unchanged by the 5.7.1 fix.
function eventInstantMs(item: TodayEventItem): number | null {
  const value = item.occurs_at ?? item.starts_at;
  return value !== null ? Date.parse(value) : null;
}

function toBriefEventItem(item: TodayEventItem): BriefEventItem {
  return {
    title: truncated(item.title, BRIEF_TITLE_MAX_CHARS),
    starts_at: eventEffectiveStart(item),
    date: eventAllDayDate(item),
    all_day: item.all_day,
    location: item.location !== null ? truncated(item.location, BRIEF_LOCATION_MAX_CHARS) : null,
  };
}

interface UpcomingCandidate {
  date: string;
  kind: "task" | "event";
  title: string;
  allDay: boolean;
  instant: number | null;
}

// Flattens Today's per-day upcoming buckets into one chronological list:
// all-day entries first (same convention as agenda.ts's compareDayItems),
// then ascending by effective instant, capped per day and overall. Days
// arrive already in ascending date order from Today, so day-major iteration
// alone keeps the flattened list date-ordered even before the per-day sort.
function buildUpcoming(days: readonly TodayUpcomingDay[]): {
  items: BriefUpcomingItem[];
  total: number;
} {
  let total = 0;
  const items: BriefUpcomingItem[] = [];

  for (const day of days) {
    // Honest pre-cap total: Today's own per-day total, summed across every
    // day regardless of how much this collector goes on to cap or skip.
    total += day.total;
    if (items.length >= BRIEF_UPCOMING_TOTAL_CAP) continue;

    const candidates: UpcomingCandidate[] = [
      ...day.tasks.map((task): UpcomingCandidate => ({
        date: day.date,
        kind: "task",
        title: task.title,
        allDay: false,
        instant: taskInstantMs(task),
      })),
      ...day.events.map((event): UpcomingCandidate => ({
        date: day.date,
        kind: "event",
        title: event.title,
        allDay: event.all_day,
        instant: eventInstantMs(event),
      })),
    ];

    candidates.sort((a, b) => {
      if (a.allDay !== b.allDay) return a.allDay ? -1 : 1;
      if (a.instant !== null && b.instant !== null && a.instant !== b.instant) {
        return a.instant - b.instant;
      }
      const aNull = a.instant === null;
      const bNull = b.instant === null;
      if (aNull !== bNull) return aNull ? 1 : -1;
      if (a.kind !== b.kind) return a.kind === "event" ? -1 : 1;
      return a.title < b.title ? -1 : a.title > b.title ? 1 : 0;
    });

    for (const candidate of candidates.slice(0, BRIEF_UPCOMING_PER_DAY_CAP)) {
      if (items.length >= BRIEF_UPCOMING_TOTAL_CAP) break;
      items.push({
        date: candidate.date,
        kind: candidate.kind,
        title: truncated(candidate.title, BRIEF_TITLE_MAX_CHARS),
      });
    }
  }

  return { items, total };
}

// Stalled projects first, then active projects carrying a next_action, then
// the rest -- deterministic and stable (Array.prototype.sort is a stable
// sort per spec; a 0 comparator result for otherwise-equal-rank rows
// preserves Today's own incoming order, which is itself already
// deterministic).
function sortProjectsForBrief(
  items: readonly TodayProjectSummary[],
): readonly TodayProjectSummary[] {
  return [...items].sort((a, b) => {
    if (a.stalled !== b.stalled) return a.stalled ? -1 : 1;
    const aHasNext = a.next_action !== null;
    const bHasNext = b.next_action !== null;
    if (aHasNext !== bHasNext) return aHasNext ? -1 : 1;
    return 0;
  });
}

function toBriefProjectItem(item: TodayProjectSummary): BriefProjectItem {
  return {
    name: truncated(item.name, BRIEF_TITLE_MAX_CHARS),
    status: item.status,
    stalled: item.stalled,
    next_action:
      item.next_action !== null ? truncated(item.next_action.title, BRIEF_TITLE_MAX_CHARS) : null,
    open_task_count: item.open_task_count,
    overdue_task_count: item.overdue_task_count,
  };
}

function measure(input: BriefInput): number {
  return JSON.stringify(input).length;
}

/**
 * Collects and bounds the Daily Brief's model input from the Today read
 * model. Every free-text field is character-truncated (packages/core's
 * truncateField) and every list is item-capped (contracts.ts's BRIEF_*_CAP
 * constants) before the whole-payload ceiling (MAX_BRIEF_INPUT_CHARS) is
 * ever measured. All ids (task/project/occurrence/event uuids) are
 * deliberately dropped in the Today -> BriefInput mapping -- BriefInput
 * carries no internal identifiers by construction.
 */
export async function collectBriefInput(
  db: Db,
  opts: { tz: string; now?: Date },
): Promise<{ input: BriefInput; localDate: string; effectiveNow: Date }> {
  const effectiveNow = captureEffectiveNow(opts.now);
  const today: TodayResponse = await buildTodayResponse(db, { tz: opts.tz }, { now: effectiveNow });

  const upcoming = buildUpcoming(today.upcoming.days);
  const sortedProjects = sortProjectsForBrief(today.projects.items);
  const inboxSnippets = today.inbox.items
    .filter((item): item is TodayInboxItem & { raw_text: string } => item.raw_text !== null)
    .slice(0, BRIEF_INBOX_SNIPPET_CAP)
    .map((item) => truncated(item.raw_text, BRIEF_INBOX_SNIPPET_MAX_CHARS));

  let input: BriefInput = {
    generated_at: effectiveNow.toISOString(),
    tz: today.tz,
    local_date: today.local_date,
    summary: {
      overdue_total: today.summary.overdue_total,
      due_today_total: today.summary.due_today_total,
      inbox_attention_total: today.summary.inbox_attention_total,
      active_project_count: today.summary.active_project_count,
    },
    overdue: {
      items: today.overdue.items.slice(0, BRIEF_OVERDUE_CAP).map(toBriefTaskItem),
      // Honest pre-cap total straight from Today's own total, never
      // items.length -- capping can never make the brief understate reality.
      total: today.overdue.total,
    },
    due_today: {
      items: today.due_today.items.slice(0, BRIEF_DUE_TODAY_CAP).map(toBriefTaskItem),
      total: today.due_today.total,
    },
    events_today: {
      items: today.events_today.items.slice(0, BRIEF_EVENTS_TODAY_CAP).map(toBriefEventItem),
      // Today's events_today section carries no total of its own (it is not
      // capped there either) -- the true pre-cap count is the length of the
      // full item list Today returned, observed before this collector's
      // own slice above.
      total: today.events_today.items.length,
    },
    upcoming,
    inbox: {
      pending_count: today.inbox.pending_count,
      needs_confirm_count: today.inbox.needs_confirm_count,
      failed_count: today.inbox.failed_count,
      snippets: inboxSnippets,
    },
    projects: {
      items: sortedProjects.slice(0, BRIEF_PROJECTS_CAP).map(toBriefProjectItem),
      // Today's projects section is already restricted to non-archived
      // status='active' projects, and active_count is its honest pre-cap
      // total over exactly that set -- the same denominator this section
      // draws its (sorted, capped) items from.
      total: today.summary.active_project_count,
    },
    reviews: {
      daily_status: today.reviews.daily.status,
      weekly_status: today.reviews.weekly.status,
    },
  };

  // Whole-payload ceiling: re-measure and drop WHOLE lower-priority sections
  // in a fixed order, never slice serialized JSON (which could emit an
  // invalid document). Overdue/due-today/events-today are never reduced
  // here -- they are the most time-critical sections and are already
  // tightly capped above.
  let size = measure(input);
  if (size > MAX_BRIEF_INPUT_CHARS) {
    input = { ...input, upcoming: { ...input.upcoming, items: [] } };
    size = measure(input);
  }
  if (size > MAX_BRIEF_INPUT_CHARS) {
    input = { ...input, projects: { ...input.projects, items: [] } };
    size = measure(input);
  }
  if (size > MAX_BRIEF_INPUT_CHARS) {
    input = { ...input, inbox: { ...input.inbox, snippets: [] } };
    size = measure(input);
  }
  // Last resort: trim the time-critical sections too. An audit proved these
  // three alone can exceed the ceiling on an ordinary busy day once their
  // capped items carry real titles/projects/locations, so treating them as
  // irreducible made the throw below reachable -- i.e. a legitimate user
  // could get an opaque 500 instead of a brief. Trimming drops WHOLE items
  // from the currently-largest section, one at a time, deterministically;
  // `total` is never touched, so the model is still told how much exists
  // ("8 overdue, 3 shown") and the brief stays honest rather than absent.
  while (size > MAX_BRIEF_INPUT_CHARS) {
    const sections = [
      { key: "overdue" as const, count: input.overdue.items.length },
      { key: "due_today" as const, count: input.due_today.items.length },
      { key: "events_today" as const, count: input.events_today.items.length },
    ];
    // Deterministic: strictly-greater comparison keeps the first section in
    // this fixed order on a tie, so the same input always trims identically.
    let largest = sections[0]!;
    for (const section of sections) {
      if (section.count > largest.count) largest = section;
    }
    if (largest.count === 0) break;
    const trimmed = input[largest.key].items.slice(0, largest.count - 1);
    input = {
      ...input,
      [largest.key]: { ...input[largest.key], items: trimmed },
    };
    size = measure(input);
  }

  if (size > MAX_BRIEF_INPUT_CHARS) {
    // Genuinely unreachable: every list is now empty and the remaining
    // envelope (counts, tz, dates, review flags) is a few hundred chars.
    // Reaching here means a constant was changed without re-checking, which
    // is a programmer error, not a runtime condition to degrade from.
    throw new Error(
      `brief input still exceeds MAX_BRIEF_INPUT_CHARS (${MAX_BRIEF_INPUT_CHARS}) with every item list emptied: measured ${size} chars`,
    );
  }

  return { input, localDate: today.local_date, effectiveNow };
}
