import { errorToken } from "@personal-os/core/logging/logger";
import { actionRequests, permissionGrants, type Db } from "@personal-os/db";
import {
  ACTION_INPUT_SCHEMAS,
  ACTION_PERMISSION_DISCLOSURE_VERSION,
  ACTION_REGISTRY,
  ACTION_REQUEST_TTL_HOURS,
  ACTION_SUMMARY_MAX_CHARS,
  ActionPrincipalSchema,
  actionsRequiring,
  isActionPermission,
  reversalActionOf,
  type ActionErrorClass,
  type ActionId,
  type ActionPermission,
  type ActionPrincipal,
  type ActionRequestCreate,
  type ActionRequestItem,
  type AgentPermission,
  type AgentPermissionUpdateResponse,
  type PermissionUpdateResponse,
} from "@personal-os/schema";
import { and, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  getActionRequestItem,
  getAgentPermissionGrantItem,
  isPermissionGranted,
  listPermissionGrants,
  type ActionReader,
} from "../read-models/actions.js";
import { ACTION_HANDLERS } from "./handlers.js";
import {
  ActionExecutionError,
  ActionValidationError,
  type ActionHandler,
  type ActionValidationIssue,
} from "./types.js";

// The Action Framework's WRITE side (Checkpoint 10.8, ADR-078 §3–§5).
//
//   POST /actions          -> createActionRequest   (grant check, prepare, pending row)
//   POST /actions/:id/approve -> approveActionRequest (claim, execute in ONE tx, terminal row)
//   POST /actions/:id/cancel  -> cancelActionRequest
//   PATCH /permissions/:p  -> setPermissionGrant     (revoke cancels pending, same tx)
//
// Everything here is owner-initiated and request-scoped. There is no queue,
// no timer and no retry: an approval is a tap, an action is a millisecond
// write, and a failure is RECORDED on the row (status `failed`, a token-shaped
// `error_class`) rather than retried. The single-use claim -- one conditional
// UPDATE on `status = 'pending' AND expires_at > now` -- is what makes a
// replayed approval a no-op. Guard 7 keeps this file free of every AI import
// and every enqueue token; the one thing that may leave the process (a linked
// calendar push) runs through a handler's `afterCommit`, after the
// transaction has committed, exactly as routes/events.ts does it.
//
// Log lines carry ids, action ids and error classes only -- never a title,
// a summary or the input.
//
// Checkpoint 10.9 (ADR-081 §6) generalises three entry points over the
// PRINCIPAL without a new import: `createActionRequest` takes an optional
// agent attribution (the gateway is the only caller that passes one; the
// owner route never can), `cancelActionRequest` takes an optional agent
// scope so an agent can cancel only its own pending row, and
// `setPermissionGrant` takes the principal so the owner can grant or revoke
// the `agent` principal's read and write permissions. `runHandler` re-checks
// the grant under the ROW'S principal, so an agent proposal whose agent
// grant was revoked after the fact fails at approval even while the app
// grant is live. Nothing here approves on an agent's behalf.

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type ActionRequestRow = typeof actionRequests.$inferSelect;

export class ActionPermissionDeniedError extends Error {
  readonly permission: ActionPermission;

  constructor(permission: ActionPermission) {
    super("permission not granted");
    this.name = "ActionPermissionDeniedError";
    this.permission = permission;
  }
}

export class ActionRequestNotFoundError extends Error {
  constructor() {
    super("action request not found");
    this.name = "ActionRequestNotFoundError";
  }
}

/** The row exists but is not (or no longer) pending; `status` is what it is now. */
export class ActionRequestNotPendingError extends Error {
  readonly status: ActionRequestRow["status"];

  constructor(status: ActionRequestRow["status"]) {
    super("action request is not pending");
    this.name = "ActionRequestNotPendingError";
    this.status = status;
  }
}

function handlerFor<Id extends ActionId>(id: Id): ActionHandler<Id> {
  return ACTION_HANDLERS[id];
}

function boundSummary(text: string): string {
  return text.length <= ACTION_SUMMARY_MAX_CHARS
    ? text
    : `${text.slice(0, ACTION_SUMMARY_MAX_CHARS - 1)}…`;
}

/** C0/C1 controls and line breaks never reach a stored reason (ADR-065's rule for client text). */
function stripControls(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/[\u0000-\u001f\u007f-\u009f]+/g, " ").trim();
}

