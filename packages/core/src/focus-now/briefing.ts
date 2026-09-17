// The deterministic daily briefing (Checkpoint 10.6, ADR-075; a
// working-hours memory added by Checkpoint 10.7, ADR-077 §5) -- a
// CLIENT-SIDE composition over responses the Today screen has ALREADY
// fetched, expressed here as pure logic over structural inputs.
//
// NOT A SERVER READ MODEL, BY STRUCTURAL NECESSITY. Guard 5 (`apps/api/src/
// ask/ai-egress-guard.test.ts`) forbids `read-models/today.ts` from
// touching academic data, and ADR-046 keeps Health passive and out of every
// server-side aggregate an AI collector consumes; a `/today` that also
// carried academic and sleep lines would breach both walls at once. This
// module therefore takes the SHAPES of `GET /today`, `GET /academic/today`
// and the health summary as duck-typed inputs (core never imports
// `@personal-os/schema`) and composes text from them on the client, the
// same lane `score.ts` already occupies (ADR-072 §1). No model call, nothing
// stored, no clock read: the caller passes its one `effectiveNow`.
//
// ===========================================================================
// A SECTION IS OMITTED WHEN ITS SOURCE HAS NOTHING TO SAY -- NEVER INVENTED
// ===========================================================================
//
//   academic   only when the source is present AND `configured`; one line per
//              non-zero count ("N overdue" · "N due today" · "N due this
//              week" · "N unread announcements") plus the workload phrase
//              (behind → "You're behind" · at_risk → "At risk" · on_track →
//              "On track"), each toned by what it reports
//   schedule   "N events today" when there are any; "Next: <title> at HH:mm"
//              for the first TIMED event starting at or after effectiveNow;
//              up to two "Free HH:mm–HH:mm (Nh MMm)" lines from
//              `freeBlocks` (free-blocks.ts). Omitted when there is neither
//              an event nor a free block. When `memory.workingHours` is
//              supplied (ADR-077 §5: the owner's working-hours `preference`
//              memory, parsed by `memoryWorkingHours` in memory/match.ts) the
//              free blocks are computed inside THOSE bounds instead of the
//              08:00–22:00 defaults, and one line "Working hours HH:mm–HH:mm
//              — from your preferences" with `source: "memory"` and no `ref`
//              precedes them, so the reader can see why the free time is
//              bounded as it is. An invalid pair is ignored (defaults, no
//              line) -- data never throws. With the memory switch off the
//              caller passes nothing and the section is the 10.6 one
//   health     only when the latest sleep, its wake date AND the 7-day
//              average are all present, the average is positive, and the
//              wake date is today or yesterday in `tz` -- older sleep is not
//              "last night". "Slept 6h 10m — below your 7-day average
//              (7h 05m)": below ⟺ < 90 % of the average (warning); above ⟺
//              > 110 % (success); otherwise "in line with" (neutral)
//   focus      the top BRIEFING_FOCUS_LIMIT (3) already-merged, already-ranked
//              candidates as "<title> — <primary why>", each carrying a `ref`
//              so the client can navigate; a candidate with no reason is its
//              bare title. A line's `source` is its primary reason's, so a
//              row whose only reason is a memory reason reads `memory`
//
// Every wall-clock string is rendered in the caller's `tz` through the same
// Intl-backed `toWallClockComponents` the rest of core uses; every count
// line is a fixed template, so identical inputs are byte-identical.
//
// The headline is one sentence from the combined personal + academic counts:
// "2 overdue, 1 due today, 3 events." or "Nothing due today." (with ", N
// events" appended when there are events but nothing due).
import { addCalendarDays, localDayWindow } from "../actionability.js";
import { toWallClockComponents } from "../timezone.js";
import { explainFocusNowCandidate } from "./explain.js";
import { freeBlocks, isValidFreeBlockWindow } from "./free-blocks.js";
import type { FocusNowSource } from "./reasons.js";
import type { FocusNowCandidate, FocusNowKind } from "./score.js";

/** The number of focus candidates the briefing names. */
export const BRIEFING_FOCUS_LIMIT = 3;
/** The number of free-block lines the schedule section names. */
export const BRIEFING_FREE_BLOCK_LIMIT = 2;
/** "below" the 7-day average ⟺ latest < average × this. */
export const BRIEFING_SLEEP_BELOW_RATIO = 0.9;
/** "above" the 7-day average ⟺ latest > average × this. */
export const BRIEFING_SLEEP_ABOVE_RATIO = 1.1;

