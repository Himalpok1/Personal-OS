import {
  parseFlexibleDatetime,
  resolveInstantToLocalUntil,
  toWallClockComponents,
  validateCompletionAnchoredRule,
  wallClockToNaiveDate,
} from "@personal-os/core";
import { events, notes, occurrences, projects, tasks, type Db } from "@personal-os/db";
import type { ParserToolCall } from "@personal-os/schema";
import { sql } from "drizzle-orm";

export interface InboxContext {
  timezone: string;
}

export interface CommittedEntity {
  entityType: "task" | "note" | "event";
  entityId: string;
}

export interface CommitResult {
  committed: CommittedEntity;
  unknownProjectReference: boolean;
}

async function resolveProjectId(
  db: Db,
  projectName: string | undefined,
): Promise<{ projectId: string | null; unknownProjectReference: boolean }> {
  if (!projectName) return { projectId: null, unknownProjectReference: false };
  const [row] = await db
    .select({ id: projects.id })
    .from(projects)
    .where(sql`lower(${projects.name}) = lower(${projectName})`);
  return row
    ? { projectId: row.id, unknownProjectReference: false }
    : { projectId: null, unknownProjectReference: true };
}

// Standalone check for the confidence-scoring signal, which needs to know
// whether a project reference is known *before* the commit decision is
// made (commit only happens on the high-confidence path). A small
// duplicate read against resolveProjectId's query -- not worth threading a
// shared result through for a cheap SELECT.
export async function hasKnownProject(db: Db, projectName: string | undefined): Promise<boolean> {
  if (!projectName) return true;
  const { unknownProjectReference } = await resolveProjectId(db, projectName);
  return !unknownProjectReference;
}

// The single place a parsed tool call becomes a real task/note/event row --
// called from capture.parse's own auto-commit path and from its
// confirm-mode path (see docs/ARCHITECTURE.md: "The API never performs the
// work inline, only enqueues" -- the API's confirm route re-enqueues into
// capture.parse rather than creating entities itself, so this stays the
// only place entity creation happens).
export async function commitParsedEntity(
  db: Db,
  toolCall: ParserToolCall,
  ctx: InboxContext,
): Promise<CommitResult> {
  switch (toolCall.tool) {
    case "create_task": {
      const { projectId, unknownProjectReference } = await resolveProjectId(
        db,
        toolCall.args.project,
      );
      if (toolCall.args.recurrence_anchor === "completion_date" && toolCall.args.rrule) {
        validateCompletionAnchoredRule(toolCall.args.rrule);
      }
      const [row] = await db
        .insert(tasks)
        .values({
          title: toolCall.args.title,
          status: "inbox",
          dueAt: toolCall.args.due_at
            ? parseFlexibleDatetime(toolCall.args.due_at, ctx.timezone)
            : undefined,
          remindAt: toolCall.args.remind_at
            ? parseFlexibleDatetime(toolCall.args.remind_at, ctx.timezone)
            : undefined,
          timezone: ctx.timezone,
          priority: toolCall.args.priority,
          projectId,
          rrule: toolCall.args.rrule,
          recurrenceTimezone: toolCall.args.rrule
            ? (toolCall.args.recurrence_timezone ?? ctx.timezone)
            : undefined,
          recurrenceAnchor: toolCall.args.recurrence_anchor,
        })
        .returning({ id: tasks.id });
      if (!row) throw new Error("insert into tasks returned no row");

      // "Exactly one open occurrence exists" for a completion-anchored task
      // (docs/ARCHITECTURE.md) has to start somewhere -- nothing else ever
      // creates the *first* one, since the nightly window job explicitly
      // excludes completion-anchored rules and the lazy-generation job only
      // runs *after* a completion. Seed it at creation time: due_at if the
      // parser resolved one, otherwise "now" (e.g. "water the plants every
      // 3 days" with no explicit start reads as "starting now").
      if (toolCall.args.recurrence_anchor === "completion_date" && toolCall.args.rrule) {
        const timezone = toolCall.args.recurrence_timezone ?? ctx.timezone;
        const firstOccursAt = toolCall.args.due_at
          ? parseFlexibleDatetime(toolCall.args.due_at, timezone)
          : new Date();
        await db.insert(occurrences).values({
          parentType: "task",
          parentId: row.id,
          occursAt: firstOccursAt,
          occursLocal: wallClockToNaiveDate(toWallClockComponents(firstOccursAt, timezone)),
          status: "scheduled",
          lazyGenerated: true,
        });
      }

      return { committed: { entityType: "task", entityId: row.id }, unknownProjectReference };
    }
    case "create_note": {
      const { projectId, unknownProjectReference } = await resolveProjectId(
        db,
        toolCall.args.project,
      );
      const [row] = await db
        .insert(notes)
        .values({ title: toolCall.args.title, body: toolCall.args.body, projectId })
        .returning({ id: notes.id });
      if (!row) throw new Error("insert into notes returned no row");
      return { committed: { entityType: "note", entityId: row.id }, unknownProjectReference };
    }
    case "create_event": {
      const isAllDay = toolCall.args.all_day ?? false;

      // Canonical shape per EventCreateSchema: all-day events carry
      // start_date/end_date (calendar dates), never starts_at/ends_at; timed
      // events carry starts_at/ends_at, never start_date/end_date. The parser
      // only ever emits an instant-shaped `start`/`end`, so an all-day tool
      // call must be converted into a local calendar date (in the capture's
      // own timezone) rather than committed as the previous malformed inverse
      // shape (all_day=true with starts_at set and start_date left null) --
      // that shape breaks Google/CalDAV push and both calendar grids.
      const startInstant = parseFlexibleDatetime(toolCall.args.start, ctx.timezone);
      const endInstant = toolCall.args.end
        ? parseFlexibleDatetime(toolCall.args.end, ctx.timezone)
        : undefined;

      const startDate = isAllDay
        ? resolveInstantToLocalUntil(startInstant, ctx.timezone)
        : undefined;
      const endDate = isAllDay
        ? endInstant
          ? resolveInstantToLocalUntil(endInstant, ctx.timezone)
          : startDate
        : undefined;

      const [row] = await db
        .insert(events)
        .values({
          title: toolCall.args.title,
          location: toolCall.args.location,
          startsAt: isAllDay ? undefined : startInstant,
          endsAt: isAllDay ? undefined : endInstant,
          timezone: ctx.timezone,
          allDay: isAllDay,
          startDate,
          endDate,
          rrule: toolCall.args.rrule,
          recurrenceTimezone: toolCall.args.rrule ? ctx.timezone : undefined,
        })
        .returning({ id: events.id });
      if (!row) throw new Error("insert into events returned no row");
      return {
        committed: { entityType: "event", entityId: row.id },
        unknownProjectReference: false,
      };
    }
    case "unclear":
      throw new Error("cannot commit an 'unclear' tool call to an entity");
  }
}
