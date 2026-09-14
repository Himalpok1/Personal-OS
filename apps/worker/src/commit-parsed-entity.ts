import {
  expandDueDateWindow,
  parseFlexibleDatetime,
  resolveInstantToLocalUntil,
  resolveParsedTaskRecurrence,
  resolveSeriesAnchor,
  toWallClockComponents,
  validateParsedTaskRecurrence,
  wallClockToNaiveDate,
  type DueDateRecurrenceRule,
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
      // Same defaulting POST /tasks applies (apps/api/src/routes/tasks.ts):
      // a rule with no stated anchor is due_date-anchored -- the reversible
      // mistake docs/ARCHITECTURE.md tells the parser to default to -- and a
      // task with no rule carries no anchor at all. Before Checkpoint 9.3 the
      // parser's omitted anchor was written through as NULL, which neither
      // generation strategy selects: the nightly window job filters on
      // `recurrence_anchor = 'due_date'` and lazy generation on
      // 'completion_date', so a captured "every Monday" task never produced a
      // single occurrence and could never be completed.
      //
      // The defaulting lives in packages/core (resolveParsedTaskRecurrence) so
      // that the committability check POST /inbox/:id/confirm runs judges
      // EXACTLY the rule that is committed here.
      const recurrence = resolveParsedTaskRecurrence(toolCall.args, ctx.timezone);

      // EVERYTHING THAT CAN THROW IS COMPUTED BEFORE ANY ROW IS WRITTEN.
      //
      // CreateTaskToolSchema validates neither `rrule` nor
      // `recurrence_timezone` (both bare strings), so the parser can emit
      // "every monday" or a zone Intl does not know. Before Checkpoint 9.3's
      // review the task row was inserted first and the window expansion ran
      // afterwards, outside any transaction -- so a bad rule threw AFTER the
      // insert, pg-boss retried, and every retry inserted another orphan task
      // row with no occurrence and no inbox link. Now: validate the rule,
      // resolve every instant, expand the window, and only then open ONE
      // transaction that writes the task and its occurrences together, exactly
      // as POST /tasks does. A bad rule throws with zero rows written; a crash
      // mid-write leaves nothing behind.
      validateParsedTaskRecurrence(toolCall.args, ctx.timezone);
      const dueAt = toolCall.args.due_at
        ? parseFlexibleDatetime(toolCall.args.due_at, ctx.timezone)
        : undefined;
      const remindAt = toolCall.args.remind_at
        ? parseFlexibleDatetime(toolCall.args.remind_at, ctx.timezone)
        : undefined;
      const effectiveNow = new Date();

      // The due_at the task row is written with (Checkpoint 9.4). For a
      // one-off task it is exactly what the parser resolved, or nothing. For
      // a RECURRING task with no parsed due_at it becomes the series anchor,
      // so the parent's due_at is never null for a series: the nightly
      // window job, PATCH /tasks/:id and the reminder derivation all read the
      // anchor back out of due_at (via resolveSeriesAnchor, the one shared
      // rule), and a series that carried none was re-anchored on its earliest
      // occurrence -- a reconstruction, where this is the fact. POST /tasks
      // persists the same instant under the same condition, so every writer
      // of a series agrees on where it starts. Assigned per branch below.
      let persistedDueAt: Date | undefined = dueAt;

      type OccurrenceSeed = { occursAt: Date; occursLocal: Date; lazyGenerated: boolean };
      let seeds: OccurrenceSeed[] = [];
      if (recurrence) {
        if (recurrence.recurrenceAnchor === "completion_date") {
          // "Exactly one open occurrence exists" for a completion-anchored task
          // (docs/ARCHITECTURE.md) has to start somewhere -- nothing else ever
          // creates the *first* one, since the nightly window job explicitly
          // excludes completion-anchored rules and the lazy-generation job only
          // runs *after* a completion. Seed it at creation time: due_at if the
          // parser resolved one, otherwise "now" (e.g. "water the plants every
          // 3 days" with no explicit start reads as "starting now").
          //
          // `dueAt` is the SAME instant written to tasks.due_at -- resolved
          // against the capture's timezone, as POST /tasks does
          // (`firstOccursAt = dueAt ?? effectiveNow`). It used to be re-resolved
          // against recurrence_timezone here, so an offset-less due_at with an
          // explicit, different recurrence_timezone seeded the first occurrence
          // at a different instant from the task's own due date.
          const firstOccursAt = dueAt ?? effectiveNow;
          // The seeded first occurrence IS the series' start, so it is what
          // the parent's due_at records when the parser resolved none.
          persistedDueAt = firstOccursAt;
          seeds = [
            {
              occursAt: firstOccursAt,
              occursLocal: wallClockToNaiveDate(
                toWallClockComponents(firstOccursAt, recurrence.recurrenceTimezone),
              ),
              lazyGenerated: true,
            },
          ];
        } else {
          // due_date anchor: materialize the rolling 90-day window at commit,
          // exactly as POST /tasks does (Checkpoint 9.3, contract 5). Before
          // this the captured series had no occurrence until the nightly
          // expand-window cron ran -- and, with no due_at, not even then, since
          // that job skips a due_date task without one -- so a task captured
          // in the morning was uncompletable all day: POST /tasks/:id/complete
          // refuses a recurring task (409) and there was no occurrence to
          // complete instead. Same rule shape, same 90-day window, same
          // ON CONFLICT DO NOTHING on (parent_type, parent_id, occurs_at) so a
          // pg-boss redelivery of the commit is idempotent against the rows
          // the first delivery wrote.
          // A brand-new series has no occurrence yet, so the shared rule
          // resolves to due_at or, failing that, to this commit's single
          // effectiveNow -- and that instant is then persisted as the
          // parent's due_at, so the fallback is taken exactly once per series
          // and the nightly job re-expands from the very same DTSTART.
          const ruleAnchor = resolveSeriesAnchor({
            dueAt: dueAt ?? null,
            earliestOccursAt: null,
            now: effectiveNow,
          });
          persistedDueAt = ruleAnchor;
          const rule: DueDateRecurrenceRule = {
            rrule: recurrence.rrule,
            recurrenceTimezone: recurrence.recurrenceTimezone,
            dtstart: toWallClockComponents(ruleAnchor, recurrence.recurrenceTimezone),
          };
          seeds = expandDueDateWindow(rule, 90, effectiveNow).map((occurrence) => ({
            occursAt: occurrence.occursAt,
            occursLocal: wallClockToNaiveDate(occurrence.occursLocal),
            lazyGenerated: false,
          }));
        }
      }

      const taskId = await db.transaction(async (tx) => {
        const [row] = await tx
          .insert(tasks)
          .values({
            title: toolCall.args.title,
            status: "inbox",
            dueAt: persistedDueAt,
            remindAt,
            timezone: ctx.timezone,
            priority: toolCall.args.priority,
            projectId,
            rrule: recurrence?.rrule,
            recurrenceTimezone: recurrence?.recurrenceTimezone,
            recurrenceAnchor: recurrence?.recurrenceAnchor,
          })
          .returning({ id: tasks.id });
        if (!row) throw new Error("insert into tasks returned no row");

        for (const seed of seeds) {
          await tx
            .insert(occurrences)
            .values({
              parentType: "task",
              parentId: row.id,
              occursAt: seed.occursAt,
              occursLocal: seed.occursLocal,
              status: "scheduled",
              lazyGenerated: seed.lazyGenerated,
            })
            .onConflictDoNothing({
              target: [occurrences.parentType, occurrences.parentId, occurrences.occursAt],
            });
        }
        return row.id;
      });

      return { committed: { entityType: "task", entityId: taskId }, unknownProjectReference };
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
