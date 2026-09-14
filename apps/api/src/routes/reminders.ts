import { deriveOccurrenceReminder } from "@personal-os/core";
import { occurrences, tasks } from "@personal-os/db";
import { RemindersQuerySchema, RemindersResponseSchema } from "@personal-os/schema";
import { and, eq, gt, gte, inArray, isNotNull, isNull, lte } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { effectiveOccursAt } from "../read-models/occurrence-effective.js";

// GET /reminders (Checkpoint 9.4). The primary reminder device schedules one
// local notification per item returned here. Until 9.4 the device paged
// GET /tasks and scheduled the parent's single remind_at, so a recurring task
// reminded exactly once -- for the series anchor -- and never again (the A3
// debt). This read model derives a reminder PER OCCURRENCE server-side, from
// the parent's remind_at wall-clock time and its day-offset from due_at,
// resolved in recurrence_timezone (packages/core's deriveOccurrenceReminder),
// so "the evening before at 8pm" holds on every instance across DST.
//
// Item rules, each pinned by a test:
//   (a) one-off: rrule IS NULL, status inbox|active, unarchived, remind_at set
//       and later than now - 1h  -> key `task:<id>`, occurrence_id null.
//   (b) recurring: rrule + recurrence_timezone set, same status/archive
//       filters, remind_at set; every scheduled occurrence whose EFFECTIVE
//       instant (greatest(occurs_at, snoozed_until), read-models/occurrence-effective.ts)
//       lies in [now - 1h, now + horizon] -> key `occ:<occurrence id>`,
//       recurring true, `due_at` = that effective instant.
//       A snoozed occurrence's reminder IS its snoozed_until (core rule):
//       the owner asked to be reminded THEN, even when the snooze lands
//       before the instance's due instant (which a snooze can never pull
//       earlier -- see occurrence-effective.ts).
// The grace hour (9.4 review) is NOT uniform. A one-off task's remind_at and
// a snoozed occurrence's snoozed_until are instants the owner set, and the
// device's own eligibility cutoff is remind_at > now - 1h (contract G2a): a
// reminder that fired minutes ago must not be cancelled by a refetch that no
// longer lists it, so both keep the hour. A DERIVED reminder on an un-snoozed
// occurrence is kept only when strictly later than now: a completion_date
// successor is inserted the moment its predecessor is completed, and when
// the reminder offset places its derived instant already in the past -- an
// evening-before reminder for a chore completed the next morning, say -- a
// grace hour would list it and the device would fire it INSTANTLY, for an
// instance the owner just created by completing the previous one. Nothing
// is lost by the stricter rule: an un-snoozed derived reminder in the past
// was never scheduled on the device in the first place.
//
// The response is parsed through the strict RemindersResponseSchema before it
// is sent, so a column added to either query can never leak onto the wire --
// the shape carries title, instants, timezone and the two ids the client
// needs to act on a notification, and nothing else (no body, no notes).
// Sorted by remind_at asc, then the row's own id asc (the occurrence id for
// an occurrence item, the task id otherwise): a total order, so the device's
// diff-and-reschedule pass sees a stable list between refetches.

const GRACE_MS = 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const OPEN_STATUSES = ["inbox", "active"] as const;

interface ReminderRow {
  key: string;
  task_id: string;
  occurrence_id: string | null;
  title: string;
  remind_at: Date;
  due_at: Date | null;
  timezone: string;
  recurring: boolean;
}

function compareReminders(a: ReminderRow, b: ReminderRow): number {
  const delta = a.remind_at.getTime() - b.remind_at.getTime();
  if (delta !== 0) return delta;
  const aId = a.occurrence_id ?? a.task_id;
  const bId = b.occurrence_id ?? b.task_id;
  return aId < bId ? -1 : aId > bId ? 1 : 0;
}

export default function remindersRoutes(app: FastifyInstance): void {
  app.get<{ Querystring: Record<string, string> }>("/reminders", async (request) => {
    const query = RemindersQuerySchema.parse(request.query);
    // One instant per build (the frozen read-model rule): both queries and
    // every derived comparison use it.
    const now = new Date();
    const graceStart = new Date(now.getTime() - GRACE_MS);
    const horizonEnd = new Date(now.getTime() + query.horizon_days * MS_PER_DAY);

    const oneOffRows = await app.db
      .select({
        id: tasks.id,
        title: tasks.title,
        dueAt: tasks.dueAt,
        remindAt: tasks.remindAt,
        timezone: tasks.timezone,
      })
      .from(tasks)
      .where(
        and(
          isNull(tasks.archivedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          isNull(tasks.rrule),
          isNotNull(tasks.remindAt),
          gt(tasks.remindAt, graceStart),
        ),
      );

    const occurrenceRows = await app.db
      .select({
        id: occurrences.id,
        occursAt: occurrences.occursAt,
        snoozedUntil: occurrences.snoozedUntil,
        effectiveAt: effectiveOccursAt,
        taskId: tasks.id,
        title: tasks.title,
        dueAt: tasks.dueAt,
        remindAt: tasks.remindAt,
        timezone: tasks.timezone,
        recurrenceTimezone: tasks.recurrenceTimezone,
      })
      .from(occurrences)
      .innerJoin(tasks, eq(occurrences.parentId, tasks.id))
      .where(
        and(
          eq(occurrences.parentType, "task"),
          eq(occurrences.status, "scheduled"),
          isNull(tasks.archivedAt),
          inArray(tasks.status, [...OPEN_STATUSES]),
          isNotNull(tasks.rrule),
          isNotNull(tasks.recurrenceTimezone),
          isNotNull(tasks.remindAt),
          gte(effectiveOccursAt, graceStart),
          lte(effectiveOccursAt, horizonEnd),
        ),
      );

    const items: ReminderRow[] = [];
    for (const row of oneOffRows) {
      // isNotNull(tasks.remindAt) above makes this non-null; the guard only
      // narrows the type without weakening the query.
      if (row.remindAt === null) continue;
      items.push({
        key: `task:${row.id}`,
        task_id: row.id,
        occurrence_id: null,
        title: row.title,
        remind_at: row.remindAt,
        due_at: row.dueAt,
        timezone: row.timezone,
        recurring: false,
      });
    }
    for (const row of occurrenceRows) {
      if (row.remindAt === null || row.recurrenceTimezone === null) continue;
      const remindAt = deriveOccurrenceReminder(
        { dueAt: row.dueAt, remindAt: row.remindAt, recurrenceTimezone: row.recurrenceTimezone },
        { occursAt: row.occursAt, snoozedUntil: row.snoozedUntil },
      );
      const cutoff = row.snoozedUntil === null ? now : graceStart;
      if (remindAt.getTime() <= cutoff.getTime()) continue;
      items.push({
        key: `occ:${row.id}`,
        task_id: row.taskId,
        occurrence_id: row.id,
        title: row.title,
        remind_at: remindAt,
        due_at: row.effectiveAt,
        timezone: row.timezone,
        recurring: true,
      });
    }
    items.sort(compareReminders);

    return RemindersResponseSchema.parse({
      items: items.map((item) => ({
        ...item,
        remind_at: item.remind_at.toISOString(),
        due_at: item.due_at ? item.due_at.toISOString() : null,
      })),
      horizon_days: query.horizon_days,
    });
  });
}
