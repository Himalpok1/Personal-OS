import { workerHeartbeat } from "@personal-os/db";
import { HealthCheckResponseSchema, type HealthCheckResponse } from "@personal-os/schema";
import { sql } from "drizzle-orm";
import Fastify from "fastify";
import { ZodError } from "zod";
import { registerBoss } from "./plugins/boss.js";
import { registerDb } from "./plugins/db.js";
import aiConfigRoutes from "./routes/ai-config.js";
import captureRoutes from "./routes/capture.js";
import inboxRoutes from "./routes/inbox.js";
import occurrencesRoutes from "./routes/occurrences.js";

const STALE_AFTER_MS = 5 * 60_000;

export async function buildServer() {
  const app = Fastify({
    logger: {
      // AI provider routes accept API keys in the request body -- never
      // let Fastify's default request logging echo one back out.
      redact: { paths: ["req.body.api_key"], censor: "[redacted]" },
    },
  });

  registerDb(app);
  await registerBoss(app);

  app.setErrorHandler((err, request, reply) => {
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: "validation_failed", issues: err.issues });
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
  await app.register(aiConfigRoutes);

  return app;
}
