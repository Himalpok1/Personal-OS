import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { healthConnections } from "./health-connections.js";

// Per-metric mutable sync state (ADR-046, migration 0013).
//
// This table holds ONLY state that changes per user. All capability metadata --
// kebab URL segment, snake filter path, record type, which API method, whether
// dataSourceFamily applies, max range days, page size, true-zero flag, required
// scope, canonical unit -- lives in code, in packages/health-providers'
// google-health-catalog.ts. Duplicating it into columns would create a second
// source of truth (AGENTS.md).
//
// metric carries NO check constraint (ADR-050): adding a metric must never
// require a DROP CONSTRAINT migration.
export const healthMetricStreams = pgTable(
  "health_metric_streams",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => healthConnections.id, { onDelete: "cascade" }),
    metric: text("metric").notNull(),
    syncEnabled: boolean("sync_enabled").notNull().default(false),
    // Result of the capability probe (ADR-046 checkpoint 6.2P): lets the UI say
    // "your device doesn't report this" instead of rendering a silent blank.
    capabilityStatus: text("capability_status"),
    capabilityCheckedAt: timestamp("capability_checked_at", { withTimezone: true }),
    // Newest and oldest fully-verified civil dates.
    verifiedThroughDate: date("verified_through_date"),
    earliestVerifiedDate: date("earliest_verified_date"),
    // The oldest civil date that has EVER returned real data for this stream.
    // Densification is clamped to dates >= this, so a backfill cannot
    // manufacture "verified absent" history for the months before the user
    // owned the device.
    firstDataDate: date("first_data_date"),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    backfillStatus: text("backfill_status").notNull().default("idle"),
    backfillTargetDate: date("backfill_target_date"),
    // THE resumable cursor: a date in Postgres, never a page token. Page tokens
    // can expire between job attempts; a date cannot.
    backfillCursorDate: date("backfill_cursor_date"),
    backfillCancelRequested: boolean("backfill_cancel_requested").notNull().default(false),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "health_metric_streams_backfill_status",
      sql`${table.backfillStatus} in ('idle','running','paused','cancelled','complete','failed')`,
    ),
    check(
      "health_metric_streams_backfill_invariants",
      sql`(${table.backfillStatus} = 'idle' and ${table.backfillTargetDate} is null and ${table.backfillCursorDate} is null) or (${table.backfillStatus} <> 'idle' and ${table.backfillTargetDate} is not null)`,
    ),
    check(
      "health_metric_streams_verified_range",
      sql`${table.earliestVerifiedDate} is null or ${table.verifiedThroughDate} is null or ${table.earliestVerifiedDate} <= ${table.verifiedThroughDate}`,
    ),
    uniqueIndex("health_metric_streams_connection_metric_unique").on(
      table.connectionId,
      table.metric,
    ),
  ],
);
