import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { healthConnections } from "./health-connections.js";

// One row per (connection, metric, civil date) -- the Health read model
// (ADR-047, migration 0013).
//
// local_date is taken VERBATIM from the API's DailyRollupDataPoint
// civilStartTime.date (ADR-048). We never convert an instant to a date, so no
// IANA timezone is stored anywhere and DST/travel are correct by construction.
//
// Deliberately ABSENT: window_start_at, window_end_at, utc_offset_seconds.
// dailyRollUp documents civilStartTime/civilEndTime and supplies NO physical
// instants and NO offsets, so those columns could only ever have held invented
// values. The consequence, accepted in ADR-048: duration-normalized daily rates
// ("steps per hour") are not derivable and are not offered.
//
// Also deliberately absent: any per-row "we checked this" timestamp. Two
// identical consecutive syncs must produce ZERO writes here; verification is
// recorded once per stream (last_successful_sync_at) and once per run
// (health_sync_runs), which is where operational metadata belongs.
//
// numeric, not double precision: exact for int64 counts/millimeters/bpm AND for
// decimal kcal/percentage. Drizzle maps it to a JS string -- coerce at the
// presentation boundary, never in SQL.
export const healthDailyMetrics = pgTable(
  "health_daily_metrics",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => healthConnections.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    localDate: date("local_date").notNull(),
    hasData: boolean("has_data").notNull().default(false),
    value: numeric("value"),
    breakdown: jsonb("breakdown"),
    sourceCount: integer("source_count"),
    sourceFamily: text("source_family"),
    contentHash: text("content_hash").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Makes "genuine recorded zero" and "verified absent" structurally
    // impossible to collapse (ADR-047). A true zero is has_data=true, value=0;
    // verified absent is has_data=false with both value and breakdown null;
    // never-verified is the absence of a row entirely.
    check(
      "health_daily_metrics_has_data_invariants",
      sql`(${table.hasData} and (${table.value} is not null or ${table.breakdown} is not null)) or (not ${table.hasData} and ${table.value} is null and ${table.breakdown} is null)`,
    ),
    uniqueIndex("health_daily_metrics_connection_metric_local_date_unique").on(
      table.connectionId,
      table.metric,
      table.localDate,
    ),
    index("health_daily_metrics_local_date_idx").on(table.localDate),
  ],
);
