import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// parent_id is deliberately not a foreign key: parent_type selects between
// tasks and events (a polymorphic reference), and Postgres has no native
// polymorphic FK. Integrity is enforced at the application layer -- the
// same trade-off as item_tags.item_id.
export const occurrences = pgTable(
  "occurrences",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    parentType: text("parent_type").notNull(),
    parentId: uuid("parent_id").notNull(),
    occursAt: timestamp("occurs_at", { withTimezone: true }).notNull(),
    occursLocal: timestamp("occurs_local").notNull(),
    status: text("status").notNull().default("scheduled"),
    // true = created on completion/skip (lazy), false = created by the
    // nightly due-date window expansion job.
    lazyGenerated: boolean("lazy_generated").notNull().default(false),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    /**
     * Checkpoint 9.4 (migration 0018). A snooze on a RECURRING task acts on
     * its occurrence, never on the rule or the parent: `occurs_at` is the
     * row's identity (occurrences_parent_occurs_at_key -- the nightly window
     * job re-inserts on it), so moving it would resurrect the original
     * instant as a duplicate, and PATCHing the parent's due_at re-anchors
     * the whole series (branch A in apps/api/src/routes/tasks.ts). The
     * effective instant of a scheduled occurrence is therefore
     * `coalesce(snoozed_until, occurs_at)` -- one shared SQL helper in
     * apps/api/src/read-models feeds Today, Agenda, reviews and reminders.
     * Terminal rows ignore it; reopen clears it. Bounded at write to
     * MAX_SNOOZE_DAYS (packages/schema). Snoozed rows deleted by a rule edit
     * lose the snooze with the row -- deliberate, the edit regenerates them.
     */
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
  },
  (table) => [
    check("occurrences_parent_type", sql`${table.parentType} in ('task','event')`),
    check("occurrences_status", sql`${table.status} in ('scheduled','done','skipped')`),
    uniqueIndex("occurrences_parent_occurs_at_key").on(
      table.parentType,
      table.parentId,
      table.occursAt,
    ),
    // Makes lazy generation safe under pg-boss's at-least-once delivery: a
    // duplicate generate-lazy job run hits this index on insert, which the
    // job handler treats as "already done", not an error.
    uniqueIndex("one_open_occurrence_per_lazy_parent")
      .on(table.parentType, table.parentId)
      .where(sql`${table.status} = 'scheduled' and ${table.lazyGenerated}`),
    index("occurrences_occurs_at_idx").on(table.occursAt),
  ],
);
