import { occurrences } from "@personal-os/db";
import { sql, type SQL } from "drizzle-orm";

// The EFFECTIVE instant of an occurrence (Checkpoint 9.4, migration 0018).
//
// A snooze on a recurring task acts on its occurrence, and it is stored in a
// separate column rather than by moving `occurs_at`: `occurs_at` is the row's
// identity under occurrences_parent_occurs_at_key -- the nightly window job
// re-inserts on it with onConflictDoNothing -- so moving it would resurrect
// the original instant as a second, un-snoozed row on the next cron pass.
// Every read surface that buckets, filters or orders a TASK occurrence by
// "when is this due" must therefore read `greatest(occurs_at, snoozed_until)`,
// and this is the ONE definition of that expression so Today, Agenda, the
// review contexts, GET /reminders and the /tasks/:id/complete redirect can
// never disagree about which instant a snoozed instance belongs to.
//
// `greatest`, not `coalesce` (9.4 review): a snooze may only DEFER an
// instance. The snooze targets the mobile client offers are relative to NOW
// ("in an hour", "tomorrow 9am"), and a reminder can fire the day BEFORE the
// instance is due, so snoozing that reminder by an hour would -- under a plain
// coalesce -- pull the due instant a day earlier than the rule put it and
// surface the instance as overdue on Today the moment its reminder was
// snoozed. Postgres' greatest() ignores NULLs, so an un-snoozed row reads as
// its own occurs_at; a snooze past occurs_at defers to snoozed_until; a snooze
// before it leaves the instant alone (the reminder still moves -- see
// routes/reminders.ts, where the reminder instant of a snoozed row IS its
// snoozed_until). The column is written only by POST /occurrences/:id/snooze,
// which refuses any parent that is not a task, so for event occurrences the
// expression always reduces to occurs_at and the read models do not
// special-case parent_type.
//
// Terminal rows (done/skipped) ignore the column -- complete/skip/reopen all
// clear it -- and every read model already filters to status = 'scheduled'
// before this expression matters.
//
// `.mapWith(occurrences.occursAt)` reuses the timestamptz column's own driver
// mapper so the selected value arrives as a Date exactly like `occurs_at`
// does; a bare sql<Date> would bypass drizzle's column mapping and hand back a
// string (the same trap today.ts's toDateOrNull guards its aggregates against).
export const effectiveOccursAt: SQL<Date> =
  sql<Date>`greatest(${occurrences.occursAt}, ${occurrences.snoozedUntil})`.mapWith(
    occurrences.occursAt,
  );
