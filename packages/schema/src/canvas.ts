import { z } from "zod";

// Canvas LMS integration wire contracts (Checkpoint 10.1, ADR-068).
//
// ===========================================================================
// READ-ONLY, PAT-AUTHENTICATED, STRUCTURALLY CREDENTIAL-FREE
// ===========================================================================
//
// The only user-typed Canvas input anywhere in this integration is the
// Personal Access Token and base URL at connect time
// (`CanvasConnectRequestSchema`). Every other schema here describes data this
// project SYNCS FROM Canvas and stores narrower than Canvas returns it
// (ADR-068 §3) -- there are no create/update forms for courses, assignments,
// announcements or events, because the integration is read-only by
// construction: `packages/canvas-providers`'s client implements no write
// method.
//
// `CanvasConnectionSchema` is STRUCTURALLY CREDENTIAL-FREE, the same proof
// `mail-connections.ts` and `health-metrics.ts` make: nothing in this file can
// express an access token, ciphertext, an IV or an auth tag.
// `canvas.test.ts` walks this schema's own keys and fails if a
// credential-shaped name appears, rather than trusting review.
//
// ===========================================================================
// WHY READ SCHEMAS HERE CARRY NO `.max()`
// ===========================================================================
//
// `text-bounds.ts` documents the contract this file follows: bounds apply to
// CREATE/UPDATE/tool schemas only, so a legacy row always reads back. Course,
// assignment, announcement and event text is bounded ONCE, at write, by
// `packages/core/src/canvas/provider-strings.ts`'s truncation helpers (the
// provider is never in a position to have its output rejected, because the
// owner didn't type it) -- re-asserting the same bound here would only ever
// reject a row this project's own writer already produced, which is the
// legacy-row failure mode this convention exists to avoid. The one true
// write-time input in this whole file, `personal_access_token`, IS bounded,
// because a person is typing it.
//
// ===========================================================================
// WHY `enrollment_state` / `workflow_state` / `submission_state` / `read_state`
// ARE `z.string()`, NOT `z.enum()`
// ===========================================================================
//
// Each is a Canvas-defined, Canvas-controlled vocabulary that can grow on
// Canvas's own schedule, not this project's (ADR-050's `provider` /
// `source_family` reasoning, applied here). A closed Zod enum would make this
// package's own build the thing that breaks the first time Canvas adds a
// value neither this file nor a database CHECK constraint was ever asked to
// enumerate. None of the four is CHECK-constrained in `packages/db` for the
// identical reason.
//
// ===========================================================================
// `last_sync_error` / `failure_class` / `error_message` ARE TOKEN-SHAPED, NOT
// FREE PROSE
// ===========================================================================
//
// ADR-068 §5: "`failure_class`/`error_message` [are] restricted to the same
// token-shaped regex `mail_sync_runs` enforces, so provider prose can never
// reach a log line or a database column." Canvas error bodies, like Gmail's,
// can echo the offending request back, so a free-text message field is a
// caller-controlled channel out of the request. `CanvasSyncTokenSchema` is the
// identical shape `packages/schema/src/mail-sync-errors.ts`'s
// `MailSyncFailureClassSchema` enforces -- a lowercase machine token with at
// most one `:`-separated qualifier (`provider_error:503`). Unlike
// `mail_connections.last_sync_error` (a closed, project-defined
// `MailSyncErrorCodeSchema` enum of actionable states), Canvas has no
// dedicated closed-vocabulary file: `canvas_connections.last_sync_error` is
// documented (`packages/db/src/schema/canvas-connections.ts`) as holding "a
// SANITIZED CLASSIFICATION TOKEN ... the mail_sync_runs precedent this mirrors
// exactly", so it reuses the same token shape rather than a second, bespoke
// enum.

/**
 * The shape every `last_sync_error` / `failure_class` / `error_message` value
 * must have: a lowercase machine token with at most one `:`-separated
 * qualifier (`auth_failed`, `provider_error:503`).
 *
 * Prose cannot satisfy it -- it has spaces, punctuation and capitals -- so a
 * writer that reaches for `err.message` instead of a classification fails
 * HERE rather than in a durable column or a log line.
 */
const CANVAS_SYNC_TOKEN_PATTERN = /^[a-z][a-z0-9_]{0,63}(:[A-Za-z0-9_.-]{1,64})?$/;
export const CanvasSyncTokenSchema = z.string().regex(CANVAS_SYNC_TOKEN_PATTERN);
export type CanvasSyncToken = z.infer<typeof CanvasSyncTokenSchema>;

