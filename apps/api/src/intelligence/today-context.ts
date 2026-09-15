// Checkpoint 9.7 -- `buildTodayContext`: THE bounded context builder (ADR-066).
//
// This is the one function the Ask lane calls for "Ask about today", and it is
// written as the implementation a future `get_today_context` read tool would
// bind unchanged (packages/schema intelligence-tools.ts) -- one implementation,
// two callers. It reads ONLY through existing read models
// (buildTodayResponse, collectRecentlyCompleted, buildRemindersResponse), never
// a table, and it emits the id-free `TodayContext` for the prompt PLUS a
// server-side citation map the prompt never sees.
//
// INVARIANTS, each pinned by today-context.test.ts:
//   - `assertGrant` is the FIRST statement: a forged or absent grant throws
//     before a single row is read (ask/authorize.ts).
//   - ONE `effectiveNow` (ctx.effectiveNow) is threaded into all three read
//     models, so no section can disagree with the Today screen.
//   - Nothing in `context` is an id, a uuid, an instant, a body, a
//     description, an rrule, an email or a URL: every time is a wall-clock
//     `YYYY-MM-DD HH:mm` in ctx.tz (wall-clock.ts), every string is
//     control-stripped then word-boundary truncated to its schema cap, and
//     capture text is additionally passed through redactSecrets BEFORE the
//     cut (a cut could otherwise leave a prefix too short to match).
//   - Refs are ordinals 1..N assigned in ONE documented order (overdue,
//     due_today, events_today, upcoming, reminders, recently_completed,
//     captures, stalled_projects, projects_without_next_action, snoozed).
//     Every ref present in the final `context` has exactly one citation and
//     every citation's ref is present -- the ladder removes the citations of
//     the items it drops, so an orphan `[n]` cannot resolve. `lastRef` is
//     the highest ordinal ever assigned; a caller appending refs continues
//     from it, never from `citations.length` (BLOCKER in the 9.7 review).
//   - The serialized string is measured against TODAY_CONTEXT_MAX_CHARS and a
//     preset-aware drop ladder brings it under the ceiling; a dropped section
//     keeps its honest `total` so the model must say "N more not shown".
//   - Never logs. Never writes (Guard 4 in ask/ai-egress-guard.test.ts).
import { redactSecrets } from "@personal-os/core/ask/redact-secrets";
import {
  stripUnsummarizableCharacters,
  truncateAtWordBoundary,
} from "@personal-os/core/mail/provider-strings";
import {
  TODAY_CONTEXT_CAPS,
  TODAY_CONTEXT_CAPTURE_MAX_CHARS,
  TODAY_CONTEXT_LOCATION_MAX_CHARS,
  TODAY_CONTEXT_MAX_CHARS,
  TODAY_CONTEXT_TITLE_MAX_CHARS,
  TodayContextSchema,
  type AskPreset,
  type AskSourceSection,
  type AskSourceType,
  type CtxTask,
  type TodayContext,
  type TodayEventItem,
  type TodayTaskItem,
} from "@personal-os/schema";
import { assertGrant } from "../ask/authorize.js";
import { collectRecentlyCompleted } from "../read-models/recent-completed.js";
import { buildRemindersResponse } from "../read-models/reminders.js";
import { buildTodayResponse } from "../read-models/today.js";
import type { ReadContext } from "./read-context.js";
import { formatWallClock, formatWallMonthDay, formatWallTime } from "./wall-clock.js";

export interface TodayContextCitation {
  /** The ordinal embedded in the prompt (1..N, Today refs come first). */
  ref: number;
  type: AskSourceType;
  /** Server-side only -- never serialized into the prompt. */
  id: string;
  title: string;
  section: AskSourceSection;
  /** Short server-formatted detail (e.g. "P1 · overdue", "14:30"), ≤ 80 chars. */
  detail?: string;
  /** Event instances only, so the client can open the instance. */
  occurs_at?: string | null;
}

