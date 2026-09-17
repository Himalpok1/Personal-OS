import {
  composeBriefing,
  type Briefing,
  type BriefingAcademicInput,
  type BriefingEventInput,
  type BriefingHealthInput,
  type BriefingInput,
  type BriefingLine,
} from "@personal-os/core/focus-now/briefing";
import type {
  AcademicTodayResponse,
  HealthSummaryResponse,
  TodayEventItem,
  TodayResponse,
} from "@personal-os/schema";
import { focusNowRows, type FocusNowRow } from "./focus-now-card-state";

// Pure, React-free adaptation of the three responses the Today screen
// already fetches into core's `BriefingInput` (Checkpoint 10.6, ADR-075 §4):
// the briefing is a deterministic client composition, never a read model
// and never a model call. `effectiveNow` is the caller's one instant --
// Today's own query `dataUpdatedAt`, never a clock read in render.
//
// What is passed and when:
//   today      always (the card renders nothing without it)
//   academic   only when the response says `configured` -- an unconfigured
//              or still-loading academic source contributes NO section and
//              NO count, rather than a zero
//   health     only once the summary has loaded and is configured; core
//              itself then decides whether the sleep line has anything
//              honest to say (both instants present, wake date today or
//              yesterday)
//   focus      the same merged, ranked rows the Focus Now card shows, so a
//              "Focus now" line and the card below it never disagree

/**
 * The instants a Today event occupies. For a timed RECURRING instance the
 * read model emits `starts_at`/`ends_at` as the series TEMPLATE's instants
 * and `occurs_at` as today's real one (`apps/api/src/read-models/
 * event-range.ts`), so the start is `occurs_at ?? starts_at` -- the same
 * precedence `apps/api/src/brief/collect-input.ts` documents -- and the end
 * is that start plus the template's duration, since the wire carries no
 * per-instance end. A one-off event has `occurs_at === null` and resolves to
 * its own `starts_at`/`ends_at` unchanged. (Checkpoint 10.6 review, finding 1.)
 */
export function eventInput(event: TodayEventItem): BriefingEventInput {
  const start = event.occurs_at ?? event.starts_at;
  const durationMs =
    event.starts_at !== null && event.ends_at !== null
      ? Date.parse(event.ends_at) - Date.parse(event.starts_at)
      : null;
  const startsAt = start === null ? null : new Date(start);
  const endsAt =
    startsAt === null || durationMs === null ? null : new Date(startsAt.getTime() + durationMs);
  return { title: event.title, startsAt, endsAt, allDay: event.all_day };
}

function academicInput(academic: AcademicTodayResponse | undefined): BriefingAcademicInput | null {
  if (academic === undefined || !academic.configured) return null;
  return {
    configured: true,
    overdueTotal: academic.summary.overdue_total,
    dueTodayTotal: academic.summary.due_today_total,
    dueThisWeekTotal: academic.summary.due_this_week_total,
    workloadStatus: academic.workload?.status ?? null,
    unreadAnnouncements: academic.summary.unread_announcements_total,
  };
}

function healthInput(health: HealthSummaryResponse | undefined): BriefingHealthInput | null {
  if (health === undefined || !health.configured) return null;
  return {
    latestSleepSeconds: health.latest_sleep?.duration_seconds ?? null,
    latestSleepWakeLocalDate: health.latest_sleep?.wake_local_date ?? null,
    sleep7dAverageSeconds: health.sleep_7d_average_seconds,
  };
}

export function briefingInput(
  today: TodayResponse,
  academic: AcademicTodayResponse | undefined,
  health: HealthSummaryResponse | undefined,
  focus: readonly FocusNowRow[],
  effectiveNow: Date,
): BriefingInput {
  return {
    effectiveNow,
    tz: today.tz,
    today: {
      overdueTotal: today.summary.overdue_total,
      dueTodayTotal: today.summary.due_today_total,
      eventsToday: today.events_today.items.map(eventInput),
      inboxAttentionTotal: today.summary.inbox_attention_total,
    },
    academic: academicInput(academic),
    health: healthInput(health),
    focus,
  };
}

export interface BriefingView {
  briefing: Briefing;
  /** The focus rows the briefing named, kept so a "Focus now" line can open its row. */
  focus: FocusNowRow[];
}

/**
 * The briefing for the screen, or null while `today` is not loaded (the
 * screen shows its skeleton then). The focus rows are the Focus Now card's
 * own (`focusNowRows`), which are empty -- never null -- here when the
 * academic source has not loaded, so the briefing can still lead with the
 * personal counts.
 */
export function briefingFor(
  today: TodayResponse | undefined,
  academic: AcademicTodayResponse | undefined,
  health: HealthSummaryResponse | undefined,
  effectiveNow: Date,
): BriefingView | null {
  if (today === undefined) return null;
  const focus = focusNowRows(today, academic, effectiveNow) ?? [];
  return {
    briefing: composeBriefing(briefingInput(today, academic, health, focus, effectiveNow)),
    focus,
  };
}

/** What a line's `ref` opens: the task screen, or the assignment sheet for one of the focus rows. */
export type BriefingLineTarget =
  | { kind: "task"; taskId: string }
  | { kind: "assignment"; row: Extract<FocusNowRow, { kind: "academic_assignment" }> }
  | null;

export function briefingLineTarget(
  line: BriefingLine,
  focus: readonly FocusNowRow[],
): BriefingLineTarget {
  if (line.ref === undefined) return null;
  if (line.ref.kind === "task") return { kind: "task", taskId: line.ref.id };
  if (line.ref.kind === "academic_assignment") {
    const row = focus.find(
      (candidate): candidate is Extract<FocusNowRow, { kind: "academic_assignment" }> =>
        candidate.kind === "academic_assignment" && candidate.id === line.ref?.id,
    );
    return row === undefined ? null : { kind: "assignment", row };
  }
  return null;
}
