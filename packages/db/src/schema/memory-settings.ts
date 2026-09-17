import { sql } from "drizzle-orm";
import { boolean, check, pgTable, text, timestamp } from "drizzle-orm/pg-core";

// Checkpoint 10.7 (ADR-077): the one global switch for the Personal Memory
// layer. A singleton row (`id = 'singleton'`, CHECK-enforced) rather than a
// column on some other table because no settings table exists anywhere in
// this schema and `ai_task_routes` row-presence is a MODEL-consent idiom that
// would need a fake `primary_model_id` for a feature that never calls a model.
//
// `enabled` gates USE, never storage: when false, Focus Now / the briefing
// treat memories as absent and suggestions are not offered, but every CRUD,
// list, export and delete path stays available so turning memory off can
// never trap the owner's own data. Ships ON (owner decision, 2026-09-17):
// nothing exists until the owner adds it, and nothing here leaves the machine.
// Absent row == enabled (the read model answers the default lazily; PATCH
// upserts the singleton).
export const memorySettings = pgTable(
  "memory_settings",
  {
    id: text("id").primaryKey(),
    enabled: boolean("enabled").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [check("memory_settings_singleton", sql`${table.id} in ('singleton')`)],
);

export const MEMORY_SETTINGS_SINGLETON_ID = "singleton";
