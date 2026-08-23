import { date, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { aiModels } from "./ai-models.js";

// ADR-041 manual/on-demand AI Daily Brief (migration 0012). Identity is
// (brief_date, timezone) -- deliberately NOT brief_date alone, because the
// same instant is a different local calendar date in different timezones,
// and this table's whole reason to exist is one brief per requested local
// day. content is the versioned collector+LLM output JSON, written whole.
// model_id is nullable and ON DELETE SET NULL: it records provenance (which
// model generated this brief) without holding the row hostage to a later
// ai_models deletion -- the brief itself remains valid history either way.
export const aiDailyBriefs = pgTable(
  "ai_daily_briefs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    briefDate: date("brief_date").notNull(),
    timezone: text("timezone").notNull(),
    content: jsonb("content").notNull(),
    modelId: uuid("model_id").references(() => aiModels.id, { onDelete: "set null" }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("ai_daily_briefs_date_timezone_unique").on(table.briefDate, table.timezone),
  ],
);
