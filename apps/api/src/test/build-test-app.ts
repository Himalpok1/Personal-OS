import {
  aiDailyBriefs,
  aiTaskRoutes,
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  devicePairingCodes,
  devices,
  eventExternalLinks,
  events,
  healthConnections,
  healthDailyMetrics,
  healthMetricStreams,
  healthOauthStates,
  healthObservations,
  healthSessions,
  healthSyncRuns,
  inboxItems,
  mailConnections,
  mailDigests,
  mailMessages,
  mailOauthStates,
  mailSyncCursors,
  mailSyncRuns,
  monitorChecks,
  monitorIncidents,
  monitorTargets,
  notes,
  notificationDispatchLog,
  occurrences,
  projects,
  reviews,
  tasks,
  memories,
  memorySettings,
  memorySuggestions,
} from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { buildServer, type BuildServerOptions } from "../server.js";

// vitest.config.ts points DATABASE_URL at TEST_DATABASE_URL before this
// module (or server.ts/env.ts) is ever imported, so buildServer() here
// connects to the dedicated test database, never dev. `googleCalendarClient`
// lets calendar-connections.test.ts inject a fake client (see
// @personal-os/calendar-providers' createFakeGoogleCalendarClient) so no
// route test ever makes a real call to the live Google API.
export async function buildTestApp(options: BuildServerOptions = {}): Promise<FastifyInstance> {
  return buildServer({
    // The heartbeat watchdog's INTERVAL is off by default in tests. Every suite
    // in this repository shares one `personalos_test` database, so a timer
    // firing during another package's run would write monitor rows into the
    // middle of someone else's assertions -- the exact class of shifting,
    // meaningless failure Checkpoint 6.3 traced to concurrent database access.
    //
    // `app.runHeartbeatWatchdogOnce()` is still decorated, so a test that wants
    // the watchdog drives it deterministically rather than waiting on a clock.
    heartbeatWatchdog: { enabled: false },
    ...options,
  });
}

// Clears every table a Phase 2 route test can write to, in dependency
// order (occurrences/tasks/notes before the projects they may reference).
// DELETE rather than TRUNCATE deliberately -- TRUNCATE needs a separate
// grant beyond the least-privilege posops_app role's normal
// SELECT/INSERT/UPDATE/DELETE, and the app role never needs it in
// production either, so the test setup shouldn't need it here.
export async function truncateTestTables(app: FastifyInstance): Promise<void> {
  // Checkpoint 10.7: memories reference memory_suggestions, projects and
  // canvas_courses (all set null) -- clear them first so the singleton switch
  // and any decided suggestion never leak between tests.
  await app.db.delete(memories);
  await app.db.delete(memorySuggestions);
  await app.db.delete(memorySettings);
  await app.db.delete(occurrences);
  // FK order: event_external_links/calendar_event_instances reference
  // events and calendar_connections; calendar_connection_calendars
  // references calendar_connections -- all four must clear before the
  // rows they point at.
  await app.db.delete(eventExternalLinks);
  await app.db.delete(calendarEventInstances);
  await app.db.delete(calendarConnectionCalendars);
  await app.db.delete(calendarConnections);
  await app.db.delete(tasks);
  await app.db.delete(notes);
  await app.db.delete(events);
  await app.db.delete(projects);
  await app.db.delete(inboxItems);
  await app.db.delete(devices);
  await app.db.delete(devicePairingCodes);
  await app.db.delete(notificationDispatchLog);
  // reviews has no foreign keys -- order relative to the tables above is
  // irrelevant; kept last so future FK additions fail loudly here first.
  await app.db.delete(reviews);
  // ai_daily_briefs references ai_models (ON DELETE set null), which route
  // tests never populate, so it clears independently of everything above.
  await app.db.delete(aiDailyBriefs);
  // ai_task_routes -- Checkpoint 8.6B. Earlier AI route tests (briefs.test.ts)
  // never populated this table for real: they mock resolveModelForTask
  // entirely. Cloud Ask's tests do populate a real "ask" row (its presence IS
  // the switch, checked by a real SELECT in apps/api/src/ask/authorize.ts), so
  // it must clear between tests or a row left by one test file would silently
  // enable/disable Ask for the next one sharing this database.
  await app.db.delete(aiTaskRoutes);
  // Phase 6 health tables. FK order: every one of the five child tables
  // references health_connections (cascade), and health_sync_runs additionally
  // references health_metric_streams (set null) -- so runs clear before
  // streams, and all five before connections. health_oauth_states has no
  // foreign keys at all and clears independently.
  await app.db.delete(healthSyncRuns);
  await app.db.delete(healthObservations);
  await app.db.delete(healthSessions);
  await app.db.delete(healthDailyMetrics);
  await app.db.delete(healthMetricStreams);
  await app.db.delete(healthConnections);
  await app.db.delete(healthOauthStates);
  // Phase 7 mail tables (migration 0014). FK order: mail_sync_runs references
  // both mail_connections (cascade) and mail_sync_cursors (set null), so it
  // clears first; mail_messages and mail_sync_cursors reference
  // mail_connections; mail_connections last of that group. mail_digests
  // references ai_models (set null) and NOT mail_connections -- the digest is
  // global across mailboxes by design (ADR-053) -- so it clears independently,
  // as does mail_oauth_states, which has no foreign keys at all.
  await app.db.delete(mailSyncRuns);
  await app.db.delete(mailMessages);
  await app.db.delete(mailSyncCursors);
  await app.db.delete(mailConnections);
  await app.db.delete(mailDigests);
  await app.db.delete(mailOauthStates);
  // Phase 7 monitoring tables (migration 0015). FK order: checks and incidents
  // both reference targets with ON DELETE CASCADE, so deleting them first is not
  // strictly required -- but doing it explicitly keeps the truncation order
  // readable and independent of the cascade continuing to exist.
  await app.db.delete(monitorChecks);
  await app.db.delete(monitorIncidents);
  await app.db.delete(monitorTargets);
}
