import { pgTable, text, timestamp, uniqueIndex, uuid, bigint } from "drizzle-orm/pg-core";
import { canvasConnections } from "./canvas-connections.js";
import { canvasCourses } from "./canvas-courses.js";

// ADR-068 Canvas LMS integration (migration 0020).
//
// message_preview is a TAG-STRIPPED, TRUNCATED PLAIN-TEXT PREVIEW of Canvas's
// `message` field, never the raw HTML Canvas returns. Unlike an assignment's
// `description` (not stored at all -- see canvas-assignments.ts), an
// announcement's entire value IS its content, so it is stored -- but only
// after HTML tags are stripped and the result is bounded at write exactly
// like every other provider-authored string in this codebase
// (text-bounds.ts's convention: truncate, never reject, for text the owner
// didn't type). This project has no HTML sanitizer or renderer and React
// Native's <Text> interprets no markup, the same reasoning ADR-059 §5 already
// applies to search results.
//
// read_state is Canvas's own vocabulary (read|unread) and carries NO check
// constraint (ADR-050) -- Zod-enforced only.
export const canvasAnnouncements = pgTable(
  "canvas_announcements",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => canvasConnections.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => canvasCourses.id, { onDelete: "cascade" }),
    canvasAnnouncementId: bigint("canvas_announcement_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    messagePreview: text("message_preview"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    htmlUrl: text("html_url"),
    readState: text("read_state"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("canvas_announcements_connection_announcement_unique").on(
      table.connectionId,
      table.canvasAnnouncementId,
    ),
  ],
);
