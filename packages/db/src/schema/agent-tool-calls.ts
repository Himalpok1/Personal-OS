import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { agents } from "./agents.js";

// Checkpoint 10.9 (ADR-081): the READ side of the agent audit trail. Every
// call an agent makes to a read tool -- completed, refused or failed -- is
// one row here. The write side needs no new table: an agent's proposal is an
// action_requests row (principal 'agent', agent_id set), ADR-078's audit row.
//
// What is stored, and what is deliberately not:
//   `tool_name`       CHECKed against the six READ_TOOL_NAMES (project-
//                     controlled and closed, ADR-050); a seventh tool is a
//                     migration, on purpose.
//   `status`          completed | refused | failed. A refusal (trust,
//                     permission, budget, rate) is audited exactly like a
//                     success -- the owner's activity screen shows what the
//                     agent TRIED, not only what it got.
//   `error_class`     a token, never prose; paired with status by CHECK.
//   `chars_returned`  the serialized output's length -- what the per-
//                     correlation char budget is counted from.
//   `correlation_id`  agent-supplied, the unit every budget is counted
//                     against and the key the activity screen groups on:
//                     "Read: Today · Calendar → Proposed: … → Approved".
//   NO input, NO output, NO prompt: the row records THAT a read happened and
//   how much left, never what. The stored payload of a proposal lives on the
//   action_requests row, bounded by the action's own schema.
//
// Retention: 30 days through retention.cleanup, the *_sync_runs class -- the
// only worker file allowed to name this table (Guard 8). `agents` itself and
// `action_requests` are never swept.
export const agentToolCalls = pgTable(
  "agent_tool_calls",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agentId: uuid("agent_id")
      .notNull()
      .references(() => agents.id),
    correlationId: uuid("correlation_id").notNull(),
    toolName: text("tool_name").notNull(),
    status: text("status").notNull(),
    errorClass: text("error_class"),
    charsReturned: integer("chars_returned").notNull().default(0),
    durationMs: integer("duration_ms"),
    calledAt: timestamp("called_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "agent_tool_calls_tool_name",
      sql`${table.toolName} in ('search_personal_items','get_item_context','get_today_context','get_calendar_context','get_task_context','get_academic_context')`,
    ),
    check("agent_tool_calls_status", sql`${table.status} in ('completed','refused','failed')`),
    check(
      "agent_tool_calls_error_pair",
      sql`(${table.status} = 'completed') = (${table.errorClass} is null)`,
    ),
    check("agent_tool_calls_chars_nonneg", sql`${table.charsReturned} >= 0`),
    index("agent_tool_calls_agent_id_called_at_idx").on(table.agentId, table.calledAt),
    index("agent_tool_calls_correlation_id_idx").on(table.correlationId),
  ],
);
