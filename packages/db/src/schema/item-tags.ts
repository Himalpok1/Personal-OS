import { sql } from "drizzle-orm";
import { check, pgTable, primaryKey, text, uuid } from "drizzle-orm/pg-core";
import { tags } from "./tags.js";

// item_id is polymorphic (task|note|event), so it is deliberately not a
// foreign key -- same trade-off as occurrences.parent_id, enforced at the
// application layer rather than the database.
export const itemTags = pgTable(
  "item_tags",
  {
    itemType: text("item_type").notNull(),
    itemId: uuid("item_id").notNull(),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (table) => [
    primaryKey({ columns: [table.itemType, table.itemId, table.tagId] }),
    check("item_tags_item_type", sql`${table.itemType} in ('task','note','event')`),
  ],
);
