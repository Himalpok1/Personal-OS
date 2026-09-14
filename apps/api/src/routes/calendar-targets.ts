import { calendarConnectionCalendars, calendarConnections } from "@personal-os/db";
import {
  CalendarTargetsResponseSchema,
  type CalendarTargetsResponse,
  type EventCalendarTarget,
} from "@personal-os/schema";
import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";

type Db = FastifyInstance["db"];
type CalendarRow = typeof calendarConnectionCalendars.$inferSelect;
type ConnectionRow = typeof calendarConnections.$inferSelect;

// Google calendarList access roles that permit writing events. `reader` and
// `freeBusyReader` do not, and NULL means UNKNOWN -- a Google calendar whose
// role was never recorded is not offered as a target (unknown is not
// writable). CalDAV carries no role; the PUT itself is the check.
const WRITABLE_GOOGLE_ROLES = ["owner", "writer"] as const;

/**
 * The write-eligibility rule (Checkpoint 9.5, contract §1), in one place for
 * both `GET /calendar-targets` (which lists eligible calendars) and
 * `POST /events` (which refuses an ineligible one):
 *
 *   sync_enabled AND connection active AND (Google role in {owner, writer}
 *   OR provider = caldav)
 */
export function isWriteEligibleCalendar(calendar: CalendarRow, connection: ConnectionRow): boolean {
  if (!calendar.syncEnabled) return false;
  if (connection.status !== "active") return false;
  if (connection.provider === "caldav") return true;
  return (
    calendar.accessRole !== null &&
    (WRITABLE_GOOGLE_ROLES as readonly string[]).includes(calendar.accessRole)
  );
}

export type WritableCalendarResolution =
  | {
      ok: true;
      connectionId: string;
      googleCalendarId: string | null;
      caldavCalendarUrl: string | null;
    }
  | { ok: false; reason: "calendar_not_found" | "connection_not_active" | "calendar_not_writable" };

/**
 * Resolves a `POST /events` `calendar` selector to a write-eligible calendar
 * row, or a closed reason token. The tokens name the FIRST failing condition
 * in the order a client would fix them: the calendar must exist on that
 * connection (`calendar_not_found` -- also for a missing connection or a
 * selector of the wrong provider kind), the connection must be active
 * (`connection_not_active`), and the calendar must be sync-enabled and
 * writable (`calendar_not_writable`).
 */
export async function resolveWritableCalendar(
  db: Db,
  selector: EventCalendarTarget,
): Promise<WritableCalendarResolution> {
  const [connection] = await db
    .select()
    .from(calendarConnections)
    .where(eq(calendarConnections.id, selector.connection_id));
  if (!connection) return { ok: false, reason: "calendar_not_found" };

  const isCaldav = selector.caldav_calendar_url !== undefined;
  if ((connection.provider === "caldav") !== isCaldav) {
    return { ok: false, reason: "calendar_not_found" };
  }

  const [calendar] = await db
    .select()
    .from(calendarConnectionCalendars)
    .where(
      isCaldav
        ? and(
            eq(calendarConnectionCalendars.connectionId, connection.id),
            eq(calendarConnectionCalendars.caldavCalendarUrl, selector.caldav_calendar_url!),
          )
        : and(
            eq(calendarConnectionCalendars.connectionId, connection.id),
            eq(calendarConnectionCalendars.googleCalendarId, selector.google_calendar_id!),
          ),
    );
  if (!calendar) return { ok: false, reason: "calendar_not_found" };
  if (connection.status !== "active") return { ok: false, reason: "connection_not_active" };
  if (!isWriteEligibleCalendar(calendar, connection)) {
    return { ok: false, reason: "calendar_not_writable" };
  }

  return {
    ok: true,
    connectionId: connection.id,
    googleCalendarId: calendar.googleCalendarId ?? null,
    caldavCalendarUrl: calendar.caldavCalendarUrl ?? null,
  };
}

// GET /calendar-targets (Checkpoint 9.5): every calendar a NEW local event
// may be written to, across all active connections. Perimeter-only like the
// rest of the API. Google before CalDAV, then summary, then id -- a total
// order, so two requests render the picker identically.
export default function calendarTargetsRoutes(app: FastifyInstance): void {
  app.get("/calendar-targets", async () => {
    const rows = await app.db
      .select({
        connectionId: calendarConnections.id,
        provider: calendarConnections.provider,
        googleCalendarId: calendarConnectionCalendars.googleCalendarId,
        caldavCalendarUrl: calendarConnectionCalendars.caldavCalendarUrl,
        summary: calendarConnectionCalendars.summary,
        accessRole: calendarConnectionCalendars.accessRole,
      })
      .from(calendarConnectionCalendars)
      .innerJoin(
        calendarConnections,
        eq(calendarConnectionCalendars.connectionId, calendarConnections.id),
      )
      .where(
        and(
          eq(calendarConnectionCalendars.syncEnabled, true),
          eq(calendarConnections.status, "active"),
          or(
            eq(calendarConnections.provider, "caldav"),
            inArray(calendarConnectionCalendars.accessRole, [...WRITABLE_GOOGLE_ROLES]),
          ),
        ),
      )
      .orderBy(
        asc(sql`case when ${calendarConnections.provider} = 'google' then 0 else 1 end`),
        asc(calendarConnectionCalendars.summary),
        asc(calendarConnectionCalendars.id),
      );

    const response: CalendarTargetsResponse = {
      items: rows.map((row) => ({
        connection_id: row.connectionId,
        provider: row.provider === "caldav" ? "caldav" : "google",
        google_calendar_id: row.googleCalendarId ?? null,
        caldav_calendar_url: row.caldavCalendarUrl ?? null,
        summary: row.summary,
        access_role: row.accessRole ?? null,
      })),
    };
    return CalendarTargetsResponseSchema.parse(response);
  });
}