export interface TodayContextBuild {
  context: TodayContext;
  citations: TodayContextCitation[];
  /**
   * The HIGHEST ordinal ever assigned while building (nextRef - 1), whether or
   * not the ladder later dropped that item. A caller that appends its own refs
   * (the route's `<records>` block) MUST continue from THIS value, never from
   * `citations.length`: after any drop the surviving citation refs have gaps,
   * so `citations.length + 1` would collide with a surviving Today ref.
   */
  lastRef: number;
  /** The EXACT string embedded in the prompt; `chars` is its length. */
  serialized: string;
  chars: number;
  /** Every externally-authored string in `context` (external event titles/locations), for the output filter. */
  untrustedInputs: string[];
  /** True when every list is empty AND every summary total is zero. */
  isEmpty: boolean;
  /** Which sections the ladder emptied to fit the ceiling (names of TodayContext keys). */
  droppedSections: string[];
}

export interface BuildTodayContextOptions {
  /** The section a preset targets is never dropped by the ladder. */
  preset?: AskPreset;
}

// ---------------------------------------------------------------------------
// String discipline: control-strip, then cut. Capture text is redacted between
// the two (redactSecrets control-strips internally, so the order holds).
// ---------------------------------------------------------------------------

const DETAIL_MAX_CHARS = 80;

function bound(value: string | null | undefined, cap: number): string {
  return truncateAtWordBoundary(stripUnsummarizableCharacters(value) ?? "", cap) ?? "";
}

function boundNullable(value: string | null | undefined, cap: number): string | null {
  if (value === null || value === undefined) return null;
  return bound(value, cap);
}

const title = (value: string | null | undefined): string =>
  bound(value, TODAY_CONTEXT_TITLE_MAX_CHARS);

function detail(parts: readonly (string | null | undefined)[]): string {
  return bound(parts.filter((p): p is string => Boolean(p)).join(" · "), DETAIL_MAX_CHARS);
}

function priorityLabel(priority: number | null): string | null {
  return priority === null ? null : `P${priority}`;
}

// ---------------------------------------------------------------------------
// The drop ladder. Names are TodayContext key paths.
// ---------------------------------------------------------------------------

const SECTION_RECENTLY_COMPLETED = "recently_completed";
const SECTION_REMINDERS = "reminders";
const SECTION_CAPTURES = "open_loops.inbox.captures";
const SECTION_STALLED = "open_loops.stalled_projects";
const SECTION_NO_NEXT_ACTION = "open_loops.projects_without_next_action";
const SECTION_SNOOZED = "open_loops.snoozed_within_horizon";
const SECTION_UPCOMING = "upcoming";
const SECTION_OVERDUE = "overdue";
const SECTION_DUE_TODAY = "due_today";
const SECTION_EVENTS_TODAY = "events_today";

const OPEN_LOOP_SECTIONS = [
  SECTION_CAPTURES,
  SECTION_STALLED,
  SECTION_NO_NEXT_ACTION,
  SECTION_SNOOZED,
] as const;

