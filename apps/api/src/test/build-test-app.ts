import {
  devicePairingCodes,
  devices,
  events,
  inboxItems,
  notes,
  notificationDispatchLog,
  occurrences,
  projects,
  tasks,
} from "@personal-os/db";
import type { FastifyInstance } from "fastify";
import { buildServer } from "../server.js";

// vitest.config.ts points DATABASE_URL at TEST_DATABASE_URL before this
// module (or server.ts/env.ts) is ever imported, so buildServer() here
// connects to the dedicated test database, never dev.
export async function buildTestApp(): Promise<FastifyInstance> {
  return buildServer();
}

// Clears every table a Phase 2 route test can write to, in dependency
// order (occurrences/tasks/notes before the projects they may reference).
// DELETE rather than TRUNCATE deliberately -- TRUNCATE needs a separate
// grant beyond the least-privilege posops_app role's normal
// SELECT/INSERT/UPDATE/DELETE, and the app role never needs it in
// production either, so the test setup shouldn't need it here.
export async function truncateTestTables(app: FastifyInstance): Promise<void> {
  await app.db.delete(occurrences);
  await app.db.delete(tasks);
  await app.db.delete(notes);
  await app.db.delete(events);
  await app.db.delete(projects);
  await app.db.delete(inboxItems);
  await app.db.delete(devices);
  await app.db.delete(devicePairingCodes);
  await app.db.delete(notificationDispatchLog);
}
