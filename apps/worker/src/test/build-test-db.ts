import {
  aiModels,
  aiProviderConnections,
  aiTaskRoutes,
  calendarConnectionCalendars,
  calendarConnections,
  calendarEventInstances,
  createDbClient,
  devices,
  eventExternalLinks,
  events,
  inboxItems,
  notificationDispatchLog,
  occurrences,
  tasks,
  type Db,
} from "@personal-os/db";
import { env } from "../env.js";

// vitest.config.ts points DATABASE_URL at TEST_DATABASE_URL before this
// module is ever imported.
export function buildTestDb(): Db {
  return createDbClient(env.DATABASE_URL);
}

export async function truncateTestTables(db: Db): Promise<void> {
  await db.delete(occurrences);
  // FK order: event_external_links/calendar_event_instances reference
  // events and calendar_connections; calendar_connection_calendars
  // references calendar_connections.
  await db.delete(eventExternalLinks);
  await db.delete(calendarEventInstances);
  await db.delete(calendarConnectionCalendars);
  await db.delete(calendarConnections);
  await db.delete(events);
  await db.delete(tasks);
  await db.delete(inboxItems);
  await db.delete(devices);
  await db.delete(notificationDispatchLog);
  // FK order: task routes reference models, models reference connections.
  await db.delete(aiTaskRoutes);
  await db.delete(aiModels);
  await db.delete(aiProviderConnections);
}
