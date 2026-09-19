// Agent Foundation & Action Framework (Checkpoint 10.8, ADR-078).
//
// ===========================================================================
// READS ARE TOOLS, WRITES ARE ACTIONS
// ===========================================================================
//
// `intelligence-tools.ts` defines the READ-ONLY tool contract a future agent
// binds (`READ_TOOL_NAMES`, every name `^(search|get)_`, Guard 4). This file
// is its sibling for WRITES. An action is a registered, permission-gated,
// owner-approved, audited mutation. The two vocabularies are disjoint by
// construction (`ACTION_IDS` verbs are pinned by regex and by test) and a
// future agent binds them differently: it may CALL a read tool; it may only
// REQUEST an action, which the owner then approves or cancels.
//
// What this file fixes, for every consumer (api, api-client, mobile):
//
//   ACTION_PERMISSIONS   the closed, user-visible, revocable capability
//                        vocabulary -- application-level, NOT OAuth scopes.
//                        Only members with a real enforcement site exist:
//                        10.8 has two write permissions and deliberately no
//                        read permission (nothing reads through the framework
//                        yet, and a vocabulary with zero enforcement sites is
//                        exactly what docs/AGENT-READINESS.md §2 criticises).
//   ACTION_IDS           the closed registry: six actions, three reversible
//                        pairs (owner decision, 2026-09-17).
//   ACTION_REGISTRY      per action: name, description, category, permission,
//                        risk, reversibility, `requires_approval: true` as a
//                        LITERAL -- a standing grant answers "may this
//                        principal request it?", never "may it run unasked?".
//   ACTION_INPUT_SCHEMAS the bounded, `.strict()` input each action accepts --
//                        narrowed from the existing create schemas, never wider.
//   ActionRequest*       the request row on the wire, its lifecycle and the
//                        create/list/approve/cancel shapes.
//   PermissionGrant*     the grant rows and the PATCH that revokes/re-grants.
//
// Nothing here is model-facing. Guard 7 (apps/api/src/ask/ai-egress-guard.
// test.ts) keeps every AI lane, every AI route file and the worker from naming
// the action tables or registry, and keeps the executor from importing any
// provider, so no model output can ever become an action request in 10.8.

import { isValidTimezone } from "@personal-os/core/timezone";
import { z } from "zod";
import { EventCalendarTargetSchema } from "./events.js";
import { PaginationQuerySchema, paginatedResponseSchema } from "./pagination.js";
import { FlexibleDatetimeSchema } from "./parser-tools.js";
import {
  ENTITY_TITLE_MAX_CHARS,
  EVENT_DESCRIPTION_MAX_CHARS,
  EVENT_LOCATION_MAX_CHARS,
  TASK_BODY_MAX_CHARS,
  tooLongMessage,
} from "./text-bounds.js";

// ---- Permissions (CHECK-free; Zod-enforced against this list) ------------

export const ACTION_PERMISSIONS = ["tasks.write", "calendar.write"] as const;
export const ActionPermissionSchema = z.enum(ACTION_PERMISSIONS);
export type ActionPermission = z.infer<typeof ActionPermissionSchema>;

/**
 * Bumped whenever the disclosure text for ANY permission widens. Stored on
 * every grant row; a live grant whose version is older than this is shown as
 * needing re-consent rather than silently covering the new disclosure.
 */
export const ACTION_PERMISSION_DISCLOSURE_VERSION = "2026-09-17";

export const ACTION_PERMISSION_LABELS: Record<
  ActionPermission,
  { label: string; description: string }
> = {
  "tasks.write": {
    label: "Tasks",
    description: "Create, complete, reopen and archive tasks — only after you approve each one.",
  },
  "calendar.write": {
    label: "Calendar",
    description:
      "Create and archive events you author in Personal OS — only after you approve each one. A linked event syncs to the calendar you chose.",
  },
};

/** `app` = Personal OS on the owner's behalf, from a client tap. `agent` = a registered agent principal through the Agent Gateway (Checkpoint 10.9, ADR-081). */
export const ACTION_PRINCIPALS = ["app", "agent"] as const;
export const ActionPrincipalSchema = z.enum(ACTION_PRINCIPALS);
export type ActionPrincipal = z.infer<typeof ActionPrincipalSchema>;

// ---- Closed vocabularies (CHECK-enforced in packages/db, ADR-050) --------

export const ACTION_REQUEST_STATUSES = [
  "pending",
  "executing",
  "completed",
  "failed",
  "cancelled",
  "expired",
] as const;
export const ActionRequestStatusSchema = z.enum(ACTION_REQUEST_STATUSES);
export type ActionRequestStatus = z.infer<typeof ActionRequestStatusSchema>;