/** The sections a preset targets -- never dropped, never trimmed. */
function protectedSections(preset: AskPreset | undefined): ReadonlySet<string> {
  switch (preset) {
    case "focus":
      return new Set([SECTION_OVERDUE, SECTION_DUE_TODAY]);
    case "slipping":
      return new Set([...OPEN_LOOP_SECTIONS, SECTION_OVERDUE]);
    case "tomorrow":
      return new Set([SECTION_UPCOMING]);
    default:
      return new Set();
  }
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

export async function buildTodayContext(
  ctx: ReadContext,
  options: BuildTodayContextOptions = {},
): Promise<TodayContextBuild> {
  assertGrant(ctx.grant);

  const { db, tz, effectiveNow: now } = ctx;
  const [today, completed, reminders] = await Promise.all([
    buildTodayResponse(db, { tz }, { now }),
    collectRecentlyCompleted(db, { tz, now, limit: TODAY_CONTEXT_CAPS.recently_completed }),
    buildRemindersResponse(
      db,
      { horizon_days: TODAY_CONTEXT_CAPS.reminder_horizon_days },
      { now, oneOffHorizon: true },
    ),
  ]);

  const citations: TodayContextCitation[] = [];
  const untrusted = new Set<string>();
  let nextRef = 1;
  const cite = (citation: Omit<TodayContextCitation, "ref">): number => {
    const ref = nextRef;
    nextRef += 1;
    citations.push({ ref, ...citation });
    return ref;
  };

  const wall = (iso: string): string => formatWallClock(iso, tz);
  const wallOrNull = (iso: string | null): string | null => (iso === null ? null : wall(iso));

  // --- tasks (overdue, due_today) ------------------------------------------
  const toCtxTask = (item: TodayTaskItem, section: "overdue" | "due_today"): CtxTask => {
    const t = title(item.title);
    const ref = cite({
      type: "task",
      id: item.id,
      title: t,
      section,
      detail:
        // The client renders "[n] <Section> · <detail>", so the detail never
        // repeats the section word ("Overdue · P1 · overdue" was the defect).
        section === "overdue"
          ? detail([priorityLabel(item.priority)])
          : detail([
              priorityLabel(item.priority),
              item.due_at === null ? "due today" : `due ${formatWallTime(item.due_at, tz)}`,
            ]),
    });
    return {
      ref,
      title: t,
      due_local: wallOrNull(item.due_at),
      project: boundNullable(item.project_name, TODAY_CONTEXT_TITLE_MAX_CHARS),
      priority: item.priority,
      recurring: item.rrule !== null,
      has_reminder: item.remind_at !== null,
      snoozed: item.snoozed_until != null,
    };
  };

  const overdueItems = today.overdue.items
    .slice(0, TODAY_CONTEXT_CAPS.overdue)
    .map((item) => toCtxTask(item, "overdue"));
  const dueTodayItems = today.due_today.items
    .slice(0, TODAY_CONTEXT_CAPS.due_today)
    .map((item) => toCtxTask(item, "due_today"));

  // --- events today ----------------------------------------------------------
  // ADR-045: an all-day instance is a DATE (its re-pointed start_date), never a
  // time derived from occurs_at. `origin` absent means unknown, treated as
  // external: the safe direction for the output filter's provenance layer.
  const eventStrings = (item: TodayEventItem): { title: string; location: string | null } => {
    const strings = {
      title: title(item.title),
      location: boundNullable(item.location, TODAY_CONTEXT_LOCATION_MAX_CHARS),
    };
    if (item.origin !== "local") {
      if (strings.title.length > 0) untrusted.add(strings.title);
      if (strings.location !== null && strings.location.length > 0) untrusted.add(strings.location);
    }
    return strings;
  };

  const eventsTodayItems = today.events_today.items
    .slice(0, TODAY_CONTEXT_CAPS.events_today)
    .map((item) => {
      const strings = eventStrings(item);
      const allDay = item.all_day;
      const ref = cite({
        type: "event",
        id: item.id,
        title: strings.title,
        section: "event",
        detail: allDay
          ? "all-day"
          : item.starts_at === null
            ? undefined
            : formatWallTime(item.occurs_at ?? item.starts_at, tz),
        occurs_at: item.occurs_at,
      });
      return {
        ref,
        title: strings.title,
        starts_local:
          allDay || item.starts_at === null ? null : wall(item.occurs_at ?? item.starts_at),
        date: allDay ? item.start_date : null,
        all_day: allDay,
        location: strings.location,
      };
    });

  // --- upcoming (next 7 local days, ≤ 3 per day, 12 overall) ---------------
  const upcomingItems: TodayContext["upcoming"]["items"] = [];
  let upcomingTotal = 0;
  for (const day of today.upcoming.days) {
    upcomingTotal += day.total;
    let perDay = 0;
    const room = (): boolean =>
      perDay < TODAY_CONTEXT_CAPS.upcoming_per_day &&
      upcomingItems.length < TODAY_CONTEXT_CAPS.upcoming;
    for (const task of day.tasks) {
      if (!room()) break;
      const t = title(task.title);
      const ref = cite({
        type: "task",
        id: task.id,
        title: t,
        section: "upcoming",
        detail: detail([priorityLabel(task.priority), `due ${day.date}`]),
      });
      upcomingItems.push({ ref, date: day.date, kind: "task", title: t });
      perDay += 1;
    }
    for (const event of day.events) {
      if (!room()) break;
      const strings = eventStrings(event);
      const ref = cite({
        type: "event",
        id: event.id,
        title: strings.title,
        section: "upcoming",
        detail: detail([day.date, event.all_day ? "all-day" : null]),
        occurs_at: event.occurs_at,
      });
      upcomingItems.push({ ref, date: day.date, kind: "event", title: strings.title });
      perDay += 1;
    }
  }

  // --- reminders (7-day horizon, one-offs bounded too) ----------------------
  const reminderItems = reminders.items.slice(0, TODAY_CONTEXT_CAPS.reminders).map((item) => {
    const t = title(item.title);
    const remindLocal = wall(item.remind_at);
    const ref = cite({
      type: "task",
      id: item.task_id,
      title: t,
      section: "reminder",
      detail: detail([
        `reminder ${
          remindLocal.startsWith(today.local_date) ? remindLocal.slice(11) : remindLocal.slice(5)
        }`,
        item.recurring ? "repeats" : null,
      ]),
    });
    return {
      ref,
      title: t,
      remind_local: remindLocal,
      due_local: wallOrNull(item.due_at),
      recurring: item.recurring,
    };
  });

  // --- recently completed (last 7 local days) -------------------------------
  const completedItems = completed.items
    .slice(0, TODAY_CONTEXT_CAPS.recently_completed)
    .map((item) => {
      const t = title(item.title);
      const ref = cite({
        type: "task",
        id: item.kind === "task" ? item.id : item.parent_task_id,
        title: t,
        section: "completed",
        detail: `completed ${formatWallMonthDay(item.completed_at, tz)}`,
      });
      return { ref, title: t, completed_local: wall(item.completed_at) };
    });

  // --- projects touched (no ref: nothing to cite, nothing to open) ----------
  const projectsTouched = today.projects.items
    .filter((p): p is typeof p & { last_activity_at: string } => p.last_activity_at !== null)
    .sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at))
    .slice(0, TODAY_CONTEXT_CAPS.projects_touched)
    .map((p) => ({ name: title(p.name), last_activity_local: wall(p.last_activity_at) }));

  // --- open loops: captures ---------------------------------------------------
  // Order is load-bearing: redactSecrets runs on the whole text BEFORE the
  // 160-char cut, so a secret straddling the cut cannot ship as a prefix.
  const captures = today.inbox.items
    .filter((item) => item.raw_text !== null)
    .filter((item) => item.status === "needs_confirm" || item.status === "failed")
    .slice(0, TODAY_CONTEXT_CAPS.captures)
    .map((item) => {
      const status = item.status === "failed" ? ("failed" as const) : ("needs_confirm" as const);
      const text = bound(redactSecrets(item.raw_text ?? "").text, TODAY_CONTEXT_CAPTURE_MAX_CHARS);
      const ref = cite({
        type: "inbox_item",
        id: item.id,
        title: text,
        section: "capture",
        detail: status === "failed" ? "failed" : "needs confirmation",
      });
      return { ref, text, status, captured_local: wall(item.captured_at) };
    });

  // --- open loops: projects ----------------------------------------------------
  // A project row is cited as the PROJECT itself (`{type: "project", id}`,
  // navigable to /projects/:id) -- so a stalled project with no next action,
  // the exact case "What's slipping?" exists for, is present and checkable.
  // `detail` names the computed next action when one exists.
  // Both lists carry `{ items, total }` (Checkpoint 9.7 review): `total` is
  // the count of projects matching the predicate BEFORE the cap, over Today's
  // own (already capped) project list, so a ladder drop can still say "N not
  // shown" instead of "nothing is stalled".
  const stalledProjects: TodayContext["open_loops"]["stalled_projects"]["items"] = [];
  const projectsWithoutNextAction: TodayContext["open_loops"]["projects_without_next_action"]["items"] =
    [];
  const stalledTotal = today.projects.items.filter((p) => p.stalled).length;
  const withoutNextActionTotal = today.projects.items.filter((p) => p.next_action === null).length;
  for (const project of today.projects.items) {
    if (!project.stalled || stalledProjects.length >= TODAY_CONTEXT_CAPS.stalled_projects) continue;
    const name = title(project.name);
    const next = project.next_action === null ? null : title(project.next_action.title);
    const ref = cite({
      type: "project",
      id: project.id,
      title: name,
      section: "project",
      detail: detail([
        "stalled",
        `${project.open_task_count} open`,
        next === null ? "no next action" : `next: ${next}`,
      ]),
    });
    stalledProjects.push({
      ref,
      name,
      open_task_count: project.open_task_count,
      overdue_task_count: project.overdue_task_count,
      next_action: next,
    });
  }
  for (const project of today.projects.items) {
    if (project.next_action !== null) continue;
    if (projectsWithoutNextAction.length >= TODAY_CONTEXT_CAPS.projects_without_next_action) break;
    const name = title(project.name);
    const ref = cite({
      type: "project",
      id: project.id,
      title: name,
      section: "project",
      detail: detail(["no next action", `${project.open_task_count} open`]),
    });
    projectsWithoutNextAction.push({ ref, name });
  }

  // --- open loops: snoozed within the horizon ------------------------------
  const snoozedSource: TodayTaskItem[] = [
    ...today.overdue.items,
    ...today.due_today.items,
    ...today.upcoming.days.flatMap((day) => day.tasks),
  ].filter((item) => item.snoozed_until != null);
  const snoozedItems = snoozedSource.slice(0, TODAY_CONTEXT_CAPS.snoozed).map((item) => {
    const t = title(item.title);
    const until = wall(item.snoozed_until!);
    const ref = cite({
      type: "task",
      id: item.id,
      title: t,
      section: "snoozed",
      detail: `until ${until.slice(5)}`,
    });
    return { ref, title: t, snoozed_until_local: until };
  });

  // --- assemble -----------------------------------------------------------------
  const context: TodayContext = {
    local_date: today.local_date,
    tz,
    now_local: formatWallClock(now, tz),
    summary: {
      overdue_total: today.summary.overdue_total,
      due_today_total: today.summary.due_today_total,
      inbox_attention_total: today.summary.inbox_attention_total,
      active_project_count: today.summary.active_project_count,
    },
    overdue: { items: overdueItems, total: today.overdue.total },
    due_today: { items: dueTodayItems, total: today.due_today.total },
    upcoming: { items: upcomingItems, total: upcomingTotal },
    events_today: { items: eventsTodayItems, total: today.events_today.items.length },
    reminders: {
      items: reminderItems,
      total: reminders.items.length,
      horizon_days: TODAY_CONTEXT_CAPS.reminder_horizon_days,
    },
    recently_completed: { items: completedItems, total: completed.total },
    projects_touched: projectsTouched,
    open_loops: {
      inbox: {
        pending_count: today.inbox.pending_count,
        needs_confirm_count: today.inbox.needs_confirm_count,
        failed_count: today.inbox.failed_count,
        captures,
      },
      stalled_projects: { items: stalledProjects, total: stalledTotal },
      projects_without_next_action: {
        items: projectsWithoutNextAction,
        total: withoutNextActionTotal,
      },
      // RECORDED DEBT: `total` counts snoozed rows across Today's already
      // CAPPED overdue / due-today / upcoming lists, not across every open
      // occurrence in the horizon -- a snoozed task beyond Today's own caps is
      // invisible to it. Honest about its window, not about the whole table.
      snoozed_within_horizon: { items: snoozedItems, total: snoozedSource.length },
      reviews: {
        daily_status: today.reviews.daily.status,
        weekly_status: today.reviews.weekly.status,
      },
    },
  };

  const droppedSections = applyDropLadder(context, protectedSections(options.preset));

  // A parse failure here is a bug in this module, never a data condition.
  const parsed = TodayContextSchema.parse(context);
  const serialized = JSON.stringify(parsed);

  const presentRefs = collectRefs(parsed);
  const keptCitations = citations.filter((c) => presentRefs.has(c.ref));
  // Only strings the prompt actually carries are provenance for the output
  // filter: an external title the ladder dropped cannot be echoed by the
  // model, and handing the filter more hosts than it needs only widens what
  // it may strip from the model's own prose.
  const keptStrings = collectStrings(parsed);
  const untrustedInputs = [...untrusted].filter((value) => keptStrings.has(value));

  return {
    context: parsed,
    citations: keptCitations,
    lastRef: nextRef - 1,
    serialized,
    chars: serialized.length,
    untrustedInputs,
    isEmpty: computeIsEmpty(parsed),
    droppedSections,
  };
}

