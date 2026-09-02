// Checkpoint 5.5 shared contracts for the Daily Brief (ADR-041).
//
// Frozen by the main session before any parallel implementation work, so the
// collector, prompt builder, generation service and route all build against
// one definition. Nothing here reads the database or calls a provider.

// ---------------------------------------------------------------------------
// Bounded snapshot handed to the model
// ---------------------------------------------------------------------------
//
// SECURITY: BriefInput is the ONLY thing that ever reaches a prompt. It is a
// closed, scalar-only allowlist deliberately carrying no uuids, no ids, no
// credential material and no free-text bodies -- a secret is structurally
// inexpressible here, not merely discouraged by prompt wording.

export interface BriefTaskItem {
  title: string;
  due_at: string | null;
  project_name: string | null;
  recurring: boolean;
}

export interface BriefEventItem {
  title: string;
  // Timed events only. ALWAYS null when all_day is true -- ADR-042 anchors a
  // recurring all-day series at LOCAL NOON, and before Checkpoint 5.7.1 that
  // internal anchor landed here and the model narrated a real all-day event
  // as "beginning at 12:00 PM". An all-day event has no time, so it must have
  // no way to express one.
  starts_at: string | null;
  // All-day events only (YYYY-MM-DD, the instance's own calendar date); null
  // for timed events, whose day is implied by starts_at. Added in 5.7.1 --
  // previously the shape had no date field at all, so "all-day on date X" was
  // literally inexpressible and fixing starts_at alone would have left the
  // model with no day information.
  date: string | null;
  all_day: boolean;
  location: string | null;
}

export interface BriefUpcomingItem {
  date: string;
  kind: "task" | "event";
  title: string;
}

export interface BriefProjectItem {
  name: string;
  status: string;
  stalled: boolean;
  next_action: string | null;
  open_task_count: number;
  overdue_task_count: number;
}

export interface BriefInput {
  generated_at: string;
  tz: string;
  local_date: string;
  summary: {
    overdue_total: number;
    due_today_total: number;
    inbox_attention_total: number;
    active_project_count: number;
  };
  // `total` is always the honest pre-cap count from the Today read model, so
  // capping items can never make the brief understate reality.
  overdue: { items: BriefTaskItem[]; total: number };
  due_today: { items: BriefTaskItem[]; total: number };
  events_today: { items: BriefEventItem[]; total: number };
  upcoming: { items: BriefUpcomingItem[]; total: number };
  inbox: {
    pending_count: number;
    needs_confirm_count: number;
    failed_count: number;
    snippets: string[];
  };
  projects: { items: BriefProjectItem[]; total: number };
  reviews: {
    daily_status: string | null;
    weekly_status: string | null;
  };
}

// ---------------------------------------------------------------------------
// Deterministic bounds
// ---------------------------------------------------------------------------

export const BRIEF_OVERDUE_CAP = 8;
export const BRIEF_DUE_TODAY_CAP = 10;
export const BRIEF_EVENTS_TODAY_CAP = 8;
export const BRIEF_UPCOMING_PER_DAY_CAP = 3;
export const BRIEF_UPCOMING_TOTAL_CAP = 12;
export const BRIEF_INBOX_SNIPPET_CAP = 5;
export const BRIEF_PROJECTS_CAP = 5;

export const BRIEF_TITLE_MAX_CHARS = 120;
export const BRIEF_LOCATION_MAX_CHARS = 80;
export const BRIEF_INBOX_SNIPPET_MAX_CHARS = 160;

// Whole-payload ceiling.
//
// Sized against MEASURED worst cases, not an assumption. An audit of the
// original 6000 found it undersized: the three sections the drop ladder is
// forbidden from touching (overdue 8 + due_today 10 + events_today 8) reach
// ~8.6k chars on their own once their capped items carry realistic titles,
// project names and locations -- so an ordinary busy day, not an adversarial
// one, could exhaust the ladder and hit what the collector called an
// "unreachable" throw. Full-stress (every field at its bound, every section
// full) measures ~13.3k.
//
// 12000 keeps the prompt genuinely small (~3k tokens) while leaving normal
// and busy days fully intact, and the collector's ladder now also trims the
// previously-irreducible sections as a last resort, so the ceiling is a real
// guarantee rather than a hope. Serialized JSON is never sliced -- whole
// items and whole sections are dropped, and honest totals always survive.
export const MAX_BRIEF_INPUT_CHARS = 12000;

// ---------------------------------------------------------------------------
// Generation bounds
// ---------------------------------------------------------------------------

export const BRIEF_ATTEMPT_TIMEOUT_MS = 30_000;
export const BRIEF_TOTAL_BUDGET_MS = 45_000;
export const BRIEF_MAX_OUTPUT_TOKENS = 800;

/**
 * Hard ceiling on the PERSISTED brief text, applied by the shared output filter.
 *
 * The prompt asks for 120-220 words and `BRIEF_MAX_OUTPUT_TOKENS` bounds the
 * model, but neither is a guarantee about what reaches the column -- a token cap
 * is the provider's promise, not ours. Matches the mail digest's own ceiling for
 * the same reason: a text column with no server-side bound is how an unbounded
 * value gets stored, and the two lanes should not disagree about a number
 * neither has a lane-specific reason to differ on.
 */
export const BRIEF_MAX_TEXT_CHARS = 4000;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------
//
// NOTE for the route: server.ts's setErrorHandler only passes through a
// thrown error's own statusCode when it is 4xx -- a 5xx falls through to
// {error:"internal_error"}. These two are therefore caught and replied
// explicitly by the route handler, never left to the generic handler.
//
// Messages are deliberately static: a raw provider/SDK error can echo request
// headers or body, so it must never become this message nor reach the logger.

export class BriefGenerationTimeoutError extends Error {
  readonly statusCode = 504;
  readonly code = "brief_generation_timeout";
  constructor() {
    super("AI provider request timed out");
    this.name = "BriefGenerationTimeoutError";
  }
}

export class BriefGenerationFailedError extends Error {
  readonly statusCode = 502;
  readonly code = "brief_generation_failed";
  constructor() {
    super("AI provider request failed");
    this.name = "BriefGenerationFailedError";
  }
}

// ai_task_routes.task_name this feature routes through. Not configured in
// production during Checkpoint 5.5 -- that is 5.7.
export const DAILY_BRIEF_TASK_NAME = "daily_brief";

// ---------------------------------------------------------------------------
// Provenance
// ---------------------------------------------------------------------------

/**
 * Every externally-authored string this payload can carry.
 *
 * ADR-057 finding #3: calendar event text is written by WHOEVER CREATED THE
 * EVENT, which for an invited meeting is a third party, and it has had an
 * unfiltered path into this prompt since Checkpoint 5.5. `event.summary` and
 * `location` arrive verbatim from Google and CalDAV and are stored in plain
 * `text` columns with no `.max()` and no truncation at write.
 *
 * Tasks, notes, projects and inbox snippets are the user's OWN capture and are
 * first-party. They are deliberately excluded: provenance-based filtering only
 * removes host-shaped echoes, so including them would buy nothing and would
 * blur the distinction this function exists to record.
 *
 * `upcoming` is a mixed list; only its `kind === "event"` members are calendar-
 * derived. Including a task title here would be harmless but wrong, and the
 * next reader deserves the honest boundary.
 */
export function collectUntrustedBriefInputs(input: BriefInput): string[] {
  const values: string[] = [];
  for (const event of input.events_today.items) {
    values.push(event.title);
    if (event.location !== null) values.push(event.location);
  }
  for (const item of input.upcoming.items) {
    if (item.kind === "event") values.push(item.title);
  }
  return values;
}
