import { createGmailClient, type MailClient } from "@personal-os/mail-providers";
import type { FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyInstance {
    gmailClient: MailClient;
  }
}

// Decorated rather than constructed inline inside mail-connections.ts, so route
// tests can inject the scripted fake through buildTestApp's options and never
// make a real call to Gmail from an `.inject()` suite. Exactly the seam
// registerGoogleHealthClient and registerGoogleCalendarClient establish.
export function registerGmailClient(app: FastifyInstance, client?: MailClient): void {
  app.decorate("gmailClient", client ?? createGmailClient());
}
