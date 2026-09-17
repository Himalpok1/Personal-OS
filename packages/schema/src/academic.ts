// Deep import, not the barrel -- see capture.ts's comment on this same
// import for why (keeps rrule and a Node-only workaround out of the web
// bundle apps/mobile ships via this package).
import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { booleanQueryParam } from "./pagination.js";
import { boundedItemsSectionSchema } from "./today.js";

// Academic Intelligence Layer wire contracts (Checkpoint 10.2, ADR-070).
//
// ===========================================================================
// A READ MODEL OVER THE canvas_* TABLES -- COMPUTED, NEVER STORED
// ===========================================================================
//
// Nothing in this file is a second entity. Every shape below is a
// provider-agnostic PROJECTION of rows the Checkpoint 10.1 sync already
// writes to `canvas_courses` / `canvas_assignments` / `canvas_announcements`
// / `canvas_events` (ADR-068). There is no `academic_*` table and no
// normalization job: the same rule that keeps an assignment's `due_at` out of
// `canvas_events` ("the assignment row is the one source of a due instant")
// keeps this layer from copying every row into a second store. A future LMS
// provider joins by adding a member to `AcademicSourceSchema` and a second
// collector, not a second schema.
//
// What "normalized" means here, concretely:
//   - Canvas's own open vocabularies (`submission_state`, `enrollment_state`,
//     `workflow_state`, `read_state`) are mapped to CLOSED, project-controlled
//     enums with an honest `unknown` member, so a client never branches on a
//     provider string.
//   - Derived facts are computed ONCE, server-side, from the stored columns,
//     never re-derived by a client: `open`, `grade.percentage`,
//     `grade.status`, a course's `status`, its open/overdue counts.
//   - Every item carries `source_base_url` so a client can enforce the same
//     same-origin check Checkpoint 10.1 introduced (now the single call site
//     `apps/mobile/src/components/academic/source-link.tsx`) before ever
//     calling `Linking.openURL(html_url)`.
//
// ===========================================================================
// STRUCTURALLY OUTSIDE THE AI LANES
// ===========================================================================
//
// `AcademicTodayResponseSchema` is NOT a section of `TodayResponseSchema`.
// Both AI collectors (`apps/api/src/intelligence/today-context.ts`,
// `apps/api/src/brief/collect-input.ts`) build from `buildTodayResponse`
// alone, so academic data cannot reach a model call by construction -- the
// same posture ADR-046 takes for Health ("displayed, never fed to the AI
// layer"). `ai-egress-guard.test.ts` pins the import boundary on top.
//
// ===========================================================================
// WHAT IS INEXPRESSIBLE HERE
// ===========================================================================
//
// No assignment `description` (ADR-068 §3, unchanged by ADR-068a), no
// `entered_score`/`entered_grade`, no submission attachments, no credential
// or sync-error prose. `academic.test.ts` walks every schema's keys for the
// first two, exactly as `canvas.test.ts` walks `CanvasConnectionSchema` for
// credential-shaped names.
//
// Read schemas carry no `.max()`: bounds live at write (text-bounds.ts), and
// a legacy row must always read back.

/** Which LMS a row was synced from. Closed; `canvas` is the only member today. */
export const AcademicSourceSchema = z.enum(["canvas"]);
export type AcademicSource = z.infer<typeof AcademicSourceSchema>;

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

/**
 * A course's lifecycle as Personal OS sees it -- project-controlled, derived
 * server-side from stored columns, in this precedence:
 *   `archived`  -- `archived_at` is set (the sync tombstoned it);
 *   `completed` -- Canvas `enrollment_state` or `workflow_state` is
 *                  `completed`;
 *   `active`    -- everything else.
 * Term dates deliberately do NOT participate: a course whose term ended but
 * whose enrollment Canvas still calls active is active here too, so the
 * derivation is a pure function of the row and never of the clock.
 */
export const AcademicCourseStatusSchema = z.enum(["active", "completed", "archived"]);
export type AcademicCourseStatus = z.infer<typeof AcademicCourseStatusSchema>;

