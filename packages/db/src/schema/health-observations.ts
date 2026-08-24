import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { healthConnections } from "./health-connections.js";

// Intraday samples. In Phase 6A this holds `heart-rate` ONLY (ADR-047) -- every
// other metric is stored as a daily aggregate or a session, which keeps one
// intraday code path rather than eighteen.
//
// IDENTITY (plan Appendix A1): Google documents NO guaranteed stable source
// identifier. DataPoint.name is "only supported for the subset of identifiable
// data types" and may be empty; DataSource carries only recordingMethod /
// device.formFactor / application.platform (coarse descriptors, not an id); and
// ReconciledDataPoint carries no dataSource at all. So external_key is a
// versioned deterministic hash over every identity-bearing field the response
// actually returns, and external_key_source records which strategy produced it
// so the choice can change after the 6.2P probe with no schema migration.
//
// DISAPPEARANCE: until the 6.2P stability gate proves identity is stable across
// repeated complete-window fetches, rows here are NEVER tombstoned, soft-deleted
// or hard-deleted on any pass. `reconcile` recomputes off-wrist filtering
// server-side per call, so an omission is evidence of upstream recomputation,
// not of deletion. deleted_at exists for that future, gated behaviour only.
//
// RETENTION: none. No health data is ever automatically deleted or expired
// (ADR-047).
export const healthObservations = pgTable(
  "health_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => healthConnections.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    externalKey: text("external_key").notNull(),
    externalKeySource: text("external_key_source").notNull(),
    dataPointName: text("data_point_name"),
    observedAtUtc: timestamp("observed_at_utc", { withTimezone: true }).notNull(),
    civilLocal: timestamp("civil_local").notNull(),
    localDate: date("local_date").notNull(),
    utcOffsetSeconds: integer("utc_offset_seconds").notNull(),
    value: numeric("value").notNull(),
    sourceFamily: text("source_family"),
    sourceRef: text("source_ref"),
    contentHash: text("content_hash").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "health_observations_external_key_source",
      sql`${table.externalKeySource} in ('data_point_name','reconcile_derived','list_derived')`,
    ),
    uniqueIndex("health_observations_connection_metric_external_key_unique").on(
      table.connectionId,
      table.metric,
      table.externalKey,
    ),
    index("health_observations_metric_local_date_idx").on(table.metric, table.localDate),
    index("health_observations_metric_observed_at_idx").on(table.metric, table.observedAtUtc),
  ],
);
