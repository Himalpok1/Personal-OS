import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import { projects } from "./projects.js";

// A reminder is just a task with remind_at set -- no separate reminders
// table (see docs/ARCHITECTURE.md).
//
// recurrence_anchor splits into two incompatible generation strategies:
// 'due_date' rules are pre-expanded into occurrences by a nightly window
// job; 'completion_date' rules generate lazily, one occurrence at a time,
// from the completion/skip timestamp (see packages/core/src/recurrence).
export const tasks = pgTable(
  "tasks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    body: text("body"),
    status: text("status").notNull().default("inbox"),
    dueAt: timestamp("due_at", { withTimezone: true }),
    dueLocal: timestamp("due_local"),
    remindAt: timestamp("remind_at", { withTimezone: true }),
    timezone: text("timezone").notNull(),
    priority: smallint("priority"),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    rrule: text("rrule"),
    recurrenceTimezone: text("recurrence_timezone"),
    recurrenceAnchor: text("recurrence_anchor"),
    recurrenceUntil: timestamp("recurrence_until", { withTimezone: true }),
    recurrenceCount: integer("recurrence_count"),
    recurrenceExdates: date("recurrence_exdates").array(),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id),
    originalDueAt: timestamp("original_due_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("tasks_status", sql`${table.status} in ('inbox','active','done','dropped')`),
    check(
      "tasks_recurrence_anchor",
      sql`${table.recurrenceAnchor} is null or ${table.recurrenceAnchor} in ('due_date','completion_date')`,
    ),
    // Supports the nightly window job's mandatory
    // `where recurrence_anchor = 'due_date' and rrule is not null` filter.
    index("tasks_recurrence_due_idx")
      .on(table.recurrenceAnchor)
      .where(sql`${table.rrule} is not null`),
  ],
);
