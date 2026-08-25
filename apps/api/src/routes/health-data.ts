import {
  HealthSeriesQuerySchema,
  HealthSessionRangeQuerySchema,
  HealthSummaryQuerySchema,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import {
  buildHealthSeries,
  buildHealthSummary,
  HealthMetricNotReadableError,
  listSleepSessions,
  listWorkoutSessions,
} from "../read-models/health-dashboard.js";

// The user-facing Health read surface (Phase 6 Checkpoint 6.4).
//
// Every path is a `/health-*` SIBLING rather than a child of `/health`:
// GET /health is already the liveness probe, and nesting under it would put
// dashboard reads behind the one route that must stay trivially cheap and
// unauthenticated-by-perimeter. Recorded at Checkpoint 6.0 and mirrored by
// packages/schema/src/health-metrics.ts's own naming.
//
// Perimeter-only (Tailscale), like /today, /agenda and /health-connections --
// no device-auth hook, deliberately. These are read routes over data the
// perimeter already governs.
//
// Every handler is thin on purpose: parse the query, hand it to the read model,
// return what comes back. The read model has already parsed its own response
// through the frozen schema, so nothing here can widen the contract.
export default function healthDataRoutes(app: FastifyInstance): void {
  // Malformed or missing tz rejects as 400 validation_failed through the shared
  // Zod error handler in server.ts -- not re-implemented per route.
  app.get<{ Querystring: Record<string, string> }>("/health-summary", async (request) => {
    const query = HealthSummaryQuerySchema.parse(request.query);
    return buildHealthSummary(app.db, { tz: query.tz });
  });

  // An inverted range, one longer than HEALTH_MAX_RANGE_DAYS, or a malformed
  // date is likewise a 400 from the schema's own superRefine.
  app.get<{ Querystring: Record<string, string> }>("/health-metrics", async (request, reply) => {
    const query = HealthSeriesQuerySchema.parse(request.query);
    try {
      return await buildHealthSeries(app.db, query);
    } catch (err) {
      if (err instanceof HealthMetricNotReadableError) {
        // Static code, no metric name echoed back in a message: the client
        // already knows what it asked for, and a reflected string is one more
        // thing that can end up rendered.
        return reply.code(400).send({ error: "metric_not_readable" });
      }
      throw err;
    }
  });

  app.get<{ Querystring: Record<string, string> }>("/health-sleep", async (request) => {
    const query = HealthSessionRangeQuerySchema.parse(request.query);
    return listSleepSessions(app.db, query);
  });

  app.get<{ Querystring: Record<string, string> }>("/health-workouts", async (request) => {
    const query = HealthSessionRangeQuerySchema.parse(request.query);
    return listWorkoutSessions(app.db, query);
  });
}
