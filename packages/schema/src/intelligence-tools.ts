// Checkpoint 9.7 -- the read-only intelligence contract (ADR-066).
//
// TWO THINGS LIVE HERE, BOTH PURE (no db, no provider, no `ai` import):
//
// 1. `TodayContextSchema`: the bounded, id-free, body-free object the Ask lane
//    embeds in a prompt when the client sends `tz`. It is a CLOSED allowlist in
//    the BriefInput tradition (ADR-043): every member is `.strict()`, every list
//    carries an honest `total`, every item carries an ordinal `ref` and NEVER a
//    uuid, and every time is a server-formatted wall-clock string in the
//    request zone -- the model is never asked to do timezone arithmetic.
//    `intelligence-tools.test.ts` pins the key set so a new field is a reviewed
//    change, not a drift.
//
// 2. `READ_TOOL_NAMES` and the tool I/O schemas: the contract a FUTURE
//    read-only agent would bind (ADR-056 "read-only before write-capable",
//    ADR-065 Lane F). 9.7 ships exactly ONE implementation, `buildTodayContext`
//    in apps/api/src/intelligence/, and NO tool runtime, NO binding, NO loop.
//    The names and shapes are defined now so that `get_today_context` is
//    literally the same function the Ask lane calls -- one implementation,
//    two callers -- and so that no write-shaped tool can ever be added without
//    failing `no-write-tool` guard in apps/api. Mirrors parser-tools.ts.
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import {
  AcademicPriorityReasonSchema,
  AcademicSubmissionStatusSchema,
  AcademicUrgencySchema,
} from "./academic.js";
import { EventOriginSchema } from "./events.js";
import { OccurrenceStatusSchema } from "./occurrences.js";
import { ItemContextSchema, ItemRefSchema, SearchResultTypeSchema } from "./search.js";
import { TaskStatusSchema } from "./tasks.js";

// ---------------------------------------------------------------------------
// Bounds (D5, owner-approved 2026-09-15)
// ---------------------------------------------------------------------------

/** Whole-context ceiling, measured on the EXACT serialized string embedded in the prompt. */
export const TODAY_CONTEXT_MAX_CHARS = 12_000;

export const TODAY_CONTEXT_CAPS = {
  overdue: 8,
  due_today: 10,
  upcoming: 12,
  upcoming_per_day: 3,
  events_today: 8,
  reminders: 10,
  reminder_horizon_days: 7,
  recently_completed: 10,
  projects_touched: 5,
  captures: 5,
  stalled_projects: 5,
  projects_without_next_action: 5,
  snoozed: 5,
} as const;

export const TODAY_CONTEXT_TITLE_MAX_CHARS = 120;
export const TODAY_CONTEXT_LOCATION_MAX_CHARS = 80;
export const TODAY_CONTEXT_CAPTURE_MAX_CHARS = 160;

// ---------------------------------------------------------------------------
// TodayContext -- prompt-facing, id-free
// ---------------------------------------------------------------------------

const Ref = z.number().int().min(1);
/** `YYYY-MM-DD HH:mm` in the request zone -- never an instant. */
const WallClock = z.string().regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
const LocalDate = z.string().date();
const Title = z.string().max(TODAY_CONTEXT_TITLE_MAX_CHARS);

export const CtxTaskSchema = z
  .object({
    ref: Ref,
    title: Title,
    due_local: WallClock.nullable(),
    project: Title.nullable(),
    /** Lower = higher priority (P1-style); null = unset. */
    priority: z.number().int().nullable(),
    recurring: z.boolean(),
    has_reminder: z.boolean(),
    snoozed: z.boolean(),
  })
  .strict();
export type CtxTask = z.infer<typeof CtxTaskSchema>;

export const CtxUpcomingSchema = z
  .object({ ref: Ref, date: LocalDate, kind: z.enum(["task", "event"]), title: Title })
  .strict();

export const CtxEventSchema = z
  .object({
    ref: Ref,
    title: Title,
    /** Timed events only; ALWAYS null when all_day (ADR-045). */
    starts_local: WallClock.nullable(),
    /** All-day events only: the instance's own calendar date. */
    date: LocalDate.nullable(),
    all_day: z.boolean(),
    location: z.string().max(TODAY_CONTEXT_LOCATION_MAX_CHARS).nullable(),
  })
  .strict();

export const CtxReminderSchema = z
  .object({
    ref: Ref,
    title: Title,
    remind_local: WallClock,
    due_local: WallClock.nullable(),
    recurring: z.boolean(),
  })
  .strict();

export const CtxCompletedSchema = z
  .object({ ref: Ref, title: Title, completed_local: WallClock })
  .strict();