/**
 * Where the proposal came from. The four 10.8 members are client-authored;
 * `agent` (Checkpoint 10.9, ADR-081) is written ONLY by the Agent Gateway
 * for a request an authenticated agent principal proposed, and its `reason`
 * is agent-authored UNTRUSTED display text (ADR-078 §6 amended). Widening
 * this enum is the one deliberate change to a frozen 10.8 wire schema: the
 * deployed client parses `source` strictly, and a `source: "agent"` row can
 * only exist after the owner has registered an agent through the client
 * that already understands it -- there is no other write path.
 */
export const ACTION_SOURCES = ["focus_now", "briefing", "academic", "manual", "agent"] as const;
export const ActionSourceSchema = z.enum(ACTION_SOURCES);
export type ActionSource = z.infer<typeof ActionSourceSchema>;

export const ACTION_TARGET_TYPES = ["task", "event"] as const;
export const ActionTargetTypeSchema = z.enum(ACTION_TARGET_TYPES);
export type ActionTargetType = z.infer<typeof ActionTargetTypeSchema>;

export const ACTION_CATEGORIES = ["tasks", "calendar"] as const;
export const ActionCategorySchema = z.enum(ACTION_CATEGORIES);
export type ActionCategory = z.infer<typeof ActionCategorySchema>;

export const ACTION_RISK_LEVELS = ["low", "medium", "high"] as const;
export const ActionRiskLevelSchema = z.enum(ACTION_RISK_LEVELS);
export type ActionRiskLevel = z.infer<typeof ActionRiskLevelSchema>;

// ---- The registry ---------------------------------------------------------

export const ACTION_IDS = [
  "create_calendar_event",
  "archive_calendar_event",
  "create_task",
  "archive_task",
  "complete_task",
  "reopen_task",
] as const;
export const ActionIdSchema = z.enum(ACTION_IDS);
export type ActionId = z.infer<typeof ActionIdSchema>;

/**
 * Every action id starts with one of these verbs. Read tools start with
 * `search_`/`get_` (Guard 4), so the two vocabularies can never collide.
 */
export const ACTION_ID_VERB_PATTERN = /^(?:create|archive|complete|reopen)_[a-z_]+$/;

export const ActionReversibilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("none") }).strict(),
  z.object({ kind: z.literal("via_action"), action_id: ActionIdSchema }).strict(),
]);
export type ActionReversibility = z.infer<typeof ActionReversibilitySchema>;

export const ACTION_NAME_MAX_CHARS = 60;
export const ACTION_DESCRIPTION_MAX_CHARS = 200;

/** Wire-safe projection of one registry entry (no Zod schemas inside). */
export const ActionDefinitionSchema = z
  .object({
    id: ActionIdSchema,
    name: z.string().min(1).max(ACTION_NAME_MAX_CHARS),
    description: z.string().min(1).max(ACTION_DESCRIPTION_MAX_CHARS),
    category: ActionCategorySchema,
    permission: ActionPermissionSchema,
    risk: ActionRiskLevelSchema,
    reversibility: ActionReversibilitySchema,
    target_type: ActionTargetTypeSchema,
    requires_approval: z.literal(true),
  })
  .strict();
export type ActionDefinition = z.infer<typeof ActionDefinitionSchema>;

export const ACTION_REGISTRY = {
  create_calendar_event: {
    id: "create_calendar_event",
    name: "Create calendar event",
    description: "Adds a timed event you author in Personal OS, optionally linked to a calendar.",
    category: "calendar",
    permission: "calendar.write",
    risk: "medium",
    reversibility: { kind: "via_action", action_id: "archive_calendar_event" },
    target_type: "event",
    requires_approval: true,
  },
  archive_calendar_event: {
    id: "archive_calendar_event",
    name: "Archive calendar event",
    description:
      "Hides an event you authored here. If it is linked to a calendar, the copy there is deleted too.",
    category: "calendar",
    permission: "calendar.write",
    risk: "medium",
    reversibility: { kind: "none" },
    target_type: "event",
    requires_approval: true,
  },
  create_task: {
    id: "create_task",
    name: "Create task",
    description:
      "Adds a one-off task, optionally with a due time, a reminder and a linked assignment.",
    category: "tasks",
    permission: "tasks.write",
    risk: "low",
    reversibility: { kind: "via_action", action_id: "archive_task" },
    target_type: "task",
    requires_approval: true,
  },
  archive_task: {
    id: "archive_task",
    name: "Archive task",
    description: "Hides a task. There is no in-app route back.",
    category: "tasks",
    permission: "tasks.write",
    risk: "medium",
    reversibility: { kind: "none" },
    target_type: "task",
    requires_approval: true,
  },
  complete_task: {
    id: "complete_task",
    name: "Complete task",
    description: "Marks a one-off task done. Recurring tasks complete through their occurrences.",
    category: "tasks",
    permission: "tasks.write",
    risk: "low",
    reversibility: { kind: "via_action", action_id: "reopen_task" },
    target_type: "task",
    requires_approval: true,
  },
  reopen_task: {
    id: "reopen_task",
    name: "Reopen task",
    description: "Puts a done or dropped task back on your list.",
    category: "tasks",
    permission: "tasks.write",
    risk: "low",
    reversibility: { kind: "via_action", action_id: "complete_task" },
    target_type: "task",
    requires_approval: true,
  },
} as const satisfies { readonly [K in ActionId]: ActionDefinition & { readonly id: K } };

