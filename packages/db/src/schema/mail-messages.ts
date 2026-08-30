import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { mailConnections } from "./mail-connections.js";

// Message METADATA only (ADR-053/054, migration 0014).
//
// THERE IS NO BODY COLUMN, NO SNIPPET COLUMN AND NO ATTACHMENT CONTENT, and
// that absence is the design rather than a gap to fill later. The connection is
// authorized with `gmail.metadata` alone, under which Gmail rejects
// format=FULL and format=RAW outright, so a body is not merely unstored -- it
// is unfetchable. That is what removes the retention question ADR-024 and
// ADR-047 would otherwise force, and it bounds the attacker-authored surface
// reaching the AI layer to `subject` and `from_display_name` (ADR-054).
//
// provider_labels, NOT label_ids. Gmail labels are provider-specific storage
// semantics -- INBOX, UNREAD, CATEGORY_PROMOTIONS are Gmail's vocabulary, not a
// universal one -- and a second provider must not be forced to describe folders
// as "labels". The column is deliberately named for what it is: opaque,
// provider-defined tags.
//
// Every provider-supplied string is length-bounded by
// packages/schema/src/mail-messages.ts AND truncated at write. The database
// stores text without a length cap on purpose (a provider that exceeds the
// bound must be rejected by a named contract, not silently severed by a column
// type), but nothing may insert an unbounded string. This is the gap recorded
// against health_sessions.session_type, deliberately not recreated.
//
// deleted_at is a soft, reversible tombstone for a message the provider stops
// returning -- reconciliation with upstream truth, not local data destruction
// (the ADR-047a distinction). The row is retained; reappearance clears it.
export const mailMessages = pgTable(
  "mail_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mailConnections.id, { onDelete: "cascade" }),
    externalId: text("external_id").notNull(),
    threadId: text("thread_id").notNull(),
    internalDate: timestamp("internal_date", { withTimezone: true }).notNull(),
    fromAddress: text("from_address"),
    fromDomain: text("from_domain"),
    fromDisplayName: text("from_display_name"),
    subject: text("subject"),
    providerLabels: text("provider_labels").array().notNull().default(sql`'{}'::text[]`),
    hasAttachment: boolean("has_attachment").notNull().default(false),
    sizeEstimate: integer("size_estimate"),
    contentHash: text("content_hash").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "mail_messages_size_estimate_nonnegative",
      sql`${table.sizeEstimate} is null or ${table.sizeEstimate} >= 0`,
    ),
    uniqueIndex("mail_messages_connection_external_id_unique").on(
      table.connectionId,
      table.externalId,
    ),
    // Ascending, NOT (connection_id, internal_date DESC), and this is a
    // repository constraint rather than a preference: deriveIndexProbe in
    // packages/db/scripts/reconcile-drizzle-tracking.ts requires every indexed
    // column to match /^[a-z_][a-z0-9_]*$/, so a DESC modifier aborts
    // db:reconcile outright. It costs nothing -- a btree is scanned in either
    // direction, so this index serves ORDER BY internal_date DESC identically.
    index("mail_messages_connection_internal_date_idx").on(table.connectionId, table.internalDate),
    index("mail_messages_connection_thread_idx").on(table.connectionId, table.threadId),
  ],
);