// ---------------------------------------------------------------------------
// Connection lifecycle
// ---------------------------------------------------------------------------

/**
 * `POST /canvas-connections` — the owner's one-time PAT + base URL entry.
 *
 * `.strict()`, matching every write contract in this repository
 * (`ConnectGmailRequestSchema` is the direct precedent). `personal_access_token`
 * is capped at 2000 characters: generous headroom over any Canvas PAT observed
 * in the field, and a bound on a person-typed field is rejected rather than
 * truncated (`text-bounds.ts`'s user-typed-text rule) -- 2000 characters is
 * simply never a legitimate PAT, so the bound cannot cut real input.
 */
export const CanvasConnectRequestSchema = z
  .object({
    base_url: z.string().url(),
    personal_access_token: z.string().min(1).max(2000),
  })
  .strict();
export type CanvasConnectRequest = z.infer<typeof CanvasConnectRequestSchema>;

/**
 * Connection lifecycle. Closed by design and CHECK-constrained in the
 * database (`packages/db/src/schema/canvas-connections.ts`).
 *
 * `invalid_token` is Canvas-specific: unlike an OAuth grant, a PAT has no
 * separate "needs reauth" middle state to distinguish from an outright bad
 * credential -- Canvas either accepts the token or it does not.
 */
export const CanvasConnectionStatusSchema = z.enum(["active", "disconnected", "invalid_token"]);
export type CanvasConnectionStatus = z.infer<typeof CanvasConnectionStatusSchema>;

/**
 * The safe wire representation of a Canvas connection.
 *
 * NEVER include any `access_token_*` field, ciphertext, IV or auth tag here.
 * See the file header and `canvas.test.ts`'s structural proof.
 */
