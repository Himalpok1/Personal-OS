import { SearchQuerySchema, type SearchResponse } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { buildSearchResponse } from "../read-models/search.js";

export default function searchRoutes(app: FastifyInstance): void {
  // Perimeter-only (Tailscale), like /today, /agenda and /health-metrics -- no
  // device-auth hook, deliberately. This is a read route over data the
  // perimeter already governs, and it exposes no row that GET /tasks,
  // GET /notes or GET /inbox does not already expose to the same callers.
  //
  // A missing, empty, whitespace-only, too-short, too-long or unknown query
  // parameter all reject with 400 validation_failed through the shared Zod
  // error handler. Nothing here can 5xx on user input, so no explicit 5xx reply
  // is needed (setErrorHandler only passes a thrown 4xx through).
  app.get<{ Querystring: Record<string, string> }>(
    "/search",
    async (request): Promise<SearchResponse> => {
      const query = SearchQuerySchema.parse(request.query);
      return buildSearchResponse(app.db, query);
    },
  );
}