export const AcademicTermSchema = z
  .object({
    name: z.string().nullable(),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AcademicTerm = z.infer<typeof AcademicTermSchema>;

export const AcademicCourseSchema = z
  .object({
    /** `canvas_courses.id` -- the Personal OS row id, never a Canvas id. */
    id: z.string().uuid(),
    source: AcademicSourceSchema,
    /** The provider's own id, stringified (`String(canvas_course_id)`). */
    external_id: z.string(),
    connection_id: z.string().uuid(),
    name: z.string(),
    code: z.string().nullable(),
    term: AcademicTermSchema,
    status: AcademicCourseStatusSchema,
    html_url: z.string().nullable(),
    /** The connection's own base URL, for the client's same-origin check. */
    source_base_url: z.string(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AcademicCourse = z.infer<typeof AcademicCourseSchema>;

/**
 * A course plus the three computed facts a list needs. `overdue` is an
 * instant comparison against the build's one `effectiveNow`
 * (docs/ARCHITECTURE.md "Today & agenda read models" rule 2), so no `tz` is
 * needed to compute it; `next_due_at` is the earliest open due instant at or
 * after `effectiveNow`.
 */
export const AcademicCourseSummarySchema = AcademicCourseSchema.extend({
  open_assignment_count: z.number().int().min(0),
  overdue_assignment_count: z.number().int().min(0),
  next_due_at: z.string().datetime({ offset: true }).nullable(),
}).strict();
export type AcademicCourseSummary = z.infer<typeof AcademicCourseSummarySchema>;

// ---------------------------------------------------------------------------
// Assignments
// ---------------------------------------------------------------------------

/**
 * Canvas `submission_state`, normalized. `unknown` is honest, not a bug:
 * Canvas controls that vocabulary and can grow it (ADR-050), and a member
 * this enum has never heard of must degrade to "we don't know", never to
 * "submitted".
 */
export const AcademicSubmissionStatusSchema = z.enum([
  "unsubmitted",
  "submitted",
  "graded",
  "pending_review",
  "unknown",
]);
export type AcademicSubmissionStatus = z.infer<typeof AcademicSubmissionStatusSchema>;

/**
 * Derived from `submission.status` alone: `graded` ↔ `graded`,
 * `pending_review` ↔ `pending_review`, everything else `not_graded`. A
 * `graded` status with a null `score` is legitimate (an excused or
 * complete/incomplete assignment) and stays `graded`.
 */
export const AcademicGradingStatusSchema = z.enum(["not_graded", "pending_review", "graded"]);
export type AcademicGradingStatus = z.infer<typeof AcademicGradingStatusSchema>;

export const AcademicSubmissionSchema = z
  .object({
    status: AcademicSubmissionStatusSchema,
    missing: z.boolean(),
    late: z.boolean(),
    submitted_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AcademicSubmission = z.infer<typeof AcademicSubmissionSchema>;

/**
 * The grade facts ADR-068a admits, plus one derived value.
 *
 * `percentage` is `score / points_possible * 100`, rounded to one decimal,
 * computed server-side and ONLY when both are present and `points_possible`
 * is greater than zero -- otherwise null. It is deliberately not clamped:
 * extra credit legitimately exceeds 100. It is never stored (ADR-068a), so it
 * can never disagree with the two columns it is derived from.
 */
export const AcademicGradeSchema = z
  .object({
    status: AcademicGradingStatusSchema,
    score: z.number().nullable(),
    grade: z.string().nullable(),
    percentage: z.number().nullable(),
  })
  .strict();
export type AcademicGrade = z.infer<typeof AcademicGradeSchema>;

/**
 * One assignment, denormalized with its course's name and code (the same
 * denormalization Today/Agenda apply to project names) so no list ever needs
 * a second round trip per row.
 *
 * `open` is THE deterministic rule every Today bucket and course count is
 * built on: `open ⟺ submission.status ∈ {unsubmitted, unknown}`. Submitted,
 * graded and pending-review assignments need nothing from the owner and are
 * never overdue, whatever their `due_at`.
 */
export const AcademicAssignmentSchema = z
  .object({
    /** `canvas_assignments.id`. */
    id: z.string().uuid(),
    source: AcademicSourceSchema,
    external_id: z.string(),
    course_id: z.string().uuid(),
    course_name: z.string(),
    course_code: z.string().nullable(),
    title: z.string(),
    due_at: z.string().datetime({ offset: true }).nullable(),
    points_possible: z.number().min(0).nullable(),
    submission: AcademicSubmissionSchema,
    grade: AcademicGradeSchema,
    open: z.boolean(),
    published: z.boolean(),
    html_url: z.string().nullable(),
    source_base_url: z.string(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AcademicAssignment = z.infer<typeof AcademicAssignmentSchema>;

// ---------------------------------------------------------------------------
// Announcements
// ---------------------------------------------------------------------------

export const AcademicAnnouncementSchema = z
  .object({
    /** `canvas_announcements.id`. */
    id: z.string().uuid(),
    source: AcademicSourceSchema,
    external_id: z.string(),
    course_id: z.string().uuid(),
    course_name: z.string(),
    title: z.string(),
    /** The stored tag-stripped, truncated plain-text preview -- never HTML. */
    preview: z.string().nullable(),
    posted_at: z.string().datetime({ offset: true }).nullable(),
    /** `read_state` normalized: `read` → true, `unread` → false, anything else → null. */
    read: z.boolean().nullable(),
    html_url: z.string().nullable(),
    source_base_url: z.string(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AcademicAnnouncement = z.infer<typeof AcademicAnnouncementSchema>;

// ---------------------------------------------------------------------------
// Academic events -- one shape for "something happens at an instant"
// ---------------------------------------------------------------------------

/**
 * Future-extensibility shape (the brief's "Academic Event"): a uniform
 * timeline item over the three dated things a course produces. `id` is the
 * underlying row's id, so a client can navigate back to the assignment or
 * announcement it came from. It is a PROJECTION -- an `assignment_due` event
 * is derived from the assignment row at read time, never stored (ADR-068 §3).
 */
export const AcademicEventKindSchema = z.enum(["assignment_due", "calendar_event", "announcement"]);
export type AcademicEventKind = z.infer<typeof AcademicEventKindSchema>;

export const AcademicEventSchema = z
  .object({
    kind: AcademicEventKindSchema,
    /** The underlying `canvas_assignments` / `canvas_events` / `canvas_announcements` row id. */
    id: z.string().uuid(),
    source: AcademicSourceSchema,
    /** Null for a personal (non-course) calendar event. */
    course_id: z.string().uuid().nullable(),
    course_name: z.string().nullable(),
    title: z.string(),
    /** due_at / starts_at / posted_at respectively. */
    at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    all_day: z.boolean(),
    location: z.string().nullable(),
    html_url: z.string().nullable(),
    source_base_url: z.string(),
  })
  .strict();
export type AcademicEvent = z.infer<typeof AcademicEventSchema>;

// ---------------------------------------------------------------------------
// The current term (owner decision 2026-09-16, ADR-070a)
// ---------------------------------------------------------------------------

/**
 * Every academic surface shows ONLY the current term's courses -- the owner's
 * account carries Spring 2026 courses and undated "Default Term" compliance
 * trainings whose long-overdue assignments were burying the Fall 2026 work.
 * The rule is date-driven, never a hard-coded name: the current term is the
 * most recently STARTED term (`packages/core/src/academic/current-term.ts`),
 * identified by its start instant; a course with no `term_start_at` is never
 * current; an ended term stays current until the next one starts; and when no
 * course carries a started term at all there is no basis to filter and every
 * course counts. Echoed on the responses so a client can label what it shows.
 * Null means "no current term could be determined -- nothing was filtered".
 */
export const AcademicCurrentTermSchema = z
  .object({
    name: z.string().nullable(),
    starts_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AcademicCurrentTerm = z.infer<typeof AcademicCurrentTermSchema>;

// ---------------------------------------------------------------------------
// Academic intelligence -- urgency, priority, workload, attention, grades
// (Checkpoint 10.3, Lane A)
// ---------------------------------------------------------------------------
//
// Every shape below is DERIVED server-side, at read time, by
// packages/core/src/academic/{urgency,workload,grade-summary}.ts, from the
// same scoped rows and the same single `effective_now` the Today buckets
// use. Nothing is stored (ADR-068a's rule for `percentage` applies to all of
// it) and nothing here reaches a model: these keys live on
// `AcademicTodayResponseSchema` / `AcademicCourseDetailResponseSchema`, which
// no AI collector reads (Guard 5).
//
// COMPATIBILITY RULE, RESTATED BECAUSE IT SHAPES EVERYTHING HERE: the
// versionCode-25 client parses `AcademicAssignmentSchema`,
// `AcademicCourseSummarySchema` and the other item schemas as `.strict()`
// from its compiled copy of this file, so an `urgency` or `score` key on an
// ASSIGNMENT would make that client reject every row the moment the new api
// deployed (the 10.2 review's MAJOR, in a new coat). Derived facts therefore
// live ONLY on NEW, OPTIONAL, top-level keys of the two non-strict response
// objects -- exactly like `current_term` -- and wrap the untouched item
// (`AcademicPriorityItemSchema.assignment`) rather than extending it. The
// enum vocabularies mirror core's `as const` arrays member-for-member and are
// pinned equal by academic.test.ts, the search-score precedent.

/**
 * The urgency ladder, in severity order (core's `deriveUrgency`):
 *   critical ⟺ due_at < effective_now (overdue);
 *   high     ⟺ due within ACADEMIC_URGENCY_HIGH_WINDOW_HOURS (strict <);
 *   medium   ⟺ due before the `due_this_week` horizon end (end of local day + 7);
 *   low      ⟺ otherwise.
 * Undated is never urgent and appears in no priority list.
 */
export const AcademicUrgencySchema = z.enum(["critical", "high", "medium", "low"]);
export type AcademicUrgency = z.infer<typeof AcademicUrgencySchema>;

/**
 * The closed reason vocabulary behind a priority `score` (core's
 * `scoreAcademicPriority`). Integer points, one frozen table:
 *   overdue 400 · due_within_24h 300 · due_this_week 200 (the urgency's own
 *   reason; `low` carries a 100 base and NO reason) · marked_missing +50 ·
 *   marked_late +25 · high_points +25 (points_possible ≥ ACADEMIC_HIGH_POINTS_THRESHOLD).
 * `score` = the urgency's base + the additive reasons' points, so a client can
 * recompute any ranking from `urgency` and `reasons` alone.
 */
export const AcademicPriorityReasonSchema = z.enum([
  "overdue",
  "due_within_24h",
  "due_this_week",
  "marked_missing",
  "marked_late",
  "high_points",
]);
export type AcademicPriorityReason = z.infer<typeof AcademicPriorityReasonSchema>;

/**
 * `behind` ⟺ overdue_total > 0 ∨ missing_total > 0; else `at_risk` ⟺
 * due_within_24h_total > 0; else `on_track` (core's `deriveWorkloadStatus`).
 * A threshold on counts the same object reports, never a weighted blend.
 */
export const AcademicWorkloadStatusSchema = z.enum(["on_track", "at_risk", "behind"]);
export type AcademicWorkloadStatus = z.infer<typeof AcademicWorkloadStatusSchema>;

/**
 * `high` ⟺ overdue_total > 0 ∨ due_within_24h_total > 0; else `medium` ⟺
 * due_this_week_total > 0; else `low` ⟺ open_total > 0; else `none` (core's
 * `deriveCourseAttention`). A `none` course is never listed.
 */
export const AcademicCourseAttentionLevelSchema = z.enum(["high", "medium", "low", "none"]);
export type AcademicCourseAttentionLevel = z.infer<typeof AcademicCourseAttentionLevelSchema>;

/** Must equal core's `URGENCY_HIGH_WINDOW_HOURS`; pinned by academic.test.ts. */
export const ACADEMIC_URGENCY_HIGH_WINDOW_HOURS = 24;
/** Must equal core's `HIGH_POINTS_THRESHOLD`; pinned by academic.test.ts. */
export const ACADEMIC_HIGH_POINTS_THRESHOLD = 50;
export const ACADEMIC_PRIORITIES_ITEM_CAP = 5;
export const ACADEMIC_COURSE_ATTENTION_ITEM_CAP = 10;

/**
 * One "what should I do next?" candidate: the UNTOUCHED assignment item plus
 * its derived urgency, score and reasons. Candidates are every open, dated,
 * current-term assignment whose urgency is critical/high/medium (due before
 * the horizon end -- never `low`), ranked score desc, due_at asc, title, id.
 * `hours_until_due` is signed (negative when overdue), one decimal.
 */
export const AcademicPriorityItemSchema = z
  .object({
    assignment: AcademicAssignmentSchema,
    urgency: AcademicUrgencySchema,
    score: z.number().int().min(0),
    reasons: z.array(AcademicPriorityReasonSchema),
    hours_until_due: z.number().nullable(),
  })
  .strict();
export type AcademicPriorityItem = z.infer<typeof AcademicPriorityItemSchema>;

/**
 * One local calendar day of the workload view (core's `academicWorkloadDays`):
 * `due_total` counts OPEN assignments whose `due_at` falls inside that local
 * day's window and `points_total` sums their `points_possible` (null → 0).
 * Today's entry therefore includes anything already overdue EARLIER TODAY,
 * and an item overdue from an earlier day is on no entry at all -- earlier
 * days are not represented; `overdue_total` is reported separately so a
 * client can subtract rather than guess.
 */
export const AcademicWorkloadDaySchema = z
  .object({
    date: z.string().date(),
    due_total: z.number().int().min(0),
    points_total: z.number().min(0),
  })
  .strict();
export type AcademicWorkloadDay = z.infer<typeof AcademicWorkloadDaySchema>;

/**
 * The workload summary over the current term's open assignments:
 *   open_total            every open assignment, dated or not;
 *   overdue_total         = `summary.overdue_total` (rule 2);
 *   missing_total         = `summary.missing_total` (Canvas's flag, windowless);
 *   due_within_24h_total  urgency `high` (instant arithmetic; OVERLAPS
 *                         due_today / due_this_week, which are local-day buckets);
 *   due_this_week_total   = `summary.due_this_week_total` (local days +1..+7);
 *   points_at_stake       Σ points_possible over OPEN assignments due from
 *                         effective_now (inclusive) to the horizon end
 *                         (exclusive), null points counting 0 -- overdue and
 *                         beyond-horizon points are NOT at stake here;
 *   horizon_days          ACADEMIC_UPCOMING_DAY_COUNT;
 *   days                  today + the `horizon_days` following local days, in
 *                         order, one entry per day, zero-filled.
 * The not-configured response still carries this key (all zero, `on_track`,
 * eight zero-filled days), so a client never branches on absence.
 */
export const AcademicWorkloadSchema = z
  .object({
    status: AcademicWorkloadStatusSchema,
    open_total: z.number().int().min(0),
    overdue_total: z.number().int().min(0),
    missing_total: z.number().int().min(0),
    due_within_24h_total: z.number().int().min(0),
    due_this_week_total: z.number().int().min(0),
    points_at_stake: z.number().min(0),
    horizon_days: z.number().int().min(0),
    days: z.array(AcademicWorkloadDaySchema),
  })
  .strict();
export type AcademicWorkload = z.infer<typeof AcademicWorkloadSchema>;

/**
 * One current-term course that needs attention (level ≠ `none`), with the
 * counts its level was derived from (same definitions as the workload's,
 * scoped to the course) and `next_due_at`, the earliest open due instant at
 * or after `effective_now`. Ordered by level (high, medium, low), then
 * overdue desc, then due_within_24h desc, then next_due_at asc (nulls last),
 * then course name, then id.
 */
export const AcademicCourseAttentionSchema = z
  .object({
    course_id: z.string().uuid(),
    course_name: z.string(),
    course_code: z.string().nullable(),
    open_total: z.number().int().min(0),
    overdue_total: z.number().int().min(0),
    due_within_24h_total: z.number().int().min(0),
    due_this_week_total: z.number().int().min(0),
    next_due_at: z.string().datetime({ offset: true }).nullable(),
    attention: AcademicCourseAttentionLevelSchema,
  })
  .strict();
export type AcademicCourseAttention = z.infer<typeof AcademicCourseAttentionSchema>;

/**
 * A course's grade summary over its assignments with `grade.status ===
 * "graded"` (core's `deriveGradeSummary`), computed at read time from the
 * ADR-068a columns and never stored:
 *   graded_total            count of graded assignments;
 *   average_percentage      mean of the non-null `grade.percentage` values,
 *                           one decimal; null when none;
 *   points_earned /         Σ score / Σ points_possible over graded rows where
 *   points_possible_graded  BOTH are present; null when none;
 *   weighted_percentage     points_earned / points_possible_graded × 100, one
 *                           decimal; null when the denominator is null or 0.
 * An excused graded row (null score) counts in `graded_total` only. Neither
 * percentage is clamped (extra credit).
 */
export const AcademicGradeSummarySchema = z
  .object({
    graded_total: z.number().int().min(0),
    average_percentage: z.number().nullable(),
    points_earned: z.number().nullable(),
    points_possible_graded: z.number().nullable(),
    weighted_percentage: z.number().nullable(),
  })
  .strict();
export type AcademicGradeSummary = z.infer<typeof AcademicGradeSummarySchema>;

// ---------------------------------------------------------------------------
// GET /academic/today
// ---------------------------------------------------------------------------

/** Same single input as `GET /today`: the client's IANA zone. */
export const AcademicTodayQuerySchema = z.object({
  tz: z.string().refine(isValidTimezone, { message: "unknown IANA timezone" }),
});
export type AcademicTodayQuery = z.infer<typeof AcademicTodayQuerySchema>;

/** `due_this_week` covers the 7 local days AFTER today, exactly Today's `upcoming` horizon. */
export const ACADEMIC_UPCOMING_DAY_COUNT = 7;
/** `announcements` looks back this many days from `effective_now`. */
export const ACADEMIC_ANNOUNCEMENT_LOOKBACK_DAYS = 7;
/**
 * `events` shares `due_this_week`'s horizon (ACADEMIC_UPCOMING_DAY_COUNT local
 * days after today) rather than a separate 24h-arithmetic window, so one card
 * never carries two notions of "this week". Kept as an alias for readers of
 * the constant; the value is not independently tunable.
 */
export const ACADEMIC_EVENT_HORIZON_DAYS = ACADEMIC_UPCOMING_DAY_COUNT;
export const ACADEMIC_OVERDUE_ITEM_CAP = 20;
export const ACADEMIC_DUE_TODAY_ITEM_CAP = 25;
export const ACADEMIC_DUE_THIS_WEEK_ITEM_CAP = 25;
export const ACADEMIC_ANNOUNCEMENTS_ITEM_CAP = 5;
export const ACADEMIC_EVENTS_ITEM_CAP = 10;

/**
 * The academic Today read model. Frozen semantics, mirroring
 * docs/ARCHITECTURE.md "Today & agenda read models" exactly:
 *
 *   1. One `effective_now` per build.
 *   2. `overdue`      ⟺ open ∧ due_at < effective_now (instant comparison).
 *   3. `due_today`    ⟺ open ∧ startOfLocalDay(tz) ≤ due_at < startOfNextLocalDay(tz)
 *                        ∧ NOT overdue (overdue takes precedence, as in /today).
 *   4. `due_this_week` ⟺ open ∧ due in the ACADEMIC_UPCOMING_DAY_COUNT local
 *                        days after today (never anything already in 2 or 3).
 *   5. `announcements` = posted within ACADEMIC_ANNOUNCEMENT_LOOKBACK_DAYS,
 *                        unread first, then newest first.
 *   6. `events`       = calendar events UPCOMING OR IN PROGRESS before the end
 *                        of local day + ACADEMIC_UPCOMING_DAY_COUNT -- the same
 *                        horizon end as rule 4 (`starts_at` before it, and
 *                        `ends_at` after `effective_now`, or no `ends_at` and
 *                        `starts_at` at/after `effective_now`).
 *   5'. `announcements` is instant arithmetic (a lookback has no "today"
 *                        anchor); rules 4 and 6 are local-day based.
 *
 * Every section carries an honest `total` alongside its capped `items`.
 * Only ACTIVE connections' unarchived courses IN THE CURRENT TERM
 * (`current_term`, ADR-070a) and their unarchived rows count; a personal
 * (course-less) calendar event is never term-filtered. A
 * server with no active connection answers `configured: false` with empty
 * sections and zero totals -- never an error -- so a Today card can render
 * (or not) off this one query.
 *
 * `summary.missing_total` is Canvas's own `missing` flag counted over every
 * open assignment, windowless; it may differ from `overdue_total` because
 * Canvas applies its own grace rules, and both are reported rather than
 * reconciled.
 * `summary.unread_announcements_total` is WINDOW-scoped by contrast: it counts
 * the unread announcements within the same ACADEMIC_ANNOUNCEMENT_LOOKBACK_DAYS
 * set the `announcements` section is drawn from, so the count and the rows a
 * client can show never disagree.
 */
export const AcademicTodayResponseSchema = z.object({
  generated_at: z.string().datetime({ offset: true }),
  effective_now: z.string().datetime({ offset: true }),
  tz: z.string(),
  local_date: z.string().date(),
  configured: z.boolean(),
  // Optional so the versionCode-25 client, whose compiled copy of this
  // schema predates it, keeps parsing (a non-strict object drops unknown
  // keys); a server never omits it.
  current_term: AcademicCurrentTermSchema.nullable().optional(),
  summary: z.object({
    overdue_total: z.number().int().min(0),
    due_today_total: z.number().int().min(0),
    due_this_week_total: z.number().int().min(0),
    missing_total: z.number().int().min(0),
    unread_announcements_total: z.number().int().min(0),
  }),
  overdue: boundedItemsSectionSchema(AcademicAssignmentSchema),
  due_today: boundedItemsSectionSchema(AcademicAssignmentSchema),
  due_this_week: boundedItemsSectionSchema(AcademicAssignmentSchema),
  announcements: boundedItemsSectionSchema(AcademicAnnouncementSchema),
  events: boundedItemsSectionSchema(AcademicEventSchema),
  // The three Checkpoint 10.3 intelligence keys. Optional for the same
  // reason `current_term` is: the versionCode-25 client's compiled copy of
  // this schema predates them, and a non-strict object drops unknown keys,
  // so that client keeps parsing. A server NEVER omits them -- the
  // not-configured response carries them empty/zeroed too -- so a new client
  // never branches on absence. Capped with honest totals like every section.
  priorities: boundedItemsSectionSchema(AcademicPriorityItemSchema).optional(),
  workload: AcademicWorkloadSchema.optional(),
  course_attention: boundedItemsSectionSchema(AcademicCourseAttentionSchema).optional(),
});
export type AcademicTodayResponse = z.infer<typeof AcademicTodayResponseSchema>;

// ---------------------------------------------------------------------------
// GET /academic/courses, GET /academic/courses/:id
// ---------------------------------------------------------------------------

export const AcademicCoursesQuerySchema = z.object({
  include_archived: booleanQueryParam(false),
  /** Include courses from terms before the current one (ADR-070a). Default: current term only. */
  include_past_terms: booleanQueryParam(false),
});
export type AcademicCoursesQuery = z.infer<typeof AcademicCoursesQuerySchema>;

/**
 * Every CURRENT-TERM course across every ACTIVE connection (all terms with
 * `include_past_terms=true`), ordered for a list: by term start descending
 * (nulls last), then course code, then name, then `id` so identical requests
 * are byte-identical. `configured` is false when no active connection
 * exists, in which case `items` is empty. `current_term` echoes the term the
 * default view was filtered to (null when nothing could be filtered).
 */
export const AcademicCoursesResponseSchema = z.object({
  configured: z.boolean(),
  current_term: AcademicCurrentTermSchema.nullable().optional(),
  items: z.array(AcademicCourseSummarySchema),
});
export type AcademicCoursesResponse = z.infer<typeof AcademicCoursesResponseSchema>;

/**
 * One course with everything synced for it. `assignments` are the course's
 * unarchived assignments ordered `due_at` ascending with nulls last, then
 * title, then `id`; `announcements` newest first; `events` by `starts_at`
 * ascending. A course whose connection is not active answers 404 -- the same
 * "a paused institution is never surfaced" rule the upcoming-assignments route
 * documents. An archived course answers 200 with `status: "archived"`: the
 * list can surface it under `include_archived=true`, so it must be openable.
 */
export const AcademicCourseDetailResponseSchema = z.object({
  course: AcademicCourseSummarySchema,
  assignments: z.array(AcademicAssignmentSchema),
  announcements: z.array(AcademicAnnouncementSchema),
  events: z.array(AcademicEventSchema),
  // Optional for the versionCode-25 client's compiled schema (see
  // `current_term` and the Today response's three keys); a server never
  // omits it -- a course with no graded assignment carries a zero count and
  // null figures, never an absent key.
  grade_summary: AcademicGradeSummarySchema.optional(),
});
export type AcademicCourseDetailResponse = z.infer<typeof AcademicCourseDetailResponseSchema>;
