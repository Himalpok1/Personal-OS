import { sql } from "drizzle-orm";
import {
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";

// Checkpoint 10.8 (ADR-078): one row per action request -- and that row IS
// the audit trail. There is no separate append-only log: every audit-shaped
// precedent in this schema (notification_dispatch_log, the *_sync_runs
// tables, memory_suggestions) keeps its lifecycle ON the entity row as a
// CHECKed status plus per-state timestamps, and a transition table would be
// exactly the generic workflow engine the 10.8 brief rejects.
//
// Lifecycle (ADR-078 §4):
//   pending --approve--> executing --> completed | failed
//   pending --cancel---> cancelled
//   pending --(expires_at passes)--> expired
// `executing` is claimed with a single conditional UPDATE (`where status =
// 'pending'` returning the row) inside the approve request's transaction, so
// a replayed approval is a no-op, and execution runs SYNCHRONOUSLY in that
// same request -- never through pg-boss. A terminal row is never edited again
// and never deleted; `retention.cleanup` does not touch this table (a source
// pin holds it there).
//
// What is stored, and what is deliberately not:
//   `input`         the Zod-validated, bounded input FROZEN at request time --
//                   the inbox_items.parse_result precedent -- re-parsed through
//                   the same schema at execution, never re-derived from live
//                   state. It may carry a bounded title; it never carries a
//                   credential, a body over its schema bound, or model text.
//                   Export ships the summary columns, not `input`.
//   `input_summary` / `result_summary`   bounded, server-authored, what the
//                   UI and GET /export show.
//   `reason`        bounded, CLIENT-authored (an owner tap on a Focus Now row),
//                   control-stripped; Guard 7 makes it impossible for an AI
//                   lane to write one.
//   `error_class`   a token, never provider or driver prose (the sync-runs rule).
//   `target_*`      a non-FK pointer to the row the action created or touched,
//                   the inbox_items.entity_type/entity_id precedent -- an audit
//                   pointer, not a relationship (ADR-074/077 still hold).
//   `principal`     WHO requested it. Only `app` (the owner, through a client)
//                   is writable in 10.8; `agent` is reserved. Approval is
//                   always the owner's own tap, so there is no approved_by.
//   `client_uuid`   the events/capture idempotency idiom: a retried POST gets
//                   the existing row back.
export const actionRequests = pgTable(
  "action_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientUuid: uuid("client_uuid"),
    actionId: text("action_id").notNull(),
    principal: text("principal").notNull(),
    status: text("status").notNull().default("pending"),
    source: text("source").notNull(),
    sourceRef: text("source_ref"),
    reason: text("reason"),
    input: jsonb("input").notNull(),
    inputSummary: text("input_summary").notNull(),
    resultSummary: text("result_summary"),
    targetType: text("target_type"),
    targetId: uuid("target_id"),
    errorClass: text("error_class"),
    reversesRequestId: uuid("reverses_request_id").references(
      (): AnyPgColumn => actionRequests.id,
      {
        onDelete: "set null",
      },
    ),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("action_requests_principal", sql`${table.principal} in ('app','agent')`),
    check(
      "action_requests_status",
      sql`${table.status} in ('pending','executing','completed','failed','cancelled','expired')`,
    ),
    check(
      "action_requests_source",
      sql`${table.source} in ('focus_now','briefing','academic','manual')`,
    ),
    check(
      "action_requests_target_type",
      sql`${table.targetType} is null or ${table.targetType} in ('task','event')`,
    ),
    check(
      "action_requests_target_pair",
      sql`(${table.targetType} is null) = (${table.targetId} is null)`,
    ),
    check(
      "action_requests_no_self_reversal",
      sql`${table.reversesRequestId} is null or ${table.reversesRequestId} <> ${table.id}`,
    ),
    uniqueIndex("action_requests_client_uuid_idx")
      .on(table.clientUuid)
      .where(sql`${table.clientUuid} is not null`),
    index("action_requests_status_requested_at_idx").on(table.status, table.requestedAt),
    index("action_requests_action_id_requested_at_idx").on(table.actionId, table.requestedAt),
    index("action_requests_reverses_request_id_idx").on(table.reversesRequestId),
    index("action_requests_target_idx").on(table.targetType, table.targetId),
  ],
);
