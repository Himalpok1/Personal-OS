import type { Db } from "@personal-os/db";
import type {
  ActionErrorClass,
  ActionId,
  ActionInput,
  ActionOutput,
  ActionTargetType,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";

// The execution layer's interface (Checkpoint 10.8, ADR-078 §4).
//
//   client  --POST /actions-->  prepare()  -->  a PENDING row (the audit row)
//   owner   --approve------->  claim row  -->  execute() inside ONE transaction
//                                          -->  completed | failed, afterCommit()
//
// One handler per registered action, bound in ./executors.ts as a map whose
// completeness is checked at the type level (`ActionHandlerMap`) and by a
// test. A handler is the ONLY way an action mutates anything: it calls the
// same service functions the direct routes call (services/events.ts,
// services/tasks.ts), so an approved action and an owner's direct tap take
// the identical code path -- the framework adds a permission gate, an
// approval and an audit row, never a second implementation of a write.
//
// Rules every handler obeys:
//   - `prepare` runs at REQUEST time, outside any transaction, and may only
//     read: it checks the input's targets exist (a missing target is a 400
//     validation issue, the memories.ts link pre-check idiom) and composes
//     the bounded `inputSummary` the owner will approve. It never writes.
//   - `execute` runs at APPROVAL time INSIDE the approve request's
//     transaction, with the STORED input re-parsed through the action's own
//     schema. It re-checks its target under the lock (the row may have
//     changed since `prepare` -- the TOCTOU window is closed here, not
//     there) and throws `ActionExecutionError` with a token-shaped class
//     when the action cannot proceed. The transaction then records `failed`.
//   - Nothing that leaves the process runs inside the transaction. A handler
//     that must enqueue (the calendar push after a linked event write)
//     returns `afterCommit`, which the service calls only once the
//     transaction has committed -- the routes/events.ts rule, kept.
//   - No handler imports `ai`, a provider package, a memory module or an AI
//     lane (Guard 7), and no handler touches permission_grants, ai_*,
//     devices or any *_connections table: those are not actions.

export type ActionTx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export interface ActionTarget {
  type: ActionTargetType;
  id: string;
}

/** The 400 `validation_failed` issue shape the tasks/memories routes already use. */
export interface ActionValidationIssue {
  code: "custom";
  path: string[];
  message: string;
}

/**
 * Thrown by `prepare` when the request cannot be accepted -- an unknown
 * target id, an external (read-only) event, a recurring task on a one-off
 * action. Surfaces as `400 validation_failed` with `issues: [issue]`; the
 * message is static, never a title or provider prose.
 */
export class ActionValidationError extends Error {
  readonly issue: ActionValidationIssue;

  constructor(issue: ActionValidationIssue) {
    super(issue.message);
    this.name = "ActionValidationError";
    this.issue = issue;
  }
}

/**
 * Thrown by `execute` when the action cannot proceed at approval time. The
 * approve service records `status = 'failed'` and `error_class` -- a token
 * from `ACTION_ERROR_CLASSES`, never a message -- and the approve route
 * answers 200 with the failed row. `message` exists for the log line only
 * and must be static.
 */
export class ActionExecutionError extends Error {
  readonly errorClass: ActionErrorClass;

  constructor(errorClass: ActionErrorClass, message: string) {
    super(message);
    this.name = "ActionExecutionError";
    this.errorClass = errorClass;
  }
}

export interface ActionPreparation {
  /** Bounded (ACTION_SUMMARY_MAX_CHARS), server-authored, what the owner approves. */
  inputSummary: string;
  /** The existing row the action will touch; null for a create. */
  target: ActionTarget | null;
}

export interface ActionExecutionContext {
  tx: ActionTx;
  /** One instant per approval, shared by every write the execution makes. */
  now: Date;
  /** The action_requests row being executed (for logs and idempotency only). */
  requestId: string;
}

export interface ActionExecutionResult<Id extends ActionId> {
  output: ActionOutput<Id>;
  /** The row created or touched -- becomes target_type/target_id on the audit row. */
  target: ActionTarget;
  /** Bounded (ACTION_SUMMARY_MAX_CHARS), server-authored, what the owner sees in History. */
  resultSummary: string;
  /** Runs after the owning transaction has COMMITTED. Never inside it. */
  afterCommit?: (app: FastifyInstance) => Promise<void>;
}

export interface ActionHandler<Id extends ActionId> {
  prepare(db: Db, input: ActionInput<Id>, now: Date): Promise<ActionPreparation>;
  execute(ctx: ActionExecutionContext, input: ActionInput<Id>): Promise<ActionExecutionResult<Id>>;
}

/** Completeness at the type level: a new ACTION_ID without a handler does not compile. */
export type ActionHandlerMap = { readonly [K in ActionId]: ActionHandler<K> };
