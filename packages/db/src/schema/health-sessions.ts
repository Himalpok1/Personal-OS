import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { healthConnections } from "./health-connections.js";

// Sleep and exercise sessions (ADR-047, ADR-049, migration 0013).
//
// Unlike daily rollups, SessionTimeInterval genuinely provides both physical
// instants and UTC offsets, so both are stored. duration_seconds is ALWAYS
// derived from the physical instants: civil-clock subtraction is wrong across a
// DST transition, understating elapsed time by an hour on fall-back and
// overstating it by an hour on spring-forward.
//
// attributed_local_date follows ADR-049: a sleep session is attributed to its
// civil END (wake) date, an exercise to its civil START date. For sleep this is
// also the QUERY axis -- `list` documents sleep.interval.civil_end_time as a
// sleep-exclusive filter and explicitly excludes sleep from the generic
// session-start filter -- so attribution, fetch and deletion-reconciliation all
// share one axis. Hence the index on (metric, civil_end_local): the sleep
// tombstone sweep must be scoped on the same axis its filter used, not on the
// attribution column.
//
// provider_created_at/provider_updated_at mirror Sleep's and Exercise's own
// createTime/updateTime. They are recorded for cross-checking only -- we never
// depend on them for change detection, because they are not filterable
// server-side. Content hashing is the mechanism.
export const healthSessions = pgTable(
  "health_sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => healthConnections.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    externalKey: text("external_key").notNull(),
    externalKeySource: text("external_key_source").notNull(),
    dataPointName: text("data_point_name"),
    attributedLocalDate: date("attributed_local_date").notNull(),
    civilStartLocal: timestamp("civil_start_local").notNull(),
    civilEndLocal: timestamp("civil_end_local").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }).notNull(),
    endAt: timestamp("end_at", { withTimezone: true }).notNull(),
    startUtcOffsetSeconds: integer("start_utc_offset_seconds").notNull(),
    endUtcOffsetSeconds: integer("end_utc_offset_seconds").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    detail: jsonb("detail").notNull(),
    providerCreatedAt: timestamp("provider_created_at", { withTimezone: true }),
    providerUpdatedAt: timestamp("provider_updated_at", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "health_sessions_external_key_source",
      sql`${table.externalKeySource} in ('data_point_name','reconcile_derived','list_derived')`,
    ),
    check(
      "health_sessions_time_invariants",
      sql`${table.endAt} >= ${table.startAt} and ${table.durationSeconds} >= 0`,
    ),
    uniqueIndex("health_sessions_connection_metric_external_key_unique").on(
      table.connectionId,
      table.metric,
      table.externalKey,
    ),
    index("health_sessions_metric_attributed_local_date_idx").on(
      table.metric,
      table.attributedLocalDate,
    ),
    index("health_sessions_metric_civil_end_idx").on(table.metric, table.civilEndLocal),
    index("health_sessions_metric_civil_start_idx").on(table.metric, table.civilStartLocal),
  ],
);
