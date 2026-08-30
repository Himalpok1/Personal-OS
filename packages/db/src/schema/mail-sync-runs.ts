import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { mailConnections } from "./mail-connections.js";
import { mailSyncCursors } from "./mail-sync-cursors.js";

// One row per sync attempt (ADR-053, migration 0014), shaped on
// health_sync_runs -- the inversion that table established is the important
// part and is copied deliberately: "we checked" is recorded HERE and on
// mail_sync_cursors.last_successful_sync_at, NOT on the message rows, so two
// identical consecutive syncs write zero rows to mail_messages. A run row is
// written every time, including for a no-op run; "zero writes" refers to mail
// DATA rows only.
//
// RANGES ARE timestamptz, NOT date. health_sync_runs uses date columns because
// the Google Health API supplies civil dates and no physical instants
// (ADR-048). Gmail supplies real instants, so inheriting civil dates here would
// mean inventing precision the provider already gives us. Both bounds are
// nullable because an incremental pass has no range at all -- it has a cursor.
//
// failure_class and error_message carry NO check constraint (ADR-050) and are
// for SANITIZED CLASSIFICATION TOKENS ONLY, never a provider message. The rule
// health/run.ts enforces applies verbatim: Gmail's error prose can echo the
// offending request back, and pg-boss persists whatever a handler throws into
// pgboss.job.output, a durable table. Checkpoint 7.3 owns the writer that
// enforces the token shape; the column exists to receive tokens.
//
// cursor_expired makes ADR-053's first-class cursor-expiry transition visible
// in the audit trail rather than inferrable: it records that this run hit the
// HTTP 404 and escalated to a bounded full resync.
//
// This is operational metadata, not mail content, so a bounded prune of this
// table is permitted (ADR-054) and does not conflict with ADR-047.
export const mailSyncRuns = pgTable(
  "mail_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mailConnections.id, { onDelete: "cascade" }),
    // set null, not cascade: deleting a cursor must not erase the evidence that
    // syncs ran against it. Mirrors health_sync_runs.stream_id exactly.
    cursorId: uuid("cursor_id").references(() => mailSyncCursors.id, { onDelete: "set null" }),
    scopeKey: text("scope_key").notNull(),
    kind: text("kind").notNull(),
    rangeStartAt: timestamp("range_start_at", { withTimezone: true }),
    rangeEndAt: timestamp("range_end_at", { withTimezone: true }),
    status: text("status").notNull(),
    failureClass: text("failure_class"),
    httpStatus: integer("http_status"),
    requestCount: integer("request_count").notNull().default(0),
    pageCount: integer("page_count").notNull().default(0),
    rowsInserted: integer("rows_inserted").notNull().default(0),
    rowsUpdated: integer("rows_updated").notNull().default(0),
    rowsUnchanged: integer("rows_unchanged").notNull().default(0),
    rowsTombstoned: integer("rows_tombstoned").notNull().default(0),
    rowsRejected: integer("rows_rejected").notNull().default(0),
    cursorExpired: boolean("cursor_expired").notNull().default(false),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("mail_sync_runs_kind", sql`${table.kind} in ('incremental','full','backfill','manual')`),
    check(
      "mail_sync_runs_status",
      sql`${table.status} in ('succeeded','failed','skipped','cancelled')`,
    ),
    check(
      "mail_sync_runs_range_order",
      sql`${table.rangeStartAt} is null or ${table.rangeEndAt} is null or ${table.rangeEndAt} >= ${table.rangeStartAt}`,
    ),
    index("mail_sync_runs_connection_started_at_idx").on(table.connectionId, table.startedAt),
  ],
);