export interface BriefingEventInput {
  title: string;
  startsAt: Date | null;
  endsAt: Date | null;
  allDay: boolean;
}

export interface BriefingTodayInput {
  overdueTotal: number;
  dueTodayTotal: number;
  eventsToday: readonly BriefingEventInput[];
  inboxAttentionTotal: number;
}

export interface BriefingAcademicInput {
  configured: boolean;
  overdueTotal: number;
  dueTodayTotal: number;
  dueThisWeekTotal: number;
  workloadStatus: "on_track" | "at_risk" | "behind" | null;
  unreadAnnouncements: number;
}

export interface BriefingHealthInput {
  latestSleepSeconds: number | null;
  /** The civil END (wake) date of the latest sleep session, "YYYY-MM-DD" (ADR-049). */
  latestSleepWakeLocalDate: string | null;
  sleep7dAverageSeconds: number | null;
}

/** The one structured preference the briefing reads (ADR-077 §5): `memoryWorkingHours`' result. */
export interface BriefingWorkingHours {
  dayStartHour: number;
  dayEndHour: number;
}

export interface BriefingMemoryInput {
  /** Null/absent when no `preference` memory states working hours, or when the memory switch is off. */
  workingHours?: BriefingWorkingHours | null;
}

export interface BriefingInput {
  effectiveNow: Date;
  tz: string;
  today: BriefingTodayInput;
  academic?: BriefingAcademicInput | null;
  health?: BriefingHealthInput | null;
  /** Already merged (`mergeLinkedCandidates`) and ranked (`rankFocusNowCandidates`). */
  focus: readonly FocusNowCandidate[];
  /** Memory-derived inputs (ADR-077 §5); absent ⇒ memories treated as absent. */
  memory?: BriefingMemoryInput | null;
}

export const BRIEFING_SECTION_KINDS = ["academic", "schedule", "health", "focus"] as const;
export type BriefingSectionKind = (typeof BRIEFING_SECTION_KINDS)[number];

export type BriefingTone = "neutral" | "warning" | "danger" | "success";

export interface BriefingLine {
  text: string;
  source: FocusNowSource | "health";
  tone: BriefingTone;
  /** The row a line is about, when it is about one; the client navigates on it. */
  ref?: { kind: FocusNowKind; id: string };
}

export interface BriefingSection {
  kind: BriefingSectionKind;
  title: string;
  lines: BriefingLine[];
}

export interface Briefing {
  sections: BriefingSection[];
  headline: string;
}

/** The section titles, frozen. */
export const BRIEFING_SECTION_TITLE: Readonly<Record<BriefingSectionKind, string>> = {
  academic: "Academics",
  schedule: "Schedule",
  health: "Health",
  focus: "Focus now",
};

// ---------------------------------------------------------------------------
// Formatting helpers (none existed in core before this checkpoint)
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Whole seconds → "6h 10m" / "7h 05m" / "45m" (minutes zero-padded once an
 * hour is present, so a column of durations lines up). Negative or
 * non-finite input reads as zero.
 */
export function formatDurationShort(seconds: number): string {
  const whole = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  return hours === 0 ? `${minutes}m` : `${hours}h ${pad2(minutes)}m`;
}

/** An instant's wall clock in `tz` as 24-hour "HH:mm". */
export function formatWallTime(instant: Date, tz: string): string {
  const { hour, minute } = toWallClockComponents(instant, tz);
  return `${pad2(hour)}:${pad2(minute)}`;
}

