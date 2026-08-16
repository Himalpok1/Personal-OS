import { sql } from "drizzle-orm";
import { check, index, jsonb, pgTable, real, text, timestamp, uuid } from "drizzle-orm/pg-core";

// Raw capture text is written here before any parsing happens (see
// docs/ARCHITECTURE.md, "Write the raw text to Postgres before doing
// anything else"). client_uuid is the offline-retry dedupe key.
export const inboxItems = pgTable(
  "inbox_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientUuid: uuid("client_uuid").unique(),
    rawText: text("raw_text").notNull(),
    source: text("source").notNull(),
    audioPath: text("audio_path"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    timezone: text("timezone").notNull(),
    status: text("status").notNull().default("pending"),
    parseResult: jsonb("parse_result"),
    confidence: real("confidence"),
    // entity_id is polymorphic (task|note|event, selected by entity_type)
    // and deliberately not a foreign key -- same trade-off as
    // occurrences.parent_id and item_tags.item_id, enforced at the
    // application layer rather than the database.
    entityType: text("entity_type"),
    entityId: uuid("entity_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "inbox_items_status",
      sql`${table.status} in ('pending','parsed','needs_confirm','confirmed','failed')`,
    ),
    check("inbox_items_source", sql`${table.source} in ('siri','ptt','web','share','assistant')`),
    check(
      "inbox_items_entity_type",
      sql`${table.entityType} is null or ${table.entityType} in ('note','task','event')`,
    ),
    index("inbox_items_status_idx").on(table.status),
  ],
);
