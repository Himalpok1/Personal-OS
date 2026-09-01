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
  // Phase 6 health tables. FK order: health_sync_runs references
  // health_metric_streams (set null) and health_connections (cascade); the
  // other four child tables reference health_connections (cascade). Must match
  // apps/api/src/test/build-test-app.ts's order.
  await db.delete(healthSyncRuns);
  await db.delete(healthObservations);
  await db.delete(healthSessions);
  await db.delete(healthDailyMetrics);
  await db.delete(healthMetricStreams);
  await db.delete(healthConnections);
  await db.delete(healthOauthStates);
  // Phase 7 mail tables (migration 0014). Same FK order as
  // apps/api/src/test/build-test-app.ts: runs, then messages and cursors, then
  // connections; mail_digests and mail_oauth_states clear independently because
  // neither references mail_connections.
  await db.delete(mailSyncRuns);
  await db.delete(mailMessages);
  await db.delete(mailSyncCursors);
  await db.delete(mailConnections);
  await db.delete(mailDigests);
  await db.delete(mailOauthStates);
  // Phase 7 monitoring tables (migration 0015). Checks and incidents both
  // reference targets with ON DELETE CASCADE; deleting them explicitly keeps the
  // order readable and independent of the cascade continuing to exist.
  await db.delete(monitorChecks);
  await db.delete(monitorIncidents);
  await db.delete(monitorTargets);
}
