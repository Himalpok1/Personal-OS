// Agent Readiness & Agent Gateway (Checkpoint 10.9, ADR-081).
//
// ===========================================================================
// THE BOUNDARY, NOT THE AGENT
// ===========================================================================
//
// Personal OS owns identity, context, memory, permissions, tools, actions,
// approvals and audit; the agent is replaceable. This file is the contract a
// future agent -- internal or external, OpenClaw, Hermes or otherwise --
// operates through, and it is deliberately the SMALLEST useful one:
//
//   AGENT_TRUST_LEVELS   the per-agent axis. `none` (registered, paused),
//                        `read` (may call read tools), `propose` (may also
//                        REQUEST actions). There is no `operator` member: the
//                        trusted-operator level ADR-079 §4 grants Ray is host
//                        access outside the product, and nothing in the
//                        product ever runs an action without the owner's tap
//                        (ADR-078 `requires_approval: true` is a literal).
//   READ_PERMISSIONS     the per-principal read vocabulary, a SIBLING of
//                        `ACTION_PERMISSIONS` (which stays exactly two write
//                        members, wire-frozen for the deployed client). Every
//                        member has an enforcement site in the gateway.
//                        Agent grants ship OFF: `grantIsLive("agent", none)`
//                        is false. Reserved and NOT bound: `memory.read`
//                        (ADR-077 -- no memory text reaches an agent).
//   READ_TOOL_PERMISSION which grant each of the six read tools needs, and
//                        READ_TOOL_SENSITIVITY what class of text it carries.
//   Agent*               the owner's wire (register / list / update / revoke /
//                        activity / permissions) and the agent's wire
//                        (manifest / tool call / action request). The two
//                        never share a route prefix: owner routes are
//                        `/agents/*` (device-bound, ADR-082), agent routes are
//                        `/agent/*` (agent-token-bound, never approving).
//
// Reads are tools, writes are actions (ADR-078 §1): an agent CALLS a read
// tool and REQUESTS an action; the owner approves in the Action Center.
// Nothing here is model-facing. Guard 8 keeps every AI lane, the worker and
// every other read model from importing the agent modules, and keeps the
// gateway from importing `ai`, a provider, memory, health, mail or a
// credential table.

import { z } from "zod";
import {
  ACTION_ERROR_CLASS_PATTERN,
  ACTION_INPUT_SCHEMAS,
  ACTION_PERMISSION_DISCLOSURE_VERSION,
  ACTION_PERMISSIONS,
  ACTION_REASON_MAX_CHARS,
  ActionCategorySchema,
  ActionIdSchema,
  ActionPermissionSchema,
  ActionRequestItemSchema,
  ActionRequestStatusSchema,
  ActionReversibilitySchema,
  ActionRiskLevelSchema,
  ActionTargetTypeSchema,
  type ActionId,
  type ActionPermission,
} from "./actions.js";
import {
  READ_TOOL_MAX_CALLS_PER_REQUEST,
  READ_TOOL_MAX_CHARS_PER_REQUEST,
  READ_TOOL_NAMES,
  ReadToolNameSchema,
  type ReadToolName,
} from "./intelligence-tools.js";
import { PaginationQuerySchema, paginatedResponseSchema } from "./pagination.js";
import { tooLongMessage } from "./text-bounds.js";

// ---- Versions and disclosure ---------------------------------------------

/** Bumped whenever a tool, an action, a budget or a field on the manifest changes shape. */
export const AGENT_CONTRACT_VERSION = "2026-09-18";

/** Stored on every `agents` row at registration: WHICH disclosure the owner registered under. */
export const AGENT_DISCLOSURE_VERSION = "2026-09-18";

/**
 * Shown once, at registration, above the trust-level choice. Byte-pinned by
 * the mobile client (agents-trust-line.test.ts) so the sentence the owner
 * agreed to is the sentence in the code.
 */