function pgErrorField(err: unknown, field: string): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const value = (err as Record<string, unknown>)[field];
  if (typeof value === "string") return value;
  const cause = (err as { cause?: unknown }).cause;
  if (cause && typeof cause === "object") {
    const causeValue = (cause as Record<string, unknown>)[field];
    if (typeof causeValue === "string") return causeValue;
  }
  return undefined;
}

function isClientUuidConflict(err: unknown): boolean {
  return (
    pgErrorField(err, "code") === "23505" &&
    pgErrorField(err, "constraint") === "action_requests_client_uuid_idx"
  );
}

async function requireItem(db: ActionReader, id: string, now: Date): Promise<ActionRequestItem> {
  const item = await getActionRequestItem(db, id, now);
  if (!item) throw new Error("action_requests row vanished between write and read-back");
  return item;
}

/**
 * The target a reversal must point at: the same row the original request
 * created or touched. Every 10.8 target input is `{ task_id }` or `{ event_id }`.
 */
function targetIdOfInput(input: unknown): string | null {
  if (!input || typeof input !== "object") return null;
  const record = input as Record<string, unknown>;
  const value = record["task_id"] ?? record["event_id"];
  return typeof value === "string" ? value : null;
}

/**
 * A reversal request must undo a COMPLETED request whose registry entry names
 * this action as its reversal, on the same target. Returns the validation
 * issue to surface, or null when the reference is sound.
 */
async function reversalIssue(
  db: ActionReader,
  body: ActionRequestCreate,
): Promise<ActionValidationIssue | null> {
  if (!body.reverses_request_id) return null;
  const [original] = await db
    .select()
    .from(actionRequests)
    .where(eq(actionRequests.id, body.reverses_request_id));
  const issue = (message: string): ActionValidationIssue => ({
    code: "custom",
    path: ["reverses_request_id"],
    message,
  });
  if (!original) return issue("reverses_request_id does not reference an existing request");
  if (original.status !== "completed") return issue("only a completed request can be undone");
  if (reversalActionOf(original.actionId as ActionId) !== body.action_id) {
    return issue("this action does not undo the referenced request");
  }
  if (!original.targetId || targetIdOfInput(body.input) !== original.targetId) {
    return issue("the undo must target the row the referenced request touched");
  }
  return null;
}

export interface CreateActionRequestResult {
  item: ActionRequestItem;
  /** False when a repeated client_uuid returned the existing row. */
  created: boolean;
}

/**
 * The `agent` principal's attribution, supplied ONLY by the Agent Gateway
 * (routes/agent.ts) for an authenticated agent. `principal` is a literal so
 * no caller can attribute a request to `app` through this parameter, and the
 * owner route (`POST /actions`) never passes one at all.
 */
export interface AgentAttribution {
  principal: "agent";
  agentId: string;
  correlationId: string;
}

/**
 * Throws `ActionPermissionDeniedError` (403), `ActionValidationError` (400)
 * or returns the pending row. `principal` is `app` unless the gateway passes
 * an agent attribution -- the owner route never lets a client choose it.
 * With an attribution the row is written `source: "agent"` and
 * `source_ref: <agent id>` (the projection of `agent_id` onto the wire shape
 * the deployed client already parses), whatever the body says.
 */
