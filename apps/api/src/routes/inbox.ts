import { inboxItems } from "@personal-os/db";
import {
  InboxConfirmRequestSchema,
  InboxItemSchema,
  InboxListQuerySchema,
  isCommittableToolCall,
  readStoredParseResult,
  type StoredParseResult,
} from "@personal-os/schema";
import { count, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CAPTURE_PARSE_QUEUE } from "../queue-names.js";

function toInboxItemResponse(row: typeof inboxItems.$inferSelect) {
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
}

// Read-only inspection + confirmation, existing purely so the Phase 1
// curl-driven verification plan can exercise the needs_confirm path without
// reaching into psql directly (see docs/ARCHITECTURE.md's Phase 1
// description).
export default function inboxRoutes(app: FastifyInstance): void {
  // Powers the Inbox triage screen (Phase 2) -- listing captures, most
  // recent first, is the one endpoint Phase 1's curl-only verification never
  // needed (a single known inbox_id was always enough).
  app.get<{ Querystring: Record<string, string> }>("/inbox", async (request) => {
    const query = InboxListQuerySchema.parse(request.query);
    const where = query.status ? eq(inboxItems.status, query.status) : undefined;

    const [rows, totalRows] = await Promise.all([
      app.db
        .select()
        .from(inboxItems)
        .where(where)
        .orderBy(desc(inboxItems.createdAt))
        .limit(query.limit)
        .offset(query.offset),
      app.db.select({ total: count() }).from(inboxItems).where(where),
    ]);
    const total = totalRows[0]?.total ?? 0;

    return {
      items: rows.map(toInboxItemResponse),
      limit: query.limit,
      offset: query.offset,
      total,
    };
  });

  app.get<{ Params: { id: string } }>("/inbox/:id", async (request, reply) => {
    const [row] = await app.db
      .select()
      .from(inboxItems)
      .where(eq(inboxItems.id, request.params.id));
    if (!row) {
      return reply.code(404).send({ error: "not_found" });
    }
    return toInboxItemResponse(row);
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

      // Decide the tool call the worker will actually try to commit -- the
      // caller's correction when supplied, otherwise whatever the parser
      // stored -- and refuse here if committing it is impossible.
      //
      // Checkpoint 8.4 exists because this check did not. `unclear` is a
      // valid stored parse result but has no entity to create, so confirming
      // one returned 202, enqueued a job that threw on every one of its five
      // attempts, and left the item exactly as it was. The user saw a button
      // return to its idle state and nothing else. Refusing before the
      // enqueue is what makes the 202 mean "a commit will be attempted".
      const stored = readStoredParseResult(row.parseResult);
      const effectiveToolCall = body.corrected_tool_call ?? stored?.toolCall;
      if (!effectiveToolCall) {
        return reply.code(409).send({ error: "parse_result_unreadable" });
      }
      if (!isCommittableToolCall(effectiveToolCall)) {
        // `tool` is a closed enum member, never model prose -- the `unclear`
        // tool's own `reason` argument is derived from the capture text and
        // is deliberately not echoed.
        return reply
          .code(409)
          .send({ error: "parse_result_not_committable", tool: effectiveToolCall.tool });
      }

      if (body.corrected_tool_call !== undefined) {
        // Write the shape the worker reads (`parse_result.toolCall`). This
        // previously stored the bare tool call, so a correction made the row
        // UNREADABLE to runConfirm and turned the documented escape hatch
        // from an unclear parse into a second silent failure.
        const corrected: StoredParseResult = {
          toolCall: body.corrected_tool_call,
          confidenceFlags: stored?.confidenceFlags ?? [],
        };
        await app.db
          .update(inboxItems)
          .set({ parseResult: corrected })
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
