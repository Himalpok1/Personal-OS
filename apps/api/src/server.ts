import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import { workerHeartbeat } from "@personal-os/db";
import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { env } from "./env.js";
import { registerBoss } from "./plugins/boss.js";
import { registerDb } from "./plugins/db.js";
import aiConfigRoutes from "./routes/ai-config.js";
import captureRoutes from "./routes/capture.js";
import devicesRoutes from "./routes/devices.js";
import inboxRoutes from "./routes/inbox.js";
import notesRoutes from "./routes/notes.js";
import occurrencesRoutes from "./routes/occurrences.js";
import projectsRoutes from "./routes/projects.js";
import tasksRoutes from "./routes/tasks.js";
import transcribeRoutes from "./routes/transcribe.js";

const STALE_AFTER_MS = 5 * 60_000;

export async function buildServer() {
  const app = Fastify({
    logger: {
      // AI provider routes accept API keys in the request body, and
      // devices routes accept a bearer token in the Authorization header --
      // never let Fastify's default request logging echo either back out.
      redact: { paths: ["req.body.api_key", "req.headers.authorization"], censor: "[redacted]" },
    },
  });

  registerDb(app);
  await registerBoss(app);
  // Scoped to exactly the known web origins (WEB_APP_ORIGIN) -- no
  // wildcard. apps/mobile's web build is the only browser client; curl and
  // the worker never send an Origin header, so they're unaffected either
  // way.
  await app.register(cors, { origin: env.WEB_APP_ORIGIN });
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
  await app.register(aiConfigRoutes);
  await app.register(devicesRoutes);
  await app.register(transcribeRoutes);

  return app;
}