export const AGENT_DISCLOSURE_TEXT =
  "An agent with this token can read only what its trust level and permissions allow, and can propose actions you approve in the Action Center. It can never run an action, change a permission, or see your memories, health or mail. Revoke it here at any time.";

/** Visible prefix so an agent token is recognisable by eye and by a secret scanner. */
export const AGENT_TOKEN_PREFIX = "posa_";

// ---- Trust levels (CHECK-enforced in packages/db, ADR-050) ---------------

export const AGENT_TRUST_LEVELS = ["none", "read", "propose"] as const;
export const AgentTrustLevelSchema = z.enum(AGENT_TRUST_LEVELS);
export type AgentTrustLevel = z.infer<typeof AgentTrustLevelSchema>;

export const AGENT_TRUST_LEVEL_LABELS: Record<
  AgentTrustLevel,
  { label: string; description: string }
> = {
  none: {
    label: "Paused",
    description: "Registered, but nothing is allowed until you choose a level.",
  },
  read: {
    label: "Read",
    description: "Can call the read tools you grant. Cannot propose anything.",
  },
  propose: {
    label: "Propose",
    description: "Can read, and can propose actions that wait for your approval.",
  },
};

/** Ordered so a required level can be compared: none < read < propose. */
export const AGENT_TRUST_RANK: Record<AgentTrustLevel, number> = { none: 0, read: 1, propose: 2 };

export function trustLevelAtLeast(level: AgentTrustLevel, required: AgentTrustLevel): boolean {
  return AGENT_TRUST_RANK[level] >= AGENT_TRUST_RANK[required];
}

export const AGENT_NAME_MAX_CHARS = 60;

// ---- Permissions -----------------------------------------------------------

/**
 * Read permissions. `context.read` covers the id/title-level tools;
 * `items.read` is separate because `get_item_context` carries a body;
 * `academic.read` is separate because academic data is otherwise structurally
 * outside every AI-adjacent surface (ADR-070, amended by ADR-070b for this
 * one gate). All ship OFF for the `agent` principal.
 */
export const READ_PERMISSIONS = ["context.read", "items.read", "academic.read"] as const;
export const ReadPermissionSchema = z.enum(READ_PERMISSIONS);
export type ReadPermission = z.infer<typeof ReadPermissionSchema>;

/**
 * Named here so a test can prove they are NOT members: a permission with no
 * enforcement site is exactly what docs/AGENT-READINESS.md §2 criticises,
 * and a memory tool would need its own ADR, disclosure vintage and Guard 6
 * amendment (ADR-077 §6).
 */
export const RESERVED_PERMISSION_NAMES = ["memory.read"] as const;

export const AGENT_PERMISSIONS = [...ACTION_PERMISSIONS, ...READ_PERMISSIONS] as const;
export const AgentPermissionSchema = z.enum(AGENT_PERMISSIONS);
export type AgentPermission = z.infer<typeof AgentPermissionSchema>;

export const AgentPermissionKindSchema = z.enum(["read", "write"]);
export type AgentPermissionKind = z.infer<typeof AgentPermissionKindSchema>;

export const AgentPermissionCategorySchema = z.enum([
  "tasks",
  "calendar",
  "context",
  "items",
  "academic",
]);
export type AgentPermissionCategory = z.infer<typeof AgentPermissionCategorySchema>;

export const READ_PERMISSION_LABELS: Record<
  ReadPermission,
  { label: string; description: string; category: AgentPermissionCategory }
> = {
  "context.read": {
    label: "Today, calendar & tasks",
    description:
      "Search by title and read your schedule, task list and today's overview — titles, times and ids, never a note or task body.",
    category: "context",
  },
  "items.read": {
    label: "Item bodies",
    description: "Read the full text of one task or note at a time, by id.",
    category: "items",
  },
  "academic.read": {
    label: "Academics",
    description:
      "Read your current-term courses and assignments from Canvas — titles, due dates, points and submission state. Never links, announcements or grades.",
    category: "academic",
  },
};