export const CanvasConnectionSchema = z
  .object({
    id: z.string().uuid(),
    canvas_base_url: z.string(),
    canvas_user_id: z.number().int().positive(),
    canvas_user_name: z.string().nullable(),
    status: CanvasConnectionStatusSchema,
    last_sync_at: z.string().datetime({ offset: true }).nullable(),
    last_sync_error: CanvasSyncTokenSchema.nullable(),
    last_sync_error_at: z.string().datetime({ offset: true }).nullable(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type CanvasConnection = z.infer<typeof CanvasConnectionSchema>;

export const CanvasConnectionsListResponseSchema = z.object({
  configured: z.boolean(),
  items: z.array(CanvasConnectionSchema),
});
export type CanvasConnectionsListResponse = z.infer<typeof CanvasConnectionsListResponseSchema>;

// ---------------------------------------------------------------------------
// Synced content
// ---------------------------------------------------------------------------

/**
 * One synced Canvas course.
 *
 * Deliberately narrower than `GET /courses` (ADR-068 §3): `uuid`, `license`,
 * `calendar.ics`, `storage_quota_mb`, blueprint/template flags, `is_public*`
 * and every account/root-account id are dropped as not-Personal-OS-functional
 * and are therefore structurally absent, not merely unpopulated.
 */
export const CanvasCourseSchema = z
  .object({
    id: z.string().uuid(),
    canvas_course_id: z.number().int().positive(),
    name: z.string(),
    course_code: z.string().nullable(),
    term_name: z.string().nullable(),
    term_start_at: z.string().datetime({ offset: true }).nullable(),
    term_end_at: z.string().datetime({ offset: true }).nullable(),
    // Canvas's own vocabulary (e.g. active|invited|completed). Not a closed
    // z.enum(): see the file header.
    enrollment_state: z.string().nullable(),
    // Canvas's own vocabulary (e.g. available|completed|unpublished). Not a
    // closed z.enum(): see the file header.
    workflow_state: z.string().nullable(),
    html_url: z.string().nullable(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CanvasCourse = z.infer<typeof CanvasCourseSchema>;

/**
 * One synced Canvas assignment.
 *
 * DELIBERATELY NO `description` field anywhere in this schema (ADR-068 §3):
 * it is instructor-authored HTML of unbounded upstream size with no in-app
 * renderer. `entered_score`/`entered_grade`/`attachments` are likewise absent.
 * `canvas.test.ts` pins each exclusion as a structural regression test, not
 * merely a fact about the current field list.
 *
 * `score` and `grade` ARE present since Checkpoint 10.2 (ADR-068a, migration
 * 0021): the owner made the explicit decision ADR-068 §3 reserved. Both are
 * nullable (Canvas leaves them null until graded); `grade` is Canvas's own
 * display string ("A", "95", "95%", "complete"), a provider string bounded at
 * write. No percentage field: it is derived at read time in
 * `academic.ts`'s read model so it can never disagree with the two columns.
 */
export const CanvasAssignmentSchema = z
  .object({
    id: z.string().uuid(),
    course_id: z.string().uuid(),
    canvas_assignment_id: z.number().int().positive(),
    title: z.string(),
    due_at: z.string().datetime({ offset: true }).nullable(),
    points_possible: z.number().min(0).nullable(),
    submission_types: z.array(z.string()).nullable(),
    html_url: z.string().nullable(),
    published: z.boolean(),
    // Canvas's own vocabulary (unsubmitted|submitted|graded|pending_review).
    // Not a closed z.enum(): see the file header.
    submission_state: z.string().nullable(),
    submission_missing: z.boolean().nullable(),
    submission_late: z.boolean().nullable(),
    submitted_at: z.string().datetime({ offset: true }).nullable(),
    // Checkpoint 10.2 (ADR-068a). See the doc comment above.
    score: z.number().nullable(),
    grade: z.string().nullable(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CanvasAssignment = z.infer<typeof CanvasAssignmentSchema>;

/**
 * One synced Canvas announcement.
 *
 * `message_preview` is a tag-stripped, truncated PLAIN-TEXT preview of
 * Canvas's `message` field (`stripHtmlToPlainText` +
 * `CANVAS_ANNOUNCEMENT_PREVIEW_MAX_CHARS`,
 * `packages/core/src/canvas/provider-strings.ts`) -- never the raw HTML Canvas
 * returns. `html_url` is the one-tap link back to Canvas for the full post.
 */
export const CanvasAnnouncementSchema = z
  .object({
    id: z.string().uuid(),
    course_id: z.string().uuid(),
    canvas_announcement_id: z.number().int().positive(),
    title: z.string(),
    message_preview: z.string().nullable(),
    posted_at: z.string().datetime({ offset: true }).nullable(),
    html_url: z.string().nullable(),
    // Canvas's own vocabulary (read|unread). Not a closed z.enum(): see the
    // file header.
    read_state: z.string().nullable(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CanvasAnnouncement = z.infer<typeof CanvasAnnouncementSchema>;

/**
 * One synced Canvas calendar event.
 *
 * `course_id` is nullable because a Canvas calendar event can be personal
 * rather than scoped to any course. An assignment's own `due_at` is never
 * duplicated into this shape -- the assignment row is the one source of a due
 * instant (ADR-068 §3, the no-second-source-of-truth rule).
 */
export const CanvasEventSchema = z
  .object({
    id: z.string().uuid(),
    course_id: z.string().uuid().nullable(),
    canvas_event_id: z.number().int().positive(),
    title: z.string(),
    starts_at: z.string().datetime({ offset: true }).nullable(),
    ends_at: z.string().datetime({ offset: true }).nullable(),
    all_day: z.boolean(),
    location_name: z.string().nullable(),
    html_url: z.string().nullable(),
    archived_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type CanvasEvent = z.infer<typeof CanvasEventSchema>;

/**
 * `GET /canvas-assignments/upcoming` — one assignment row denormalized with
 * its course name and its connection's own `canvas_base_url`, for a client
 * that wants "what's due soon" without a separate course lookup per row (the
 * same denormalization this project's Today/Agenda read models already apply
 * to task/project names). Every field beyond `course_name`/`canvas_base_url`
 * is identical to `CanvasAssignmentSchema` — this is a read-model projection,
 * not a second entity.
 *
 * `canvas_base_url` exists so the mobile client can enforce a same-origin
 * check before ever calling `Linking.openURL(html_url)`: `html_url` is
 * Canvas-generated, not user-typed, but it is still provider-supplied
 * content this project does not control, and `Linking.openURL` opens
 * whatever it is given. Requiring `html_url`'s origin to equal
 * `canvas_base_url`'s origin before the row is even pressable turns "trust
 * Canvas's own link" into a structural, checkable invariant instead of an
 * assumption — the same posture ADR-059 §5 already takes for search results.
 */
//
// FROZEN AT THE 10.1 WIRE SHAPE (Checkpoint 10.2, ADR-070). The Rabbit R1's
// versionCode-22 build parses this route's response through THIS schema's
// 10.1 form, which is `.strict()` -- so ADR-068a's new `score`/`grade` keys
// must NOT be added here: the deployed client would reject the payload with
// `unrecognized_keys` and its Canvas card would silently vanish the moment a
// wider api deployed. `.omit()` makes the exclusion structural rather than a
// matter of the route remembering not to select two columns; `canvas.test.ts`
// pins it. New clients read `GET /academic/today` (academic.ts) instead, which
// carries the grade projection. Remove this route and schema once versionCode
// 23 is installed on the device.
export const CanvasUpcomingAssignmentSchema = CanvasAssignmentSchema.omit({
  score: true,
  grade: true,
})
  .extend({
    course_name: z.string(),
    canvas_base_url: z.string(),
  })
  .strict();
export type CanvasUpcomingAssignment = z.infer<typeof CanvasUpcomingAssignmentSchema>;

export const CanvasUpcomingAssignmentsResponseSchema = z.object({
  items: z.array(CanvasUpcomingAssignmentSchema),
});
export type CanvasUpcomingAssignmentsResponse = z.infer<
  typeof CanvasUpcomingAssignmentsResponseSchema
>;

/** `within_days` bounds for `GET /canvas-assignments/upcoming`, mirroring `RemindersQuerySchema`'s horizon-clamping convention. */
export const CANVAS_UPCOMING_DEFAULT_WITHIN_DAYS = 7;
export const CANVAS_UPCOMING_MAX_WITHIN_DAYS = 30;
export const CanvasUpcomingAssignmentsQuerySchema = z.object({
  within_days: z.coerce
    .number()
    .int()
    .min(1)
    .max(CANVAS_UPCOMING_MAX_WITHIN_DAYS)
    .default(CANVAS_UPCOMING_DEFAULT_WITHIN_DAYS),
});
export type CanvasUpcomingAssignmentsQuery = z.infer<typeof CanvasUpcomingAssignmentsQuerySchema>;

// ---------------------------------------------------------------------------
// Sync audit trail
// ---------------------------------------------------------------------------

/** Why a sync pass ran. Closed by design and CHECK-constrained in the database. */
export const CanvasSyncRunKindSchema = z.enum(["manual", "cron"]);
export type CanvasSyncRunKind = z.infer<typeof CanvasSyncRunKindSchema>;

/**
 * A run's terminal status. Closed by design and CHECK-constrained.
 *
 * Mirrors `mail_sync_runs`'s inversion: a row is opened `failed` before any
 * request goes out and flipped to its true terminal status only on
 * completion, so a killed process leaves evidence rather than silence.
 */
export const CanvasSyncRunStatusSchema = z.enum(["succeeded", "failed", "skipped"]);
export type CanvasSyncRunStatus = z.infer<typeof CanvasSyncRunStatusSchema>;

/**
 * One Canvas sync attempt.
 *
 * `courses_synced`/`assignments_synced`/`announcements_synced`/`events_synced`
 * are per-entity-kind counts rather than a single rows-changed total, because
 * one run walks four distinct entity kinds per course with independent
 * per-course failure containment (ADR-068 §5) -- "how many of each kind
 * actually landed" is the more useful audit signal here than one combined
 * count would be.
 */
export const CanvasSyncRunSchema = z
  .object({
    id: z.string().uuid(),
    connection_id: z.string().uuid(),
    kind: CanvasSyncRunKindSchema,
    status: CanvasSyncRunStatusSchema,
    started_at: z.string().datetime({ offset: true }),
    finished_at: z.string().datetime({ offset: true }).nullable(),
    courses_synced: z.number().int().min(0).nullable(),
    assignments_synced: z.number().int().min(0).nullable(),
    announcements_synced: z.number().int().min(0).nullable(),
    events_synced: z.number().int().min(0).nullable(),
    failure_class: CanvasSyncTokenSchema.nullable(),
    error_message: CanvasSyncTokenSchema.nullable(),
  })
  .strict();
export type CanvasSyncRun = z.infer<typeof CanvasSyncRunSchema>;

export const CanvasSyncRunsResponseSchema = z.object({
  items: z.array(CanvasSyncRunSchema),
});
export type CanvasSyncRunsResponse = z.infer<typeof CanvasSyncRunsResponseSchema>;

/** `POST /canvas-connections/:id/sync` — enqueues a manual sync; never runs it inline. */
export const CanvasSyncTriggerResponseSchema = z.object({ queued: z.boolean() });
export type CanvasSyncTriggerResponse = z.infer<typeof CanvasSyncTriggerResponseSchema>;