// ---------------------------------------------------------------------------
// Ladder + ref bookkeeping
// ---------------------------------------------------------------------------

function measure(context: TodayContext): number {
  return JSON.stringify(context).length;
}

/**
 * Mutates `context` in place until it fits TODAY_CONTEXT_MAX_CHARS. Order:
 * recently_completed → reminders → the four open-loop lists → upcoming → then
 * one item at a time from the LARGEST of overdue / due_today / events_today.
 * A protected section is never touched. Returns the names of the sections it
 * emptied.
 */
function applyDropLadder(context: TodayContext, protectedSet: ReadonlySet<string>): string[] {
  const dropped: string[] = [];
  const over = (): boolean => measure(context) > TODAY_CONTEXT_MAX_CHARS;
  if (!over()) return dropped;

  const emptySection = (name: string, action: () => boolean): boolean => {
    if (protectedSet.has(name)) return over();
    if (action()) dropped.push(name);
    return over();
  };

  const steps: readonly [string, () => boolean][] = [
    [
      SECTION_RECENTLY_COMPLETED,
      () => {
        const had = context.recently_completed.items.length > 0;
        context.recently_completed.items = [];
        return had;
      },
    ],
    [
      SECTION_REMINDERS,
      () => {
        const had = context.reminders.items.length > 0;
        context.reminders.items = [];
        return had;
      },
    ],
    [
      SECTION_CAPTURES,
      () => {
        const had = context.open_loops.inbox.captures.length > 0;
        context.open_loops.inbox.captures = [];
        return had;
      },
    ],
    [
      SECTION_STALLED,
      () => {
        const had = context.open_loops.stalled_projects.items.length > 0;
        context.open_loops.stalled_projects.items = [];
        return had;
      },
    ],
    [
      SECTION_NO_NEXT_ACTION,
      () => {
        const had = context.open_loops.projects_without_next_action.items.length > 0;
        context.open_loops.projects_without_next_action.items = [];
        return had;
      },
    ],
    [
      SECTION_SNOOZED,
      () => {
        const had = context.open_loops.snoozed_within_horizon.items.length > 0;
        context.open_loops.snoozed_within_horizon.items = [];
        return had;
      },
    ],
    [
      SECTION_UPCOMING,
      () => {
        const had = context.upcoming.items.length > 0;
        context.upcoming.items = [];
        return had;
      },
    ],
  ];
  for (const [name, action] of steps) {
    if (!emptySection(name, action)) return dropped;
  }

  // Trim one item at a time from the largest remaining core section.
  const trimmable: readonly [string, { items: unknown[] }][] = [
    [SECTION_OVERDUE, context.overdue],
    [SECTION_DUE_TODAY, context.due_today],
    [SECTION_EVENTS_TODAY, context.events_today],
  ];
  while (over()) {
    let largest: (typeof trimmable)[number] | null = null;
    for (const candidate of trimmable) {
      if (protectedSet.has(candidate[0]) || candidate[1].items.length === 0) continue;
      if (largest === null || candidate[1].items.length > largest[1].items.length) {
        largest = candidate;
      }
    }
    if (largest === null) break; // nothing left the preset allows us to trim
    largest[1].items.pop();
    if (largest[1].items.length === 0) dropped.push(largest[0]);
  }
  if (!over()) return dropped;

  // LAST RESORT: the ceiling is a CONTRACT, the preset is a PREFERENCE. The
  // schema caps bound the number of items and the length of every string, but
  // JSON escaping of `"` and `\` doubles those characters in `measure()`, so
  // a context of quote-heavy titles can still exceed 12 000 with only
  // protected sections left. Trim them too, one item at a time from the
  // largest, and only when nothing unprotected remains -- every step above
  // has already run. Pinned by the `'"'.repeat(120)` stress test.
  const lastResort: readonly [string, { items: unknown[] }][] = [
    [SECTION_OVERDUE, context.overdue],
    [SECTION_DUE_TODAY, context.due_today],
    [SECTION_EVENTS_TODAY, context.events_today],
    [SECTION_UPCOMING, context.upcoming],
    [SECTION_CAPTURES, { items: context.open_loops.inbox.captures }],
    [SECTION_STALLED, context.open_loops.stalled_projects],
    [SECTION_NO_NEXT_ACTION, context.open_loops.projects_without_next_action],
    [SECTION_SNOOZED, context.open_loops.snoozed_within_horizon],
  ];
  while (over()) {
    let largest: (typeof lastResort)[number] | null = null;
    for (const candidate of lastResort) {
      if (candidate[1].items.length === 0) continue;
      if (largest === null || candidate[1].items.length > largest[1].items.length) {
        largest = candidate;
      }
    }
    if (largest === null) break; // nothing left at all; the scalars alone fit by construction
    largest[1].items.pop();
    if (largest[1].items.length === 0 && !dropped.includes(largest[0])) dropped.push(largest[0]);
  }
  return dropped;
}