export function permissionKind(permission: AgentPermission): AgentPermissionKind {
  return (READ_PERMISSIONS as readonly string[]).includes(permission) ? "read" : "write";
}

export function isReadPermission(permission: AgentPermission): permission is ReadPermission {
  return permissionKind(permission) === "read";
}

export function isActionPermission(permission: AgentPermission): permission is ActionPermission {
  return permissionKind(permission) === "write";
}

// ---- Read tools: permission, sensitivity, descriptions ---------------------

export const READ_TOOL_PERMISSION = {
  search_personal_items: "context.read",
  get_item_context: "items.read",
  get_today_context: "context.read",
  get_calendar_context: "context.read",
  get_task_context: "context.read",
  get_academic_context: "academic.read",
} as const satisfies Record<ReadToolName, ReadPermission>;

/** What class of text a tool's output carries -- published on the manifest, never interpreted by the gateway. */
export const READ_TOOL_SENSITIVITIES = ["titles", "bodies", "third_party_text"] as const;
export const ReadToolSensitivitySchema = z.enum(READ_TOOL_SENSITIVITIES);
export type ReadToolSensitivity = z.infer<typeof ReadToolSensitivitySchema>;

export const READ_TOOL_SENSITIVITY = {
  search_personal_items: "titles",
  get_item_context: "bodies",
  get_today_context: "titles",
  get_calendar_context: "titles",
  get_task_context: "titles",
  get_academic_context: "third_party_text",
} as const satisfies Record<ReadToolName, ReadToolSensitivity>;

export const READ_TOOL_DESCRIPTIONS: Record<ReadToolName, { name: string; description: string }> = {
  search_personal_items: {
    name: "Search",
    description:
      "Lexical search over tasks, notes, events, projects, captures and mail metadata. Returns ids, titles and previews.",
  },
  get_item_context: {
    name: "Item context",
    description: "One task or note by id, with its bounded body.",
  },
  get_today_context: {
    name: "Today",
    description:
      "The bounded, id-free overview of today: overdue, due today, upcoming, events, reminders, open loops.",
  },
  get_calendar_context: {
    name: "Calendar",
    description: "Events and instances in a local-date window of at most 14 days, with ids.",
  },
  get_task_context: {
    name: "Task",
    description: "One task by id: status, schedule, project and open occurrences. Never the body.",
  },
  get_academic_context: {
    name: "Academics",
    description:
      "Current-term courses and open assignments with due dates, points and submission state.",
  },
};

export function toolsRequiring(permission: ReadPermission): ReadToolName[] {
  return READ_TOOL_NAMES.filter((name) => READ_TOOL_PERMISSION[name] === permission);
}

// ---- Budgets ---------------------------------------------------------------

/** Per-agent rolling cap on tool calls, on top of the per-correlation budgets. */
export const AGENT_TOOL_CALLS_PER_MINUTE = 60;

export const AgentBudgetSchema = z
  .object({
    correlation_id: z.string().uuid(),
    calls_used: z.number().int().min(0),
    calls_max: z.literal(READ_TOOL_MAX_CALLS_PER_REQUEST),
    chars_used: z.number().int().min(0),
    chars_max: z.literal(READ_TOOL_MAX_CHARS_PER_REQUEST),
  })
  .strict();
export type AgentBudget = z.infer<typeof AgentBudgetSchema>;

// ---- Tool-call audit rows ---------------------------------------------------

export const AGENT_TOOL_CALL_STATUSES = ["completed", "refused", "failed"] as const;
export const AgentToolCallStatusSchema = z.enum(AGENT_TOOL_CALL_STATUSES);
export type AgentToolCallStatus = z.infer<typeof AgentToolCallStatusSchema>;