function pluralize(count: number, singular: string, plural = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

const WORKLOAD_PHRASE: Readonly<
  Record<NonNullable<BriefingAcademicInput["workloadStatus"]>, { text: string; tone: BriefingTone }>
> = {
  behind: { text: "You're behind", tone: "danger" },
  at_risk: { text: "At risk", tone: "warning" },
  on_track: { text: "On track", tone: "success" },
};

function academicSection(
  academic: BriefingAcademicInput | null | undefined,
): BriefingSection | null {
  if (academic === null || academic === undefined || !academic.configured) return null;
  const lines: BriefingLine[] = [];
  if (academic.overdueTotal > 0) {
    lines.push({
      text: `${academic.overdueTotal} overdue`,
      source: "canvas_assignment",
      tone: "danger",
    });
  }
  if (academic.dueTodayTotal > 0) {
    lines.push({
      text: `${academic.dueTodayTotal} due today`,
      source: "canvas_assignment",
      tone: "warning",
    });
  }
  if (academic.dueThisWeekTotal > 0) {
    lines.push({
      text: `${academic.dueThisWeekTotal} due this week`,
      source: "canvas_assignment",
      tone: "neutral",
    });
  }
  if (academic.workloadStatus !== null) {
    const phrase = WORKLOAD_PHRASE[academic.workloadStatus];
    lines.push({ text: phrase.text, source: "canvas_assignment", tone: phrase.tone });
  }
  if (academic.unreadAnnouncements > 0) {
    lines.push({
      text: pluralize(academic.unreadAnnouncements, "unread announcement"),
      source: "course",
      tone: "neutral",
    });
  }
  return lines.length === 0
    ? null
    : { kind: "academic", title: BRIEFING_SECTION_TITLE.academic, lines };
}

/** The first timed event starting at or after effectiveNow: earliest start, then title, so ties are stable. */
function nextEvent(
  events: readonly BriefingEventInput[],
  effectiveNow: Date,
): (BriefingEventInput & { startsAt: Date }) | null {
  const nowMs = effectiveNow.getTime();
  let best: (BriefingEventInput & { startsAt: Date }) | null = null;
  for (const event of events) {
    if (event.allDay || event.startsAt === null) continue;
    if (event.startsAt.getTime() < nowMs) continue;
    const candidate = { ...event, startsAt: event.startsAt };
    if (
      best === null ||
      candidate.startsAt.getTime() < best.startsAt.getTime() ||
      (candidate.startsAt.getTime() === best.startsAt.getTime() && candidate.title < best.title)
    ) {
      best = candidate;
    }
  }
  return best;
}

/** "HH:mm" for a whole local hour (24 renders as "24:00", the end of the local day). */
function formatHour(hour: number): string {
  return `${pad2(hour)}:00`;
}

/** The memory's working hours when they are a pair `freeBlocks` accepts; otherwise null (defaults). */
function workingHoursOf(input: BriefingInput): BriefingWorkingHours | null {
  const hours = input.memory?.workingHours;
  if (hours === undefined || hours === null) return null;
  return isValidFreeBlockWindow(hours.dayStartHour, hours.dayEndHour) ? hours : null;
}

function scheduleSection(input: BriefingInput): BriefingSection | null {
  const { eventsToday } = input.today;
  const lines: BriefingLine[] = [];
  if (eventsToday.length > 0) {
    lines.push({
      text: pluralize(eventsToday.length, "event") + " today",
      source: "calendar",
      tone: "neutral",
    });
  }
  const next = nextEvent(eventsToday, input.effectiveNow);
  if (next !== null) {
    lines.push({
      text: `Next: ${next.title} at ${formatWallTime(next.startsAt, input.tz)}`,
      source: "calendar",
      tone: "neutral",
    });
  }
  const workingHours = workingHoursOf(input);
  const blocks = freeBlocks({
    events: eventsToday,
    effectiveNow: input.effectiveNow,
    tz: input.tz,
    ...(workingHours === null
      ? {}
      : { dayStartHour: workingHours.dayStartHour, dayEndHour: workingHours.dayEndHour }),
  });
  if (workingHours !== null && (lines.length > 0 || blocks.length > 0)) {
    lines.push({
      text: `Working hours ${formatHour(workingHours.dayStartHour)}–${formatHour(workingHours.dayEndHour)} — from your preferences`,
      source: "memory",
      tone: "neutral",
    });
  }
  for (const block of blocks.slice(0, BRIEFING_FREE_BLOCK_LIMIT)) {
    lines.push({
      text: `Free ${formatWallTime(block.startUtc, input.tz)}–${formatWallTime(block.endUtc, input.tz)} (${formatDurationShort(block.minutes * 60)})`,
      source: "calendar",
      tone: "neutral",
    });
  }
  return lines.length === 0
    ? null
    : { kind: "schedule", title: BRIEFING_SECTION_TITLE.schedule, lines };
}

function healthSection(input: BriefingInput): BriefingSection | null {
  const health = input.health;
  if (health === null || health === undefined) return null;
  const { latestSleepSeconds, latestSleepWakeLocalDate, sleep7dAverageSeconds } = health;
  if (latestSleepSeconds === null || latestSleepWakeLocalDate === null) return null;
  if (sleep7dAverageSeconds === null || sleep7dAverageSeconds <= 0) return null;

  const todayLocalDate = localDayWindow(input.tz, input.effectiveNow).localDate;
  const yesterdayLocalDate = addCalendarDays(todayLocalDate, -1);
  if (
    latestSleepWakeLocalDate !== todayLocalDate &&
    latestSleepWakeLocalDate !== yesterdayLocalDate
  ) {
    return null;
  }

  const ratio = latestSleepSeconds / sleep7dAverageSeconds;
  let comparison: string;
  let tone: BriefingTone;
  if (ratio < BRIEFING_SLEEP_BELOW_RATIO) {
    comparison = "below";
    tone = "warning";
  } else if (ratio > BRIEFING_SLEEP_ABOVE_RATIO) {
    comparison = "above";
    tone = "success";
  } else {
    comparison = "in line with";
    tone = "neutral";
  }
  const text = `Slept ${formatDurationShort(latestSleepSeconds)} — ${comparison} your 7-day average (${formatDurationShort(sleep7dAverageSeconds)})`;
  return {
    kind: "health",
    title: BRIEFING_SECTION_TITLE.health,
    lines: [{ text, source: "health", tone }],
  };
}

/** The tone a focus line takes from its primary reason: the two "already wrong" reasons are danger, the two "about to be" are warning. */
function focusTone(candidate: FocusNowCandidate): BriefingTone {
  const primary = candidate.reasons[0];
  if (primary === "overdue" || primary === "marked_missing") return "danger";
  if (primary === "due_within_24h" || primary === "marked_late") return "warning";
  return "neutral";
}

function focusSection(focus: readonly FocusNowCandidate[]): BriefingSection | null {
  if (focus.length === 0) return null;
  const lines: BriefingLine[] = focus.slice(0, BRIEFING_FOCUS_LIMIT).map((candidate) => {
    const { primary } = explainFocusNowCandidate(candidate);
    return {
      text: primary === null ? candidate.title : `${candidate.title} — ${primary.why}`,
      source:
        primary?.source ??
        (candidate.kind === "academic_assignment" ? "canvas_assignment" : "task"),
      tone: focusTone(candidate),
      ref: { kind: candidate.kind, id: candidate.id },
    };
  });
  return { kind: "focus", title: BRIEFING_SECTION_TITLE.focus, lines };
}

// ---------------------------------------------------------------------------
// Headline
// ---------------------------------------------------------------------------

function headline(input: BriefingInput): string {
  const academic = input.academic?.configured === true ? input.academic : null;
  const overdue = input.today.overdueTotal + (academic?.overdueTotal ?? 0);
  const dueToday = input.today.dueTodayTotal + (academic?.dueTodayTotal ?? 0);
  const events = input.today.eventsToday.length;
  const eventsPart = events > 0 ? pluralize(events, "event") : null;
  if (overdue === 0 && dueToday === 0) {
    return eventsPart === null ? "Nothing due today." : `Nothing due today, ${eventsPart}.`;
  }
  const parts: string[] = [];
  if (overdue > 0) parts.push(`${overdue} overdue`);
  if (dueToday > 0) parts.push(`${dueToday} due today`);
  if (eventsPart !== null) parts.push(eventsPart);
  return `${parts.join(", ")}.`;
}

/**
 * Composes the briefing (see the module comment for every rule). Sections
 * come out in `BRIEFING_SECTION_KINDS` order, each omitted when it has
 * nothing to say.
 */
export function composeBriefing(input: BriefingInput): Briefing {
  const sections: BriefingSection[] = [];
  const academic = academicSection(input.academic);
  if (academic !== null) sections.push(academic);
  const schedule = scheduleSection(input);
  if (schedule !== null) sections.push(schedule);
  const health = healthSection(input);
  if (health !== null) sections.push(health);
  const focus = focusSection(input.focus);
  if (focus !== null) sections.push(focus);
  return { sections, headline: headline(input) };
}