// ---- Inputs (bounded, `.strict()`, narrowed from the existing create shapes)

const titleField = z
  .string()
  .trim()
  .min(1)
  .max(ENTITY_TITLE_MAX_CHARS, tooLongMessage("title", ENTITY_TITLE_MAX_CHARS));

const timezoneField = z.string().refine(isValidTimezone, { message: "unknown IANA timezone" });

/**
 * A timed event authored by Personal OS -- the "Plan study block" shape. No
 * all-day form and no recurrence in 10.8: a proposal is one concrete block.
 * `calendar` is the same write-eligible target `POST /events` accepts
 * (ADR-064); the link row is created in the executor's transaction.
 */
export const CreateCalendarEventInputSchema = z
  .object({
    title: titleField,
    description: z
      .string()
      .max(EVENT_DESCRIPTION_MAX_CHARS, tooLongMessage("description", EVENT_DESCRIPTION_MAX_CHARS))
      .optional(),
    location: z
      .string()
      .max(EVENT_LOCATION_MAX_CHARS, tooLongMessage("location", EVENT_LOCATION_MAX_CHARS))
      .optional(),
    starts_at: FlexibleDatetimeSchema,
    ends_at: FlexibleDatetimeSchema,
    timezone: timezoneField,
    project_id: z.string().uuid().optional(),
    calendar: EventCalendarTargetSchema.optional(),
  })
  .strict()
  .refine((value) => new Date(value.ends_at).getTime() > new Date(value.starts_at).getTime(), {
    path: ["ends_at"],
    message: "ends_at must be after starts_at",
  });

export const ArchiveCalendarEventInputSchema = z.object({ event_id: z.string().uuid() }).strict();

/**
 * A one-off task. No recurrence in 10.8 (a rule generates occurrences
 * indefinitely; that is a bigger decision than one approval). Unlike
 * `TaskCreateSchema`, this accepts `canvas_assignment_id` -- the second
 * explicit, owner-approved write path for the ADR-074 link; existence is
 * pre-checked exactly as PATCH /tasks/:id does.
 */
export const CreateTaskInputSchema = z
  .object({
    title: titleField,
    body: z
      .string()
      .max(TASK_BODY_MAX_CHARS, tooLongMessage("body", TASK_BODY_MAX_CHARS))
      .optional(),
    due_at: FlexibleDatetimeSchema.optional(),
    remind_at: FlexibleDatetimeSchema.optional(),
    priority: z.number().int().min(1).max(4).optional(),
    project_id: z.string().uuid().optional(),
    canvas_assignment_id: z.string().uuid().optional(),
    timezone: timezoneField,
  })
  .strict();

const TaskTargetInputSchema = z.object({ task_id: z.string().uuid() }).strict();

export const ACTION_INPUT_SCHEMAS = {
  create_calendar_event: CreateCalendarEventInputSchema,
  archive_calendar_event: ArchiveCalendarEventInputSchema,
  create_task: CreateTaskInputSchema,
  archive_task: TaskTargetInputSchema,
  complete_task: TaskTargetInputSchema,
  reopen_task: TaskTargetInputSchema,
} as const satisfies Record<ActionId, z.ZodTypeAny>;

export type ActionInput<Id extends ActionId = ActionId> = z.infer<
  (typeof ACTION_INPUT_SCHEMAS)[Id]
>;

const EventOutputSchema = z.object({ event_id: z.string().uuid() }).strict();
const TaskOutputSchema = z.object({ task_id: z.string().uuid() }).strict();