/** Token-shaped, never prose. Listed so the client can label them; the regex is what a row obeys. */
export const AGENT_TOOL_ERROR_CLASSES = [
  "trust_insufficient",
  "permission_not_granted",
  "budget_calls_exceeded",
  "budget_chars_exceeded",
  "rate_limited",
  "input_invalid",
  "target_not_found",
  "tool_failed",
] as const;
export type AgentToolErrorClass = (typeof AGENT_TOOL_ERROR_CLASSES)[number];
export const AgentToolErrorClassSchema = z.string().regex(ACTION_ERROR_CLASS_PATTERN);

export const AgentToolCallSchema = z
  .object({
    id: z.string().uuid(),
    agent_id: z.string().uuid(),
    correlation_id: z.string().uuid(),
    tool_name: ReadToolNameSchema,
    status: AgentToolCallStatusSchema,
    error_class: AgentToolErrorClassSchema.nullable(),
    chars_returned: z.number().int().min(0),
    duration_ms: z.number().int().min(0).nullable(),
    called_at: z.string().datetime({ offset: true }),
  })
  .strict();
export type AgentToolCall = z.infer<typeof AgentToolCallSchema>;

// ---- The owner's wire -------------------------------------------------------

const nameField = z
  .string()
  .trim()
  .min(1)
  .max(AGENT_NAME_MAX_CHARS, tooLongMessage("name", AGENT_NAME_MAX_CHARS));

export const AgentSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    trust_level: AgentTrustLevelSchema,
    disclosure_version: z.string(),
    created_at: z.string().datetime({ offset: true }),
    updated_at: z.string().datetime({ offset: true }),
    last_seen_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type Agent = z.infer<typeof AgentSchema>;

export const AgentRegisterSchema = z
  .object({ name: nameField, trust_level: AgentTrustLevelSchema })
  .strict();
export type AgentRegister = z.infer<typeof AgentRegisterSchema>;

/** The ONLY response that ever carries the raw token. Only its hash is stored. */
export const AgentRegisterResponseSchema = z
  .object({ agent: AgentSchema, token: z.string().startsWith(AGENT_TOKEN_PREFIX) })
  .strict();
export type AgentRegisterResponse = z.infer<typeof AgentRegisterResponseSchema>;

export const AgentUpdateSchema = z
  .object({ name: nameField.optional(), trust_level: AgentTrustLevelSchema.optional() })
  .strict()
  .refine((value) => value.name !== undefined || value.trust_level !== undefined, {
    message: "nothing to update",
  });
export type AgentUpdate = z.infer<typeof AgentUpdateSchema>;

export const AgentListResponseSchema = z.object({ items: z.array(AgentSchema) }).strict();
export type AgentListResponse = z.infer<typeof AgentListResponseSchema>;

/**
 * One line of an agent's activity, newest first. A tool call and an action
 * request are different tables (Guards 7 and 8 keep them apart), so the
 * read model merges two lists; the client groups by `correlation_id` into
 * "Read: … → Proposed: … → Approved → Result".
 */
export const AgentActivityItemSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("tool_call"),
      at: z.string().datetime({ offset: true }),
      correlation_id: z.string().uuid(),
      tool_call: AgentToolCallSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("action_request"),
      at: z.string().datetime({ offset: true }),
      correlation_id: z.string().uuid().nullable(),
      request: ActionRequestItemSchema,
    })
    .strict(),
]);
export type AgentActivityItem = z.infer<typeof AgentActivityItemSchema>;

export const AgentActivityQuerySchema = PaginationQuerySchema;
export type AgentActivityQuery = z.infer<typeof AgentActivityQuerySchema>;

export const AgentActivityResponseSchema = paginatedResponseSchema(AgentActivityItemSchema);
export type AgentActivityResponse = z.infer<typeof AgentActivityResponseSchema>;

