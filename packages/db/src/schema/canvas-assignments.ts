import {
  bigint,
  boolean,
  pgTable,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { canvasConnections } from "./canvas-connections.js";
import { canvasCourses } from "./canvas-courses.js";

// ADR-068 Canvas LMS integration (migration 0020).
//
// submission_state/submission_missing/submission_late/submitted_at are the
// three coarse submission signals the brief asked for -- "did I turn it in,
// on time" -- from the real per-user submission sub-object the live discovery
// probe confirmed (`include[]=submission`). submission_state carries NO check
// constraint (ADR-050): it is Canvas's own vocabulary
// (unsubmitted|submitted|graded|pending_review), Zod-enforced only.
//
// GRADE AND SCORE ARE DELIBERATELY EXCLUDED, not merely unrequested. The live
// probe confirmed score/grade/entered_score/entered_grade are real, populated
// fields on this account, and this checkpoint does not sync them: a grade is
// more FERPA-sensitive than "did I turn it in", the brief never asked for a
// gradebook, and adding grade columns later is a strictly additive migration,
// never a redesign. Submission `attachments` (the student's own uploaded
// work) are excluded at a higher sensitivity than description text for the
// same reason. Do not add score/grade/entered_score/entered_grade/attachments
// columns without a fresh, explicit owner decision -- see ADR-068 §3.
//
// description IS NOT STORED AT ALL. Canvas returns it as instructor-authored
// rich HTML of unbounded upstream size, this project has no HTML sanitizer or
// renderer, and React Native's <Text> interprets no markup (the ADR-059 §5
// precedent for search results). html_url is the one-tap deep link to Canvas
// for the full prompt instead.
//
// submission_types is a Canvas vocabulary array (e.g. online_upload,
// discussion_topic), Zod-enforced only, mirroring mail_messages.provider_labels
// for shape but left nullable (unlike provider_labels) because Canvas can
// return an assignment with no submission_types entry at all.
//
// title and html_url use the mail_messages/mail-sync-runs provider-string
// convention: truncated at write (text-bounds.ts), never rejected, because the
// owner didn't type them.
export const canvasAssignments = pgTable(
  "canvas_assignments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    connectionId: uuid("connection_id")
      .notNull()
      .references(() => canvasConnections.id, { onDelete: "cascade" }),
    courseId: uuid("course_id")
      .notNull()
      .references(() => canvasCourses.id, { onDelete: "cascade" }),
    canvasAssignmentId: bigint("canvas_assignment_id", { mode: "number" }).notNull(),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true }),
    pointsPossible: real("points_possible"),
    submissionTypes: text("submission_types").array(),
    htmlUrl: text("html_url"),
    published: boolean("published").notNull().default(true),
    submissionState: text("submission_state"),
    submissionMissing: boolean("submission_missing"),
    submissionLate: boolean("submission_late"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("canvas_assignments_connection_assignment_unique").on(
      table.connectionId,
      table.canvasAssignmentId,
    ),
  ],
);
