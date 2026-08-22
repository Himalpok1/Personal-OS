import { AgendaQuerySchema } from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { buildAgendaResponse } from "../read-models/agenda.js";

export default function agendaRoutes(app: FastifyInstance): void {
  // Perimeter-only (Tailscale), like GET /today -- no device auth hook.
  // Invalid/missing tz, malformed dates, an inverted/oversized range, or a
  // malformed project_id all reject with 400 validation_failed via the
  // shared Zod error handler.
  app.get<{ Querystring: Record<string, string> }>("/agenda", async (request, reply) => {
    const query = AgendaQuerySchema.parse(request.query);
    const result = await buildAgendaResponse(app.db, query);
    if (!result.ok) {
      // Identical structured failure shape to GET /events/range -- a
      // recurrence-expansion resource limit fails the whole request rather
      // than returning a silently incomplete Agenda.
      return reply.code(400).send({
        error: "recurrence_expansion_limit_exceeded",
        event_id: result.eventId,
        limit: result.limit,
      });
    }
    return result.response;
  });
}
