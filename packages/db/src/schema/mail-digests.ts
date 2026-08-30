import { date, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { aiModels } from "./ai-models.js";

// The mail digest (ADR-053, migration 0014). Shaped on ai_daily_briefs, whose
// (brief_date, timezone) identity solved the same problem.
//
// IDENTITY IS (digest_date, timezone) AND CARRIES NO connection_id. That is
// deliberate, not an omission: ADR-053 makes the digest GLOBAL across every
// active mail connection. The product question is "what needs my attention
// today", which is not per-account -- a person with a work and a personal
// mailbox wants one digest, not two. A per-mailbox identity would also make
// the answer depend on how many mailboxes happen to be connected.
//
// timezone is part of the key for the same reason it is in ai_daily_briefs:
// the same instant is a different local calendar date in different timezones,
// and the row exists to describe one requested local day.
//
// model_id is nullable and ON DELETE SET NULL -- it records which ai_models row
// actually served the generation (via callWithFallbackTracked, never the
// route's assumed primary), without holding the digest hostage to a later model
// deletion. The digest remains valid history either way.
//
// generated_at is when the CONTENT was produced; updated_at is when the ROW was
// last written. They coincide today because generation is the only writer, but
// they are distinct facts and a later checkpoint may touch the row without
// regenerating.
//
// Checkpoint 7.1 creates the table only. Generation belongs to Checkpoint 7.4,
// which must ensure a failed generation never overwrites a good cached digest
// -- the ai_daily_briefs rule that the insert is physically unreachable from
// the catch branch.
export const mailDigests = pgTable(
  "mail_digests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    digestDate: date("digest_date").notNull(),
    timezone: text("timezone").notNull(),
    content: jsonb("content").notNull(),
    modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("mail_digests_date_timezone_unique").on(table.digestDate, table.timezone),
  ],
);