/**
 * An `agent`-principal grant on the wire. Its own shape, NOT
 * `PermissionGrantItemSchema`: that one is strict, carries a `tasks|calendar`
 * category and `action_ids`, and is parsed by the deployed client, so a read
 * permission could never ride on it.
 */
export const AgentPermissionGrantItemSchema = z
  .object({
    permission: AgentPermissionSchema,
    principal: z.literal("agent"),
    kind: AgentPermissionKindSchema,
    category: AgentPermissionCategorySchema,
    label: z.string(),
    description: z.string(),
    granted: z.boolean(),
    granted_at: z.string().datetime({ offset: true }).nullable(),
    revoked_at: z.string().datetime({ offset: true }).nullable(),
    disclosure_version: z.string().nullable(),
    needs_reconsent: z.boolean(),
    action_ids: z.array(ActionIdSchema),
    tool_names: z.array(ReadToolNameSchema),
  })
  .strict();
export type AgentPermissionGrantItem = z.infer<typeof AgentPermissionGrantItemSchema>;

export const AgentPermissionsResponseSchema = z
  .object({
    disclosure_version: z.literal(ACTION_PERMISSION_DISCLOSURE_VERSION),
    items: z.array(AgentPermissionGrantItemSchema),
  })
  .strict();
export type AgentPermissionsResponse = z.infer<typeof AgentPermissionsResponseSchema>;

export const AgentPermissionUpdateResponseSchema = z
  .object({
    item: AgentPermissionGrantItemSchema,
    /** Pending agent requests cancelled by a revoke; 0 on a grant or a read permission. */
    cancelled_pending: z.number().int().min(0),
  })
  .strict();
export type AgentPermissionUpdateResponse = z.infer<typeof AgentPermissionUpdateResponseSchema>;

// ---- The agent's wire -------------------------------------------------------

export const AgentToolCallRequestSchema = z
  .object({
    input: z.record(z.string(), z.unknown()),
    /** Agent-supplied; the unit every budget is counted against and the key the activity screen groups on. */
    correlation_id: z.string().uuid(),
  })
  .strict();
export type AgentToolCallRequest = z.infer<typeof AgentToolCallRequestSchema>;

export const AgentToolCallResponseSchema = z
  .object({
    tool_name: ReadToolNameSchema,
    correlation_id: z.string().uuid(),
    output: z.unknown(),
    budget: AgentBudgetSchema,
  })
  .strict();
export type AgentToolCallResponse = z.infer<typeof AgentToolCallResponseSchema>;

/** A refusal body: token-shaped, never prose from the tool. */
export const AgentRefusalSchema = z
  .object({
    error: z.enum(["agent_tool_refused", "agent_action_refused"]),
    error_class: AgentToolErrorClassSchema,
    budget: AgentBudgetSchema.optional(),
  })
  .strict();
export type AgentRefusal = z.infer<typeof AgentRefusalSchema>;

const agentReasonField = z
  .string()
  .trim()
  .min(1)
  .max(ACTION_REASON_MAX_CHARS, tooLongMessage("reason", ACTION_REASON_MAX_CHARS));

function agentActionVariant<Id extends ActionId>(id: Id) {
  return z
    .object({
      action_id: z.literal(id),
      input: ACTION_INPUT_SCHEMAS[id],
      /** REQUIRED for an agent, unlike the owner's optional one: the sheet shows it quoted as "Agent says". */
      reason: agentReasonField,
      correlation_id: z.string().uuid(),
      /** Idempotency, the POST /events idiom: a retry returns the existing request. */
      client_uuid: z.string().uuid().optional(),
    })
    .strict();
}

/**
 * What an agent may POST. No `source` (the gateway writes `agent`), no
 * `source_ref` (the gateway writes the agent's id), no `principal`, no
 * `reverses_request_id` (an undo is the owner's tap, never an agent's).
 */