export async function createActionRequest(
  app: FastifyInstance,
  body: ActionRequestCreate,
  now: Date,
  attribution?: AgentAttribution,
): Promise<CreateActionRequestResult> {
  const definition = ACTION_REGISTRY[body.action_id];
  const principal: ActionPrincipal = attribution?.principal ?? "app";
  if (!(await isPermissionGranted(app.db, principal, definition.permission))) {
    throw new ActionPermissionDeniedError(definition.permission);
  }

  const broken = await reversalIssue(app.db, body);
  if (broken) throw new ActionValidationError(broken);

  // Read-only: existence checks and the bounded summary the owner approves.
  const preparation = await handlerFor(body.action_id).prepare(app.db, body.input, now);

  const expiresAt = new Date(now.getTime() + ACTION_REQUEST_TTL_HOURS * 60 * 60 * 1000);
  try {
    const [row] = await app.db
      .insert(actionRequests)
      .values({
        clientUuid: body.client_uuid ?? null,
        actionId: body.action_id,
        principal,
        status: "pending",
        source: attribution ? "agent" : body.source,
        sourceRef: attribution ? attribution.agentId : (body.source_ref ?? null),
        reason: body.reason ? stripControls(body.reason) || null : null,
        input: body.input,
        inputSummary: boundSummary(preparation.inputSummary),
        targetType: preparation.target?.type ?? null,
        targetId: preparation.target?.id ?? null,
        reversesRequestId: body.reverses_request_id ?? null,
        agentId: attribution?.agentId ?? null,
        correlationId: attribution?.correlationId ?? null,
        requestedAt: now,
        expiresAt,
        createdAt: now,
        updatedAt: now,
      })
      .returning({ id: actionRequests.id });
    if (!row) throw new Error("insert into action_requests returned no row");
    app.log.info(
      {
        requestId: row.id,
        actionId: body.action_id,
        source: attribution ? "agent" : body.source,
        principal,
        agentId: attribution?.agentId,
        correlationId: attribution?.correlationId,
      },
      "action.requested",
    );
    return { item: await requireItem(app.db, row.id, now), created: true };
  } catch (err: unknown) {
    if (body.client_uuid && isClientUuidConflict(err)) {
      const [existing] = await app.db
        .select({ id: actionRequests.id })
        .from(actionRequests)
        .where(eq(actionRequests.clientUuid, body.client_uuid));
      if (!existing) {
        throw new Error("client_uuid conflicted on insert but no existing request was found", {
          cause: err,
        });
      }
      return { item: await requireItem(app.db, existing.id, now), created: false };
    }
    throw err;
  }
}

/** An agent may touch only its own rows: a foreign id reads as absent (404), never as forbidden. */
export interface AgentScope {
  agentId: string;
}

/**
 * Called only when the claim found nothing to claim. Flips a stale pending
 * row to `expired` and RETURNS the status to report -- it must not throw,
 * because a throw would roll back that very flip with the transaction.
 * `null` means the row does not exist -- or, under an agent scope, is not
 * that agent's row.
 */
async function resolveUnclaimable(
  tx: Tx,
  id: string,
  now: Date,
  scope?: AgentScope,
): Promise<ActionRequestRow["status"] | null> {
  const [row] = await tx.select().from(actionRequests).where(eq(actionRequests.id, id));
  if (!row) return null;
  if (scope && row.agentId !== scope.agentId) return null;
  if (row.status === "pending") {
    // The claim failed only because expires_at has passed: record it.
    const flipped = await tx
      .update(actionRequests)
      .set({ status: "expired", finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(actionRequests.id, id),
          eq(actionRequests.status, "pending"),
          lte(actionRequests.expiresAt, now),
        ),
      )
      .returning({ id: actionRequests.id });
    return flipped.length > 0 ? "expired" : "pending";
  }
  return row.status;
}

function throwUnclaimable(status: ActionRequestRow["status"] | null): never {
  if (status === null) throw new ActionRequestNotFoundError();
  throw new ActionRequestNotPendingError(status);
}

interface ExecutionOutcome {
  status: "completed" | "failed";
  errorClass: ActionErrorClass | null;
  resultSummary: string | null;
  target: { type: "task" | "event"; id: string } | null;
  afterCommit?: (app: FastifyInstance) => Promise<void>;
}

