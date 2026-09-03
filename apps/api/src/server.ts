import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import type { CalDavClient, GoogleCalendarClient } from "@personal-os/calendar-providers";
import type { GoogleHealthClient } from "@personal-os/health-providers";
import type { MailClient } from "@personal-os/mail-providers";
import { workerHeartbeat } from "@personal-os/db";
import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./env.js";
import { registerBoss } from "./plugins/boss.js";
import { registerCalDavClient } from "./plugins/caldav-client.js";
import { registerDb } from "./plugins/db.js";
import { registerGoogleCalendarClient } from "./plugins/google-calendar-client.js";
import { registerGoogleHealthClient } from "./plugins/google-health-client.js";
import { registerGmailClient } from "./plugins/gmail-client.js";
import {
  registerHeartbeatWatchdog,
  type HeartbeatWatchdogOptions,
} from "./plugins/heartbeat-watchdog.js";
import { buildLoggerOptions } from "./logging/logger-options.js";
import agendaRoutes from "./routes/agenda.js";
import briefsRoutes from "./routes/briefs.js";
import aiConfigRoutes from "./routes/ai-config.js";
import calendarConnectionsRoutes from "./routes/calendar-connections.js";
import healthConnectionsRoutes from "./routes/health-connections.js";
import healthDataRoutes from "./routes/health-data.js";
import mailConnectionsRoutes from "./routes/mail-connections.js";
import mailDigestsRoutes from "./routes/mail-digests.js";
import monitorRoutes from "./routes/monitor.js";
import captureRoutes from "./routes/capture.js";
import devicesRoutes from "./routes/devices.js";
import eventsRoutes from "./routes/events.js";
import exportRoutes from "./routes/export.js";
import inboxRoutes from "./routes/inbox.js";
import notesRoutes from "./routes/notes.js";
import searchRoutes from "./routes/search.js";
import occurrencesRoutes from "./routes/occurrences.js";
import projectsRoutes from "./routes/projects.js";
import reviewsRoutes from "./routes/reviews.js";
import tasksRoutes from "./routes/tasks.js";
import todayRoutes from "./routes/today.js";
import transcribeRoutes from "./routes/transcribe.js";

const STALE_AFTER_MS = 5 * 60_000;

export interface BuildServerOptions {
  // Tests only -- see plugins/google-calendar-client.ts's doc comment.
  // Production (index.ts) never passes this, so the real client is always
  // used outside a test suite.
  googleCalendarClient?: GoogleCalendarClient;
  caldavClient?: CalDavClient;
  googleHealthClient?: GoogleHealthClient;
  /**
   * The worker-heartbeat watchdog's interval (Checkpoint 7.5, ADR-055).
   *
   * ON by default, because a monitoring feature that is off unless someone
   * remembers is a footgun. `buildTestApp` disables it: a timer firing against
   * the shared test database during another package's suite is exactly the
   * cross-contamination Checkpoint 6.3 traced its shifting failures to.
   */
  heartbeatWatchdog?: HeartbeatWatchdogOptions;
  gmailClient?: MailClient;
}

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: buildLoggerOptions(),
  });

  registerDb(app);
  await registerBoss(app);
  registerGoogleCalendarClient(app, options.googleCalendarClient);
  registerCalDavClient(app, options.caldavClient);
  registerGoogleHealthClient(app, options.googleHealthClient);
  registerGmailClient(app, options.gmailClient);
  // AFTER registerDb and registerBoss: the watchdog reads app.db and app.boss.
  registerHeartbeatWatchdog(app, options.heartbeatWatchdog ?? {});
  // Scoped to exactly the known web origins (WEB_APP_ORIGIN) -- no
  // wildcard. apps/mobile's web build is the only browser client; curl and
  // the worker never send an Origin header, so they're unaffected either
  // way. `@fastify/cors`'s own default `methods` is `GET,HEAD,POST` (not
  // the wider `cors` package default most people assume) -- left implicit,
  // this silently blocked every PATCH/DELETE preflight from the web client
  // API-wide (archive/update actions), invisible to curl-based verification
  // since curl never sends preflights. Found via the web browser in
  // Checkpoint 4.2 (see docs/STATUS.md).
  await app.register(cors, {
    origin: env.WEB_APP_ORIGIN,
    methods: ["GET", "HEAD", "POST", "PATCH", "DELETE"],
  });
  await app.register(multipart);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_failed", issues: err.issues });
    }
    // Framework-level 4xx errors (malformed JSON, an empty body claimed as
    // application/json, an unsupported content-type, etc.) are the
    // client's fault, not an unhandled server error -- coercing them all
    // to 500 hides genuinely actionable client bugs behind "internal_error"
    // (this is exactly what surfaced the api-client Content-Type bug during
    // Phase 2's UI verification: a real 400 was being reported as a 500).
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      typeof err.statusCode === "number" &&
      err.statusCode >= 400 &&
      err.statusCode < 500
    ) {
      const code = "code" in err && typeof err.code === "string" ? err.code : "bad_request";
      return reply.code(err.statusCode).send({ error: code });
    }
    request.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: "internal_error" });
  });

  app.get("/health", async (): Promise<HealthCheckResponse> => {
    let dbStatus: HealthCheckResponse["db"] = "unreachable";
    let lastBeatAt: string | null = null;

    try {
      await app.db.execute(sql`select 1`);
      dbStatus = "connected";

      const [row] = await app.db.select().from(workerHeartbeat).limit(1);
      if (row?.lastBeatAt) {
        lastBeatAt = row.lastBeatAt.toISOString();
      }
    } catch (err) {
      app.log.warn({ err }, "health check: database unreachable");
    }

    const stale =
      lastBeatAt === null || Date.now() - new Date(lastBeatAt).getTime() > STALE_AFTER_MS;

    return HealthCheckResponseSchema.parse({
      status: dbStatus === "connected" ? "ok" : "degraded",
      db: dbStatus,
      worker: { lastBeatAt, stale },
    } satisfies HealthCheckResponse);
  });

  await app.register(captureRoutes);
  await app.register(inboxRoutes);
  await app.register(occurrencesRoutes);
  await app.register(tasksRoutes);
  await app.register(notesRoutes);
  await app.register(projectsRoutes);
  await app.register(reviewsRoutes);
  await app.register(eventsRoutes);
  await app.register(todayRoutes);
  await app.register(agendaRoutes);
  await app.register(briefsRoutes);
  await app.register(calendarConnectionsRoutes);
  await app.register(healthConnectionsRoutes);
  await app.register(healthDataRoutes);
  await app.register(mailConnectionsRoutes);
  await app.register(mailDigestsRoutes);
  await app.register(monitorRoutes);
  await app.register(aiConfigRoutes);
  await app.register(devicesRoutes);
  await app.register(transcribeRoutes);
  await app.register(searchRoutes);
  await app.register(exportRoutes);

  return app;
}
