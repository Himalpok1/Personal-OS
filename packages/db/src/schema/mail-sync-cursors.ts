import { boolean, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { mailConnections } from "./mail-connections.js";

// Per-(connection, scope) incremental sync state (ADR-053, migration 0014).
//
// THIS TABLE DELIBERATELY INVERTS health_metric_streams' CURSOR RULE, and the
// inversion is the point rather than an oversight.
//
// health_metric_streams.backfill_cursor_date carries the comment "THE resumable
// cursor: a date in Postgres, never a page token. Page tokens can expire
// between job attempts; a date cannot." That reasoning is correct FOR HEALTH,
// because the Google Health API offers no incremental primitive at all, so the
// cursor had to be synthesized from civil dates.
//
// Gmail is the opposite case. `history.list` keyed on an opaque `historyId` IS
// the incremental primitive, it is the only one offered, and it CANNOT be
// derived from or converted into a date. It also expires: `history.list`
// returns HTTP 404 once startHistoryId falls outside a retention window Google
// documents only as "at least one week and often longer".
//
// So the cursor is stored as an opaque provider string that this codebase never
// parses, never orders by, and never converts to a timestamp -- and cursor
// expiry is modelled explicitly rather than being an unrepresentable edge case.
// needs_full_resync is the durable flag a 404 sets; a bounded full sync clears
// it and writes a fresh cursor. It defaults to TRUE because a cursor row that
// has never synced has no cursor and therefore genuinely does need a full pass.
//
// cursor_kind names the provider's cursor semantics (e.g. gmail_history_id).
// It carries NO check constraint (ADR-050): a second provider would add its own
// kind, and widening a CHECK needs a DROP CONSTRAINT that
// reconcile-drizzle-tracking.ts cannot process. Zod enforces it.
//
// scope_key is the sync unit within one mailbox -- a Gmail label id such as
// INBOX. Gmail's history cursor is mailbox-wide, so today there is one row per
// connection; the column exists because Microsoft Graph's delta cursor is
// per-folder (ADR-052), and a per-scope key is representable now without any
// Graph-specific implementation.
export const mailSyncCursors = pgTable(
  "mail_sync_cursors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => mailConnections.id, { onDelete: "cascade" }),
    scopeKey: text("scope_key").notNull(),
    // Opaque provider state. Never parsed, never compared for ordering, never
    // turned into a date watermark.
    cursorValue: text("cursor_value"),
    cursorKind: text("cursor_kind").notNull(),
    needsFullResync: boolean("needs_full_resync").notNull().default(true),
    lastSuccessfulSyncAt: timestamp("last_successful_sync_at", { withTimezone: true }),
    lastFullSyncAt: timestamp("last_full_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mail_sync_cursors_connection_scope_unique").on(table.connectionId, table.scopeKey),
  ],
);
