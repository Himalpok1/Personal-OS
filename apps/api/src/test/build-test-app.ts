import {
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  devicePairingCodes,
  devices,
  eventExternalLinks,
  events,
  inboxItems,
  notes,
  notificationDispatchLog,
  occurrences,
  projects,
  tasks,
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
  return buildServer(options);
}

// Clears every table a Phase 2 route test can write to, in dependency
// order (occurrences/tasks/notes before the projects they may reference).
// DELETE rather than TRUNCATE deliberately -- TRUNCATE needs a separate
// grant beyond the least-privilege posops_app role's normal
// SELECT/INSERT/UPDATE/DELETE, and the app role never needs it in
// production either, so the test setup shouldn't need it here.
export async function truncateTestTables(app: FastifyInstance): Promise<void> {
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
}