async function runHandler(
  app: FastifyInstance,
  tx: Tx,
  row: ActionRequestRow,
  now: Date,
): Promise<ExecutionOutcome> {
  const actionId = row.actionId as ActionId;
  const definition = ACTION_REGISTRY[actionId];

  // The grant is re-checked inside the transaction UNDER THE ROW'S OWN
  // PRINCIPAL: a revoke that landed after the request was made (around the
  // route, which cancels pending rows) is refused here, and an agent
  // proposal is checked against the agent grant, never the app's. A revoke
  // racing this very approval is a plain SELECT under READ COMMITTED, so the
  // two owner taps serialise on the row lock in whichever order they arrive
  // -- approve-then-revoke completes the action and revokes afterwards;
  // revoke-then-approve fails it here. Either outcome is linearizable;
  // neither escalates.
  const principal = ActionPrincipalSchema.parse(row.principal);
  if (!(await isPermissionGranted(tx, principal, definition.permission))) {
    return {
      status: "failed",
      errorClass: "permission_revoked",
      resultSummary: null,
      target: null,
    };
  }

  // The STORED input is what runs -- re-parsed through the action's own
  // schema, never re-derived from live state or from the request body.
  const parsed = ACTION_INPUT_SCHEMAS[actionId].safeParse(row.input);
  if (!parsed.success) {
    return { status: "failed", errorClass: "input_invalid", resultSummary: null, target: null };
  }

  try {
    // A SAVEPOINT (the tasks.ts reopen idiom): a handler that throws after a
    // partial write must leave nothing behind, while the outer transaction
    // still records the failure on the request row.
    const result = await tx.transaction(async (savepoint) =>
      handlerFor(actionId).execute({ tx: savepoint, now, requestId: row.id }, parsed.data),
    );
    return {
      status: "completed",
      errorClass: null,
      resultSummary: boundSummary(result.resultSummary),
      target: result.target,
      afterCommit: result.afterCommit,
    };
  } catch (err: unknown) {
    if (err instanceof ActionExecutionError) {
      return { status: "failed", errorClass: err.errorClass, resultSummary: null, target: null };
    }
    // Unexpected: still RECORD the failure (the audit row is the evidence),
    // with a token in the log and nothing from the input.
    app.log.error(
      { requestId: row.id, actionId, error: errorToken(err) },
      "action.execute: unexpected failure",
    );
    return { status: "failed", errorClass: "execution_failed", resultSummary: null, target: null };
  }
}

/**
 * The owner's approval. Claims the row, executes inside the same transaction
 * and returns the terminal item (`completed` or `failed`). Throws
 * `ActionRequestNotFoundError` (404) or `ActionRequestNotPendingError` (409).
 */
export async function approveActionRequest(
  app: FastifyInstance,
  id: string,
  now: Date,
): Promise<ActionRequestItem> {
  const outcome = await app.db.transaction<
    ExecutionOutcome | { unclaimable: ActionRequestRow["status"] | null }
  >(async (tx) => {
    const [claimed] = await tx
      .update(actionRequests)
      .set({ status: "executing", approvedAt: now, updatedAt: now })
      .where(
        and(
          eq(actionRequests.id, id),
          eq(actionRequests.status, "pending"),
          gt(actionRequests.expiresAt, now),
        ),
      )
      .returning();
    if (!claimed) return { unclaimable: await resolveUnclaimable(tx, id, now) };

    const result = await runHandler(app, tx, claimed, now);
    await tx
      .update(actionRequests)
      .set({
        status: result.status,
        errorClass: result.errorClass,
        resultSummary: result.resultSummary,
        // A create learns its target only now; a target action already carries it.
        targetType: result.target?.type ?? claimed.targetType,
        targetId: result.target?.id ?? claimed.targetId,
        finishedAt: now,
        updatedAt: now,
      })
      .where(and(eq(actionRequests.id, id), eq(actionRequests.status, "executing")));
    return result;
  });
  if ("unclaimable" in outcome) throwUnclaimable(outcome.unclaimable);

  app.log.info(
    { requestId: id, status: outcome.status, errorClass: outcome.errorClass ?? undefined },
    outcome.status === "completed" ? "action.completed" : "action.failed",
  );

  if (outcome.afterCommit) {
    try {
      await outcome.afterCommit(app);
    } catch (err: unknown) {
      app.log.warn({ requestId: id, error: errorToken(err) }, "action.after_commit: failed");
    }
  }

  return requireItem(app.db, id, now);
}

/**
 * The owner's cancel -- or, with an agent `scope`, an agent's cancel of ITS
 * OWN pending row: the scope joins the conditional UPDATE's predicate, so a
 * foreign id cancels nothing and reads back as not found.
 */
export async function cancelActionRequest(
  app: FastifyInstance,
  id: string,
  now: Date,
  scope?: AgentScope,
): Promise<ActionRequestItem> {
  const unclaimable = await app.db.transaction(async (tx) => {
    const [cancelled] = await tx
      .update(actionRequests)
      .set({ status: "cancelled", finishedAt: now, updatedAt: now })
      .where(
        and(
          eq(actionRequests.id, id),
          eq(actionRequests.status, "pending"),
          gt(actionRequests.expiresAt, now),
          scope ? eq(actionRequests.agentId, scope.agentId) : undefined,
        ),
      )
      .returning({ id: actionRequests.id });
    if (!cancelled) return resolveUnclaimable(tx, id, now, scope);
    return undefined;
  });
  if (unclaimable !== undefined) throwUnclaimable(unclaimable);
  app.log.info({ requestId: id, agentId: scope?.agentId }, "action.cancelled");
  return requireItem(app.db, id, now);
}