export const AgentActionCreateSchema = z.discriminatedUnion("action_id", [
  agentActionVariant("create_calendar_event"),
  agentActionVariant("archive_calendar_event"),
  agentActionVariant("create_task"),
  agentActionVariant("archive_task"),
  agentActionVariant("complete_task"),
  agentActionVariant("reopen_task"),
]);
export type AgentActionCreate = z.infer<typeof AgentActionCreateSchema>;

/** The agent-facing projection of its own request: never the frozen `input`, never the reason echoed back. */
export const AgentActionItemSchema = z
  .object({
    id: z.string().uuid(),
    action_id: ActionIdSchema,
    status: ActionRequestStatusSchema,
    input_summary: z.string(),
    result_summary: z.string().nullable(),
    error_class: z.string().nullable(),
    target_type: ActionTargetTypeSchema.nullable(),
    target_id: z.string().uuid().nullable(),
    correlation_id: z.string().uuid().nullable(),
    requested_at: z.string().datetime({ offset: true }),
    expires_at: z.string().datetime({ offset: true }),
    approved_at: z.string().datetime({ offset: true }).nullable(),
    finished_at: z.string().datetime({ offset: true }).nullable(),
  })
  .strict();
export type AgentActionItem = z.infer<typeof AgentActionItemSchema>;

export const AgentActionListQuerySchema = PaginationQuerySchema.extend({
  status: ActionRequestStatusSchema.optional(),
});
export type AgentActionListQuery = z.infer<typeof AgentActionListQuerySchema>;

export const AgentActionListResponseSchema = paginatedResponseSchema(AgentActionItemSchema);
export type AgentActionListResponse = z.infer<typeof AgentActionListResponseSchema>;

// ---- The manifest -----------------------------------------------------------

const JsonSchemaObject = z.record(z.string(), z.unknown());

export const AgentManifestToolSchema = z
  .object({
    tool_id: ReadToolNameSchema,
    name: z.string(),
    description: z.string(),
    classification: z.literal("read"),
    permission: ReadPermissionSchema,
    sensitivity: ReadToolSensitivitySchema,
    /** Every call is written to the audit trail, including refusals. */
    audited: z.literal(true),
    input_schema: JsonSchemaObject,
    output_schema: JsonSchemaObject,
  })
  .strict();
export type AgentManifestTool = z.infer<typeof AgentManifestToolSchema>;

export const AgentManifestActionSchema = z
  .object({
    action_id: ActionIdSchema,
    name: z.string(),
    description: z.string(),
    classification: z.literal("action"),
    category: ActionCategorySchema,
    permission: ActionPermissionSchema,
    risk: ActionRiskLevelSchema,
    reversibility: ActionReversibilitySchema,
    target_type: ActionTargetTypeSchema,
    requires_approval: z.literal(true),
    audited: z.literal(true),
    input_schema: JsonSchemaObject,
  })
  .strict();
export type AgentManifestAction = z.infer<typeof AgentManifestActionSchema>;

export const AgentManifestSchema = z
  .object({
    contract_version: z.literal(AGENT_CONTRACT_VERSION),
    agent: z
      .object({ id: z.string().uuid(), name: z.string(), trust_level: AgentTrustLevelSchema })
      .strict(),
    budgets: z
      .object({
        calls_per_correlation: z.literal(READ_TOOL_MAX_CALLS_PER_REQUEST),
        chars_per_correlation: z.literal(READ_TOOL_MAX_CHARS_PER_REQUEST),
        calls_per_minute: z.literal(AGENT_TOOL_CALLS_PER_MINUTE),
      })
      .strict(),
    /** Inputs are re-validated by the server through the Zod schema; the JSON Schema is descriptive. */
    validation: z.literal("server-side"),
    tools: z.array(AgentManifestToolSchema),
    actions: z.array(AgentManifestActionSchema),
    grants: z.array(AgentPermissionGrantItemSchema),
  })
  .strict();
export type AgentManifest = z.infer<typeof AgentManifestSchema>;
