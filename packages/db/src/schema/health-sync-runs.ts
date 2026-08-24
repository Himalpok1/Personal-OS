import { sql } from "drizzle-orm";
import { check, date, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { healthConnections } from "./health-connections.js";
import { healthMetricStreams } from "./health-metric-streams.js";

// One row per sync attempt (ADR-046, migration 0013). This is where "we
// checked" is recorded, together with health_metric_streams.last_successful_sync_at
// -- deliberately NOT on the data rows themselves, so two identical consecutive
// syncs produce zero writes to health_daily_metrics / health_sessions /
// health_observations. A run row IS written every time, including for a no-op
// run; "zero writes" refers to health DATA rows only.
//
// failure_class carries NO check constraint (ADR-050): this vocabulary will
// grow, and widening a CHECK would need a DROP CONSTRAINT.
//
// This is operational metadata, not health data, so pruning it (90 days) is not
// a data-loss policy and does not conflict with ADR-047's no-auto-delete rule.
export const healthSyncRuns = pgTable(
  "health_sync_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => healthConnections.id, { onDelete: "cascade" }),
    streamId: uuid("stream_id").references(() => healthMetricStreams.id, {
      onDelete: "set null",
    }),
    metric: text("metric").notNull(),
    kind: text("kind").notNull(),
    rangeStartDate: date("range_start_date").notNull(),
    rangeEndDate: date("range_end_date").notNull(),
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
    // Records that two fetched records hashed to the same external_key and were
    // therefore indistinguishable in every field the API exposes. A persistently
    // non-zero value means the key is under-specified for this account's data --
    // a signal to report at 6.2P, not an error to swallow.
    rowsCollapsed: integer("rows_collapsed").notNull().default(0),
    expectedBucketCount: integer("expected_bucket_count"),
    receivedBucketCount: integer("received_bucket_count"),
    sourceFamily: text("source_family"),
    errorMessage: text("error_message"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [
    check("health_sync_runs_kind", sql`${table.kind} in ('hot','warm','backfill','manual')`),
    check(
      "health_sync_runs_status",
      sql`${table.status} in ('succeeded','failed','skipped','cancelled')`,
    ),
    index("health_sync_runs_metric_started_at_idx").on(table.metric, table.startedAt),
  ],
);