/**
 * PATCH /permissions/:permission for the `app` principal, and (Checkpoint
 * 10.9) PATCH /permissions/agent/:permission for the `agent` principal.
 * Materialises the row lazily (ADR-078 §3): granting when no live row exists
 * inserts one; revoking sets `revoked_at` on the live row -- or, when no row
 * was ever written (the default grant), inserts a row already revoked, so
 * the history says "granted by default, revoked at T". A revoke of a WRITE
 * permission cancels every pending request OF THAT PRINCIPAL that needs it,
 * in the same transaction; a read permission has no pending rows to cancel
 * (no action needs one), and the loop is skipped rather than run vacuously.
 *
 * The `app` overload returns the 10.8 `PermissionUpdateResponse` byte-for-
 * byte; the `agent` overload returns the agent grant item, which has its own
 * wire shape (a read permission cannot ride on the deployed client's strict
 * `PermissionGrantItemSchema`).
 */
export async function setPermissionGrant(
  app: FastifyInstance,
  permission: ActionPermission,
  granted: boolean,
  now: Date,
  principal?: "app",
): Promise<PermissionUpdateResponse>;
export async function setPermissionGrant(
  app: FastifyInstance,
  permission: AgentPermission,
  granted: boolean,
  now: Date,
  principal: "agent",
): Promise<AgentPermissionUpdateResponse>;
export async function setPermissionGrant(
  app: FastifyInstance,
  permission: AgentPermission,
  granted: boolean,
  now: Date,
  principal: ActionPrincipal = "app",
): Promise<PermissionUpdateResponse | AgentPermissionUpdateResponse> {
  if (principal === "app" && !isActionPermission(permission)) {
    // Unreachable through the routes (the app param schema is the two-member
    // ActionPermissionSchema); a programming error, never user input.
    throw new RangeError("the app principal has no read permissions");
  }
  const cancelledPending = await app.db.transaction(async (tx) => {
    const live = await isPermissionGranted(tx, principal, permission);
    if (granted) {
      if (!live) {
        await tx.insert(permissionGrants).values({
          principal,
          permission,
          disclosureVersion: ACTION_PERMISSION_DISCLOSURE_VERSION,
          grantedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
      return 0;
    }

    if (live) {
      const revoked = await tx
        .update(permissionGrants)
        .set({ revokedAt: now, updatedAt: now })
        .where(
          and(
            eq(permissionGrants.principal, principal),
            eq(permissionGrants.permission, permission),
            isNull(permissionGrants.revokedAt),
          ),
        )
        .returning({ id: permissionGrants.id });
      if (revoked.length === 0) {
        await tx.insert(permissionGrants).values({
          principal,
          permission,
          disclosureVersion: ACTION_PERMISSION_DISCLOSURE_VERSION,
          grantedAt: now,
          revokedAt: now,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    // A read permission gates tool calls, not requests: nothing pending
    // needs it, so there is nothing to cancel. Explicit rather than relying
    // on `actionsRequiring` being empty for it.
    if (!isActionPermission(permission)) return 0;

    const cancelled = await tx
      .update(actionRequests)
      .set({
        status: "cancelled",
        resultSummary: "Cancelled: permission revoked",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(actionRequests.status, "pending"),
          // Only THIS principal's rows: revoking the agent's tasks.write must
          // leave the owner's own pending task requests untouched, and vice
          // versa (Checkpoint 10.9 -- a cross-principal cancel once two
          // principals exist).
          eq(actionRequests.principal, principal),
          // A stale pending row is already expired in every read; it is not
          // "cancelled because the permission was revoked".
          gt(actionRequests.expiresAt, now),
          inArray(actionRequests.actionId, actionsRequiring(permission)),
        ),
      )
      .returning({ id: actionRequests.id });
    return cancelled.length;
  });

  app.log.info({ permission, principal, granted, cancelledPending }, "permission.updated");
  if (principal === "agent") {
    const item = await getAgentPermissionGrantItem(app.db, permission);
    return { item, cancelled_pending: cancelledPending };
  }
  const permissions = await listPermissionGrants(app.db, "app");
  const item = permissions.items.find((entry) => entry.permission === permission);
  if (!item) throw new Error("permission vanished from the vocabulary between write and read-back");
  return { item, cancelled_pending: cancelledPending };
}
