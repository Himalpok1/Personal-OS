import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiModels } from "./ai-models.js";

// fallback_model_ids is nullable and only ever consulted when the caller
// explicitly configured it -- packages/ai-providers must never fall through
// to a provider the user didn't opt into (no silent fallback to a paid
// provider).
export const aiTaskRoutes = pgTable("ai_task_routes", {
  id: uuid("id").primaryKey().defaultRandom(),
  taskName: text("task_name").notNull().unique(),
  primaryModelId: uuid("primary_model_id")
    .notNull()
    .references(() => aiModels.id),
  fallbackModelIds: uuid("fallback_model_ids").array(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
