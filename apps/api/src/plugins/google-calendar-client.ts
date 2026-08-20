import {
  createGoogleCalendarClient,
  type GoogleCalendarClient,
} from "@personal-os/calendar-providers";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    googleCalendarClient: GoogleCalendarClient;
  }
}

// Decorated (same pattern as registerDb/registerBoss) rather than
// constructed inline inside calendar-connections.ts, so route tests can
// inject a fake client (buildTestApp's params) instead of ever making a
// real call to the live Google API from a `.inject()` suite.
export function registerGoogleCalendarClient(
  app: FastifyInstance,
  client?: GoogleCalendarClient,
): void {
  app.decorate("googleCalendarClient", client ?? createGoogleCalendarClient());
}