export const ACTION_OUTPUT_SCHEMAS = {
  create_calendar_event: EventOutputSchema,
  archive_calendar_event: EventOutputSchema,
  create_task: TaskOutputSchema,
  archive_task: TaskOutputSchema,
  complete_task: TaskOutputSchema,
  reopen_task: TaskOutputSchema,
} as const satisfies Record<ActionId, z.ZodTypeAny>;

export type ActionOutput<Id extends ActionId = ActionId> = z.infer<
  (typeof ACTION_OUTPUT_SCHEMAS)[Id]
>;

// ---- Bounds and lifecycle constants --------------------------------------

/** A pending request the owner has not answered expires after this long. */
export const ACTION_REQUEST_TTL_HOURS = 24;
/** Client-authored "why" shown on the approval sheet. */
export const ACTION_REASON_MAX_CHARS = 160;
/** An opaque pointer into the proposing surface (a Focus Now source, an assignment id). */
export const ACTION_SOURCE_REF_MAX_CHARS = 64;
/** Server-authored one-line summaries. */
export const ACTION_SUMMARY_MAX_CHARS = 200;

/**
 * Token-shaped, never prose (the *_sync_runs rule). The known values are
 * listed so the client can label them; the regex is what the row obeys.
 */
export const ACTION_ERROR_CLASS_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const ACTION_ERROR_CLASSES = [
  "target_not_found",
  "target_not_local",
  "target_archived",
  "task_recurring",
  "task_not_open",
  "task_not_reopenable",
  "calendar_not_eligible",
  "input_invalid",
  "permission_revoked",
  "execution_failed",
] as const;
export type ActionErrorClass = (typeof ACTION_ERROR_CLASSES)[number];
export const ActionErrorClassSchema = z.string().regex(ACTION_ERROR_CLASS_PATTERN);

// ---- The request row on the wire -----------------------------------------

const ActionRequestBase = z.object({
  id: z.string().uuid(),
  client_uuid: z.string().uuid().nullable(),
  principal: ActionPrincipalSchema,
  status: ActionRequestStatusSchema,
  source: ActionSourceSchema,
  source_ref: z.string().nullable(),
  reason: z.string().nullable(),
  input_summary: z.string(),
  result_summary: z.string().nullable(),
  target_type: ActionTargetTypeSchema.nullable(),
  target_id: z.string().uuid().nullable(),
  error_class: ActionErrorClassSchema.nullable(),
  reverses_request_id: z.string().uuid().nullable(),
  requested_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }),
  approved_at: z.string().datetime({ offset: true }).nullable(),
  finished_at: z.string().datetime({ offset: true }).nullable(),
});

/**
 * The stored `input` travels LOOSELY typed on the wire and is narrowed by the
 * consumer through `parseActionInput` -- deliberately, after the first draft
 * discriminated it per action: a row whose frozen input no longer parses
 * (a bound tightened while it waited) must still be listable, or one bad
 * row would blank the entire Action Center. The executor re-parses through
 * the action's own schema at approval time; the client parses to render
 * "what will change" and falls back to `input_summary` when it cannot.
 */
export const ActionRequestSchema = ActionRequestBase.extend({
  action_id: ActionIdSchema,
  input: z.record(z.string(), z.unknown()),
}).strict();
export type ActionRequest = z.infer<typeof ActionRequestSchema>;

/**
 * A list/detail item: the row plus what the client needs to render "Undo"
 * honestly -- the id of the completed request that already reversed this
 * one, if any. The registry entry itself is not repeated on the wire: the
 * client imports `ACTION_REGISTRY` from this package.
 */
export const ActionRequestItemSchema = ActionRequestSchema.extend({
  reversed_by_request_id: z.string().uuid().nullable(),
}).strict();
export type ActionRequestItem = z.infer<typeof ActionRequestItemSchema>;

/** Narrows a request's stored input through its action's own schema; null when it no longer parses. */
export function parseActionInput<Id extends ActionId>(request: {
  action_id: Id;
  input: unknown;
}): ActionInput<Id> | null {
  const result = ACTION_INPUT_SCHEMAS[request.action_id].safeParse(request.input);
  return result.success ? (result.data as ActionInput<Id>) : null;
}

// ---- Writes ---------------------------------------------------------------

const reasonField = z
  .string()
  .trim()
  .min(1)
  .max(ACTION_REASON_MAX_CHARS, tooLongMessage("reason", ACTION_REASON_MAX_CHARS));

const sourceRefField = z
  .string()
  .trim()
  .min(1)
  .max(ACTION_SOURCE_REF_MAX_CHARS, tooLongMessage("source_ref", ACTION_SOURCE_REF_MAX_CHARS));

