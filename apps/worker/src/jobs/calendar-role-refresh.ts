import {
  GoogleOAuthError,
  classifyCalendarProviderError,
  type GoogleCalendarClient,
} from "@personal-os/calendar-providers";
import { calendarConnectionCalendars, calendarConnections, type Db } from "@personal-os/db";
import { and, eq, notInArray } from "drizzle-orm";
import type { PgBoss } from "pg-boss";
import { errorToken, log } from "../logger.js";
import { markNeedsReauth } from "./calendar-refresh-token.js";
import { resolveFreshAccessToken } from "./calendar-sync-calendar.js";

// Worker-side access-role refresh (Checkpoint 9.5, fixer review MINOR-5).
//
// `calendar_connection_calendars.access_role` decides write-eligibility
// (contract §1), and until now it was written ONLY when the owner opened
// Settings and the API's `available-calendars` route listed the calendars.
// A calendar demoted from writer to reader on Google's side therefore stayed
// eligible for ever, and every push to it failed as `missing_scope` until the
// owner happened to revisit Settings. This pass keeps the column honest on
// the same five-minute cron that redrives pending pushes.
//
// Rules: UPDATE existing rows only (never insert -- which calendars exist is
// the API's decision, taken with the owner); `summary` is refreshed from the
// same listing (found stale at 8.2: it held the calendar id); a row ABSENT
// from the listing gets `access_role = NULL`, which every consumer reads as
// "not writable" -- an unshared calendar must stop receiving pushes. Every
// role value has already been clamped to the documented vocabulary by the
// client. Counts only in the log; never a calendar name or id.

export interface RoleRefreshSummary {
  connections: number;
  updated: number;
  cleared: number;
  failed: number;
}

export async function refreshCalendarAccessRoles(
  db: Db,
  googleClient: GoogleCalendarClient,
  boss?: PgBoss,
): Promise<RoleRefreshSummary> {
  const connections = await db
    .select()
    .from(calendarConnections)
    .where(
      and(eq(calendarConnections.status, "active"), eq(calendarConnections.provider, "google")),
    );

  const summary: RoleRefreshSummary = {
    connections: connections.length,
    updated: 0,
    cleared: 0,
    failed: 0,
  };

  for (const connection of connections) {
    try {
      const accessToken = await resolveFreshAccessToken(db, connection);
      const listing = await googleClient.listCalendars(accessToken);
      // An empty listing is far more likely a provider hiccup (a 200 with no
      // `items`) than an account with zero calendars -- every Google account
      // has a primary. Treat it as a failed pass rather than NULLing every
      // role (second-round review): the next tick tries again.
      if (listing.items.length === 0) {
        summary.failed += 1;
        continue;
      }
      const now = new Date();
      const listedIds: string[] = [];
      for (const item of listing.items) {
        listedIds.push(item.id);
        const written = await db
          .update(calendarConnectionCalendars)
          .set({ accessRole: item.accessRole ?? null, summary: item.summary, updatedAt: now })
          .where(
            and(
              eq(calendarConnectionCalendars.connectionId, connection.id),
              eq(calendarConnectionCalendars.googleCalendarId, item.id),
            ),
          )
          .returning({ id: calendarConnectionCalendars.id });
        summary.updated += written.length;
      }
      const absentPredicate = and(
        eq(calendarConnectionCalendars.connectionId, connection.id),
        notInArray(calendarConnectionCalendars.googleCalendarId, listedIds),
      );
      const cleared = await db
        .update(calendarConnectionCalendars)
        .set({ accessRole: null, updatedAt: now })
        .where(absentPredicate)
        .returning({ id: calendarConnectionCalendars.id });
      summary.cleared += cleared.length;
    } catch (err) {
      summary.failed += 1;
      if (err instanceof GoogleOAuthError && err.isPermanent) {
        // The ONE shared transition, so this pass mints the same episode key
        // the refresh-token job would (ADR-058). Never err.message.
        await markNeedsReauth(db, boss, connection.id, classifyCalendarProviderError(err));
      }
      log.warn("calendar.role_refresh.connection_failed", {
        connectionId: connection.id,
        errorCode: classifyCalendarProviderError(err),
        error: errorToken(err),
      });
    }
  }

  log.info("calendar.role_refresh.completed", { ...summary });
  return summary;
}
