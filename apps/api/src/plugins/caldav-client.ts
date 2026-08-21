import { createCalDavClient, type CalDavClient } from "@personal-os/calendar-providers";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    caldavClient: CalDavClient;
  }
}

export function registerCalDavClient(app: FastifyInstance, client?: CalDavClient): void {
  app.decorate("caldavClient", client ?? createCalDavClient());
}
