import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
});
