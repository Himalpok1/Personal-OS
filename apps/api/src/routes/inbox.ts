import { inboxItems } from "@personal-os/db";
import { InboxConfirmRequestSchema, InboxItemSchema } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CAPTURE_PARSE_QUEUE } from "../queue-names.js";

// Read-only inspection + confirmation, existing purely so the Phase 1
// curl-driven verification plan can exercise the needs_confirm path without
// reaching into psql directly (see docs/ARCHITECTURE.md's Phase 1
// description).
export default function inboxRoutes(app: FastifyInstance): void {
  app.get<{ Params: { id: string } }>("/inbox/:id", async (request, reply) => {
    const [row] = await app.db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, request.params.id));
    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }
    return InboxItemSchema.parse({
      id: row.id,
      client_uuid: row.clientUuid,
      raw_text: row.rawText,
      source: row.source,
      captured_at: row.capturedAt.toISOString(),
      timezone: row.timezone,
      status: row.status,
      parse_result: row.parseResult,
      confidence: row.confidence,
      entity_type: row.entityType,
      entity_id: row.entityId,
      created_at: row.createdAt.toISOString(),
    });
  });

  // The API never creates entities inline (see docs/ARCHITECTURE.md: "The
  // API never performs the work inline, only enqueues"). Confirming just
  // (optionally) overwrites parse_result with a correction, then re-enqueues
  // capture.parse in "confirm" mode -- the worker owns entity creation in
  // exactly one place, whether auto-committed or user-confirmed.
  app.post<{ Params: { id: string }; Body: unknown }>(
    "/inbox/:id/confirm",
    async (request, reply) => {
      const body = InboxConfirmRequestSchema.parse(request.body ?? {});
      const [row] = await app.db
        .select()
        .from(inboxItems)
        .where(eq(inboxItems.id, request.params.id));
      if (!row) {
        return reply.code(404).send({ error: "not_found" });
      }
      if (row.status !== "needs_confirm") {
        return reply.code(409).send({ error: "not_awaiting_confirmation", status: row.status });
      }

      if (body.corrected_tool_call !== undefined) {
        await app.db
          .update(inboxItems)
          .set({ parseResult: body.corrected_tool_call })
          .where(eq(inboxItems.id, row.id));
      }

      if (!app.bossReady) {
        return reply.code(503).send({ error: "job_queue_unavailable" });
      }
      await app.boss.send(
        CAPTURE_PARSE_QUEUE,
        { inboxId: row.id, mode: "confirm" },
        { singletonKey: `${row.id}:confirm` },
      );

      return reply.code(202).send({ inbox_id: row.id, status: "confirming" });
    },
  );
}
