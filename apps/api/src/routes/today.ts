import { TodayQuerySchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { buildTodayResponse } from "../read-models/today.js";

export default function todayRoutes(app: FastifyInstance): void {
  // Perimeter-only (Tailscale), like every non-device route -- no device
  // auth hook. Invalid/missing tz rejects with 400 validation_failed via
  // the shared Zod error handler.
  app.get<{ Querystring: Record<string, string> }>("/today", async (request) => {
    const query = TodayQuerySchema.parse(request.query);
    return buildTodayResponse(app.db, query);
  });
}
