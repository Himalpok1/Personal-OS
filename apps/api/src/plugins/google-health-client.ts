import { createGoogleHealthClient, type GoogleHealthClient } from "@personal-os/health-providers";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    googleHealthClient: GoogleHealthClient;
  }
}

// Decorated rather than constructed inline inside health-connections.ts, so
// route tests can inject the in-memory fake through buildTestApp's options and
// never make a real call to the live Google Health API from an `.inject()`
// suite. Exactly the seam registerGoogleCalendarClient already establishes.
export function registerGoogleHealthClient(
  app: FastifyInstance,
  client?: GoogleHealthClient,
): void {
  app.decorate("googleHealthClient", client ?? createGoogleHealthClient());
}
