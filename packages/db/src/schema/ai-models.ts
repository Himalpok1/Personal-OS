import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { aiProviderConnections } from "./ai-provider-connections.js";

export const aiModels = pgTable("ai_models", {
  id: uuid("id").primaryKey().defaultRandom(),
  providerConnectionId: uuid("provider_connection_id")
    .notNull()
    .references(() => aiProviderConnections.id, { onDelete: "cascade" }),
  modelId: text("model_id").notNull(),
  displayName: text("display_name"),
  capabilities: jsonb("capabilities"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