function collectRefs(context: TodayContext): Set<number> {
  const refs = new Set<number>();
  const add = (rows: readonly { ref: number }[]): void => {
    for (const row of rows) refs.add(row.ref);
  };
  add(context.overdue.items);
  add(context.due_today.items);
  add(context.upcoming.items);
  add(context.events_today.items);
  add(context.reminders.items);
  add(context.recently_completed.items);
  add(context.open_loops.inbox.captures);
  add(context.open_loops.stalled_projects.items);
  add(context.open_loops.projects_without_next_action.items);
  add(context.open_loops.snoozed_within_horizon.items);
  return refs;
}

/** Every event title and location the serialized context still carries (for provenance filtering). */
function collectStrings(context: TodayContext): Set<string> {
  const strings = new Set<string>();
  for (const event of context.events_today.items) {
    strings.add(event.title);
    if (event.location !== null) strings.add(event.location);
  }
  for (const row of context.upcoming.items) {
    if (row.kind === "event") strings.add(row.title);
  }
  return strings;
}

function computeIsEmpty(context: TodayContext): boolean {
  const s = context.summary;
  if (s.overdue_total + s.due_today_total + s.inbox_attention_total + s.active_project_count > 0) {
    return false;
  }
  const sections = [
    context.overdue,
    context.due_today,
    context.upcoming,
    context.events_today,
    context.reminders,
    context.recently_completed,
    context.open_loops.snoozed_within_horizon,
    context.open_loops.stalled_projects,
    context.open_loops.projects_without_next_action,
  ];
  if (sections.some((section) => section.items.length > 0 || section.total > 0)) return false;
  return context.projects_touched.length === 0 && context.open_loops.inbox.captures.length === 0;
}

/** Test seam: the ladder on a synthetic context, so the ceiling is provable without a database. */
export const __testing = { applyDropLadder, protectedSections, collectRefs, computeIsEmpty };