function createVariant<Id extends ActionId>(id: Id) {
  return z
    .object({
      action_id: z.literal(id),
      input: ACTION_INPUT_SCHEMAS[id],
      source: ActionSourceSchema,
      source_ref: sourceRefField.optional(),
      reason: reasonField.optional(),
      // Idempotency (the POST /events idiom): a retry with the same uuid
      // returns the existing request (200) instead of a second one.
      client_uuid: z.string().uuid().optional(),
      // Set when this request undoes a COMPLETED request whose registry
      // entry names this action as its reversal.
      reverses_request_id: z.string().uuid().optional(),
    })
    .strict();
}

/**
 * `principal` is never client-supplied: POST /actions always writes `app`.
 * The `agent` principal's ONLY write path is POST /agent/actions through the
 * Agent Gateway (`AgentActionCreateSchema` in agents.ts), which sets it
 * server-side.
 */
export const ActionRequestCreateSchema = z.discriminatedUnion("action_id", [
  createVariant("create_calendar_event"),
  createVariant("archive_calendar_event"),
  createVariant("create_task"),
  createVariant("archive_task"),
  createVariant("complete_task"),
  createVariant("reopen_task"),
]);
export type ActionRequestCreate = z.infer<typeof ActionRequestCreateSchema>;

export const ActionListQuerySchema = PaginationQuerySchema.extend({
  status: ActionRequestStatusSchema.optional(),
  action_id: ActionIdSchema.optional(),
});
export type ActionListQuery = z.infer<typeof ActionListQuerySchema>;

export const ActionListResponseSchema = paginatedResponseSchema(ActionRequestItemSchema);
export type ActionListResponse = z.infer<typeof ActionListResponseSchema>;

/** For the Settings card and the Today "Needs your approval" card. */
export const ActionsSummarySchema = z
  .object({
    pending_total: z.number().int().min(0),
    completed_last_7_days: z.number().int().min(0),
    permissions_granted: z.number().int().min(0),
    permissions_total: z.number().int().min(0),
  })
  .strict();
export type ActionsSummary = z.infer<typeof ActionsSummarySchema>;

// ---- Permission grants on the wire ---------------------------------------

export const PermissionGrantItemSchema = z
  .object({
    permission: ActionPermissionSchema,
    principal: ActionPrincipalSchema,
    label: z.string(),
    description: z.string(),
    category: ActionCategorySchema,
    granted: z.boolean(),
    granted_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
    disclosure_version: z.string().nullable(),
    /** True when the live grant predates ACTION_PERMISSION_DISCLOSURE_VERSION. */
    needs_reconsent: z.boolean(),
    /** Completed requests that needed this permission. */
    usage_count: z.number().int().min(0),
    last_used_at: z.string().datetime({ offset: true }).nullable(),
    action_ids: z.array(ActionIdSchema),
  })
  .strict();
export type PermissionGrantItem = z.infer<typeof PermissionGrantItemSchema>;

export const PermissionsResponseSchema = z
  .object({
    disclosure_version: z.literal(ACTION_PERMISSION_DISCLOSURE_VERSION),
    items: z.array(PermissionGrantItemSchema),
  })
  .strict();
export type PermissionsResponse = z.infer<typeof PermissionsResponseSchema>;

/**
 * PATCH /permissions/:permission for the `app` principal. Revoking cancels
 * every pending request that needs the permission, in the same transaction.
 */
export const PermissionUpdateSchema = z.object({ granted: z.boolean() }).strict();
export type PermissionUpdate = z.infer<typeof PermissionUpdateSchema>;

export const PermissionUpdateResponseSchema = z
  .object({
    item: PermissionGrantItemSchema,
    /** Pending requests cancelled by a revoke; 0 on a grant. */
    cancelled_pending: z.number().int().min(0),
  })
  .strict();
export type PermissionUpdateResponse = z.infer<typeof PermissionUpdateResponseSchema>;

// ---- Helpers over the registry (pure) ------------------------------------

export function actionDefinition<Id extends ActionId>(id: Id): (typeof ACTION_REGISTRY)[Id] {
  return ACTION_REGISTRY[id];
}

export function actionsRequiring(permission: ActionPermission): ActionId[] {
  return ACTION_IDS.filter((id) => ACTION_REGISTRY[id].permission === permission);
}

/** The action that undoes `id`, or null when the registry says `none`. */
export function reversalActionOf(id: ActionId): ActionId | null {
  const reversibility = ACTION_REGISTRY[id].reversibility;
  return reversibility.kind === "via_action" ? reversibility.action_id : null;
}