function section<T extends z.ZodTypeAny>(item: T, cap: number) {
  return z
    .object({ items: z.array(item).max(cap), total: z.number().int().min(0) })
    .strict()
    .refine((s) => s.total >= s.items.length, { message: "total must not be smaller than items" });
}

export const TodayContextSchema = z
  .object({
    local_date: LocalDate,
    tz: z.string().refine(isValidTimezone),
    now_local: WallClock,
    summary: z
      .object({
        overdue_total: z.number().int().min(0),
        due_today_total: z.number().int().min(0),
        inbox_attention_total: z.number().int().min(0),
        active_project_count: z.number().int().min(0),
      })
      .strict(),
    overdue: section(CtxTaskSchema, TODAY_CONTEXT_CAPS.overdue),
    due_today: section(CtxTaskSchema, TODAY_CONTEXT_CAPS.due_today),
    upcoming: section(CtxUpcomingSchema, TODAY_CONTEXT_CAPS.upcoming),
    events_today: section(CtxEventSchema, TODAY_CONTEXT_CAPS.events_today),
    reminders: z
      .object({
        items: z.array(CtxReminderSchema).max(TODAY_CONTEXT_CAPS.reminders),
        total: z.number().int().min(0),
        horizon_days: z.literal(TODAY_CONTEXT_CAPS.reminder_horizon_days),
      })
      .strict(),
    recently_completed: section(CtxCompletedSchema, TODAY_CONTEXT_CAPS.recently_completed),
    projects_touched: z
      .array(z.object({ name: Title, last_activity_local: WallClock }).strict())
      .max(TODAY_CONTEXT_CAPS.projects_touched),
    open_loops: z
      .object({
        inbox: z
          .object({
            pending_count: z.number().int().min(0),
            needs_confirm_count: z.number().int().min(0),
            failed_count: z.number().int().min(0),
            captures: z
              .array(
                z
                  .object({
                    ref: Ref,
                    text: z.string().max(TODAY_CONTEXT_CAPTURE_MAX_CHARS),
                    status: z.enum(["needs_confirm", "failed"]),
                    captured_local: WallClock,
                  })
                  .strict(),
              )
              .max(TODAY_CONTEXT_CAPS.captures),
          })
          .strict(),
        // Both project lists carry an honest `total` (Checkpoint 9.7 review):
        // the ladder may empty them for a non-"slipping" question, and the
        // model must still be able to say "N stalled projects not shown"
        // rather than "nothing is stalled".
        stalled_projects: section(
          z
            .object({
              ref: Ref,
              name: Title,
              open_task_count: z.number().int().min(0),
              overdue_task_count: z.number().int().min(0),
              next_action: Title.nullable(),
            })
            .strict(),
          TODAY_CONTEXT_CAPS.stalled_projects,
        ),
        projects_without_next_action: section(
          z.object({ ref: Ref, name: Title }).strict(),
          TODAY_CONTEXT_CAPS.projects_without_next_action,
        ),
        /** Honest about its window: Today only surfaces occurrences inside the horizon. */
        snoozed_within_horizon: section(
          z.object({ ref: Ref, title: Title, snoozed_until_local: WallClock }).strict(),
          TODAY_CONTEXT_CAPS.snoozed,
        ),
        reviews: z
          .object({ daily_status: z.string().nullable(), weekly_status: z.string().nullable() })
          .strict(),
      })
      .strict(),
  })
  .strict();
export type TodayContext = z.infer<typeof TodayContextSchema>;

/** Which section a preset targets; that section is never dropped by the ladder. */
export const AskPresetSchema = z.enum(["focus", "slipping", "tomorrow"]);
export type AskPreset = z.infer<typeof AskPresetSchema>;

/**
 * The exact question each preset chip submits. ONE definition, imported by
 * both the mobile chips and the API (which matches the question text to pick
 * the section the drop ladder must never empty). A preset is still an
 * explicit tap and still `scope: "today"` -- no body ever leaves for one.
 */
export const ASK_PRESET_QUESTIONS: Record<AskPreset, string> = {
  focus: "What should I focus on today?",
  slipping: "What's slipping?",
  tomorrow: "Summarize tomorrow",
};

