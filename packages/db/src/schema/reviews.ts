import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// ADR-040 durable reviews model (migration 0011). One row per (kind,
// period_start); content is the versioned checklist JSON written whole on
// every save -- no merge semantics at the storage layer. period_start is a
// plain calendar date (string mode), never a timestamp-midnight hack.
export const reviews = pgTable(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    periodStart: date("period_start").notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("in_progress"),
    content: jsonb("content"),
    summary: text("summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    check("reviews_kind", sql`${table.kind} in ('daily', 'weekly')`),
    check("reviews_status", sql`${table.status} in ('in_progress', 'completed', 'skipped')`),
    uniqueIndex("reviews_kind_period_start_unique").on(table.kind, table.periodStart),
    index("reviews_completed_at_idx").on(table.completedAt),
  ],
);