/** Resolves a submitted question to a preset when it is byte-equal to one. */
export function askPresetForQuestion(question: string): AskPreset | null {
  for (const preset of AskPresetSchema.options) {
    if (ASK_PRESET_QUESTIONS[preset] === question) return preset;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Future read-only tool contract -- SCHEMAS ONLY in 9.7
// ---------------------------------------------------------------------------

export const READ_TOOL_NAMES = [
  "search_personal_items",
  "get_item_context",
  "get_today_context",
  "get_calendar_context",
  "get_task_context",
  "get_academic_context",
] as const;
export type ReadToolName = (typeof READ_TOOL_NAMES)[number];
export const ReadToolNameSchema = z.enum(READ_TOOL_NAMES);

/** Per-request budget a future tool loop MUST enforce (ADR-065 "budget calls"). */
export const READ_TOOL_MAX_CALLS_PER_REQUEST = 6;
export const READ_TOOL_MAX_CHARS_PER_REQUEST = 30_000;
export const READ_TOOL_SEARCH_LIMIT_MAX = 10;
export const READ_TOOL_CALENDAR_SPAN_DAYS_MAX = 14;

const Tz = z.string().refine(isValidTimezone, { message: "unknown IANA timezone" });

export const SearchPersonalItemsInputSchema = z
  .object({
    q: z.string().min(2).max(128),
    types: z.array(SearchResultTypeSchema).min(1).max(6).optional(),
    limit: z.number().int().min(1).max(READ_TOOL_SEARCH_LIMIT_MAX).default(5),
  })
  .strict();

export const SearchPersonalItemsOutputSchema = z
  .object({
    results: z
      .array(
        z
          .object({
            type: SearchResultTypeSchema,
            id: z.string().uuid(),
            title: z.string(),
            preview: z.string().nullable(),
            timestamp: z.string().datetime({ offset: true }),
            score: z.number().int(),
          })
          .strict(),
      )
      .max(6 * READ_TOOL_SEARCH_LIMIT_MAX),
    truncated: z.boolean(),
    citations: z.array(ItemRefSchema),
  })
  .strict();

export const GetItemContextInputSchema = ItemRefSchema;
export const GetItemContextOutputSchema = ItemContextSchema;

export const GetTodayContextInputSchema = z.object({ tz: Tz }).strict();
export const GetTodayContextOutputSchema = TodayContextSchema;

export const GetTaskContextInputSchema = z.object({ id: z.string().uuid() }).strict();

export const GetAcademicContextInputSchema = z.object({ tz: Tz }).strict();

export const GetCalendarContextInputSchema = z
  .object({ tz: Tz, from: LocalDate, to: LocalDate })
  .strict()
  .refine(
    (v) => {
      const days = (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000;
      return days >= 0 && days <= READ_TOOL_CALENDAR_SPAN_DAYS_MAX;
    },
    { message: `span must be 0..${READ_TOOL_CALENDAR_SPAN_DAYS_MAX} days` },
  );

export const READ_TOOL_INPUT_SCHEMAS = {
  search_personal_items: SearchPersonalItemsInputSchema,
  get_item_context: GetItemContextInputSchema,
  get_today_context: GetTodayContextInputSchema,
  get_calendar_context: GetCalendarContextInputSchema,
  get_task_context: GetTaskContextInputSchema,
  get_academic_context: GetAcademicContextInputSchema,
} as const satisfies Record<ReadToolName, z.ZodTypeAny>;

// ---------------------------------------------------------------------------
// Tool OUTPUTS (Checkpoint 10.9, ADR-081) -- every one `.strict()`, every one
// body-free unless the tool is `get_item_context`, every list capped with an
// honest `total`. Ids ARE carried here (unlike the prompt-facing
// TodayContext): an agent that may PROPOSE an action needs the id to name a
// target, and the gateway hands these to a registered principal, not to a
// model. Descriptions never appear -- neither the event's (attacker-authored
// for an external calendar) nor the task's body nor the rrule text.
// ---------------------------------------------------------------------------

/** Per-call cap on calendar items; `total` stays honest above it. */
export const READ_TOOL_CALENDAR_ITEMS_MAX = 100;
/** Open occurrences carried by one task context. */
export const READ_TOOL_TASK_OCCURRENCES_MAX = 10;
/** Assignments carried by one academic context; `total` stays honest above it. */
export const READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX = 40;
export const READ_TOOL_ACADEMIC_COURSES_MAX = 20;

export const CalendarContextItemSchema = z
  .object({
    id: z.string().uuid(),
    title: Title,
    all_day: z.boolean(),
    /** Timed events: the instance's own instant (the occurrence's, for a recurring instance). */
    starts_at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    /** All-day events: dates, never timestamps (ADR-042/045). */
    start_date: LocalDate.nullable(),
    end_date: LocalDate.nullable(),
    location: z.string().max(TODAY_CONTEXT_LOCATION_MAX_CHARS).nullable(),
    /** `external` rows are read-only in Personal OS (ADR-064) -- an agent may never target them. */
    origin: EventOriginSchema,
    is_recurring_instance: z.boolean(),
    parent_event_id: z.string().uuid().nullable(),
    status: OccurrenceStatusSchema.nullable(),
  })
  .strict();
export type CalendarContextItem = z.infer<typeof CalendarContextItemSchema>;

export const GetCalendarContextOutputSchema = z
  .object({
    tz: Tz,
    from: LocalDate,
    to: LocalDate,
    items: z.array(CalendarContextItemSchema).max(READ_TOOL_CALENDAR_ITEMS_MAX),
    total: z.number().int().min(0),
    truncated: z.boolean(),
  })
  .strict();
export type GetCalendarContextOutput = z.infer<typeof GetCalendarContextOutputSchema>;

export const GetTaskContextOutputSchema = z
  .object({
    id: z.string().uuid(),
    title: Title,
    status: TaskStatusSchema,
    /** Lower = higher priority (P1-style); null = unset. */
    priority: z.number().int().nullable(),
    due_at: z.string().datetime({ offset: true }).nullable(),
    remind_at: z.string().datetime({ offset: true }).nullable(),
    completed_at: z.string().datetime({ offset: true }).nullable(),
    archived: z.boolean(),
    /** Whether a rule exists -- never the rule text. */
    recurring: z.boolean(),
    project: z.object({ id: z.string().uuid(), name: Title }).strict().nullable(),
    /** Whether an ADR-074 link exists -- never the assignment. */
    canvas_linked: z.boolean(),
    open_occurrences: z
      .array(
        z
          .object({
            id: z.string().uuid(),
            occurs_at: z.string().datetime({ offset: true }),
            status: OccurrenceStatusSchema,
            snoozed_until: z.string().datetime({ offset: true }).nullable(),
          })
          .strict(),
      )
      .max(READ_TOOL_TASK_OCCURRENCES_MAX),
    open_occurrences_total: z.number().int().min(0),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type GetTaskContextOutput = z.infer<typeof GetTaskContextOutputSchema>;

/**
 * The narrow academic projection (ADR-070b). Built from the academic read
 * model's current-term Today response and nothing else: no `html_url`, no
 * `source_base_url`, no announcements, no descriptions (never stored anyway,
 * ADR-068). Assignment titles and course names are INSTRUCTOR-authored --
 * third-party text in the ADR-054 sense -- so the section is flagged
 * `provenance: "third_party"` for the consumer; the gateway itself never
 * interprets them.
 */
export const AcademicContextAssignmentSchema = z
  .object({
    id: z.string().uuid(),
    course_id: z.string().uuid(),
    title: Title,
    due_at: z.string().datetime({ offset: true }).nullable(),
    points_possible: z.number().min(0).nullable(),
    submission_status: AcademicSubmissionStatusSchema,
    missing: z.boolean(),
    late: z.boolean(),
    urgency: AcademicUrgencySchema.nullable(),
    priority_score: z.number().int().min(0).nullable(),
    priority_reasons: z.array(AcademicPriorityReasonSchema),
  })
  .strict();
export type AcademicContextAssignment = z.infer<typeof AcademicContextAssignmentSchema>;

export const GetAcademicContextOutputSchema = z
  .object({
    tz: Tz,
    local_date: LocalDate,
    configured: z.boolean(),
    current_term: z
      .object({ name: z.string().nullable(), starts_at: z.string().datetime({ offset: true }) })
      .strict()
      .nullable(),
    summary: z
      .object({
        overdue_total: z.number().int().min(0),
        due_today_total: z.number().int().min(0),
        due_this_week_total: z.number().int().min(0),
        missing_total: z.number().int().min(0),
      })
      .strict(),
    courses: z
      .array(
        z
          .object({ id: z.string().uuid(), name: Title, code: z.string().max(64).nullable() })
          .strict(),
      )
      .max(READ_TOOL_ACADEMIC_COURSES_MAX),
    assignments: z
      .object({
        provenance: z.literal("third_party"),
        items: z.array(AcademicContextAssignmentSchema).max(READ_TOOL_ACADEMIC_ASSIGNMENTS_MAX),
        total: z.number().int().min(0),
      })
      .strict(),
  })
  .strict();
export type GetAcademicContextOutput = z.infer<typeof GetAcademicContextOutputSchema>;

export const READ_TOOL_OUTPUT_SCHEMAS = {
  search_personal_items: SearchPersonalItemsOutputSchema,
  get_item_context: GetItemContextOutputSchema,
  get_today_context: GetTodayContextOutputSchema,
  get_calendar_context: GetCalendarContextOutputSchema,
  get_task_context: GetTaskContextOutputSchema,
  get_academic_context: GetAcademicContextOutputSchema,
} as const satisfies Record<ReadToolName, z.ZodTypeAny>;

export type ReadToolInput<Name extends ReadToolName = ReadToolName> = z.infer<
  (typeof READ_TOOL_INPUT_SCHEMAS)[Name]
>;
export type ReadToolOutput<Name extends ReadToolName = ReadToolName> = z.infer<
  (typeof READ_TOOL_OUTPUT_SCHEMAS)[Name]
>;
