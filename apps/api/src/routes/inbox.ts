import { hasCommittableRecurrence } from "@personal-os/core";
import { inboxItems } from "@personal-os/db";
import {
  InboxArchiveResponseSchema,
  InboxConfirmRequestSchema,
  InboxItemSchema,
  InboxListQuerySchema,
  isCommittableToolCall,
  readStoredParseResult,
  type StoredParseResult,
} from "@personal-os/schema";
import { and, count, desc, eq, isNull } from "drizzle-orm";
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
    archived_at: row.archivedAt ? row.archivedAt.toISOString() : null,
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
    // Archived rows are hidden by default (Checkpoint 9.3), the same
    // `include_archived` convention every other archivable list uses.
    const where = and(
      query.status ? eq(inboxItems.status, query.status) : undefined,
      query.include_archived ? undefined : isNull(inboxItems.archivedAt),
    );

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

  // Archive (Checkpoint 9.3, migration 0017). A dedicated action route, never
  // a generic PATCH, per ADR-039's rule for state changes. Archiving is the
  // ONLY way a capture leaves the Inbox screen and the Today attention counts:
  // an inbox row is the durable record of a capture (ADR-021) and the anchor
  // its committed entity hangs off, so it is never deleted, and the entity it
  // committed is never touched. Any status may be archived -- a `parsed` row
  // the owner has looked at, a `failed` row they have given up on, a
  // `needs_confirm` row they no longer want to answer.
  //
  // Idempotent by construction: the UPDATE is conditional on `archived_at IS
  // NULL`, so a retry (the outbox replays writes) matches zero rows and the
  // response echoes the instant the FIRST call stamped, never a fresh one.
  app.post<{ Params: { id: string } }>("/inbox/:id/archive", async (request, reply) => {
    const [updated] = await app.db
      .update(inboxItems)
      .set({ archivedAt: new Date() })
      .where(and(eq(inboxItems.id, request.params.id), isNull(inboxItems.archivedAt)))
      .returning({ id: inboxItems.id, archivedAt: inboxItems.archivedAt });
    const row =
      updated ??
      (
        await app.db
          .select({ id: inboxItems.id, archivedAt: inboxItems.archivedAt })
          .from(inboxItems)
          .where(eq(inboxItems.id, request.params.id))
      )[0];
    if (!row?.archivedAt) {
      return reply.code(404).send({ error: "not_found" });
    }
    return InboxArchiveResponseSchema.parse({
      id: row.id,
      archived_at: row.archivedAt.toISOString(),
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
      // `failed` is confirmable too (Checkpoint 9.3, "D4-min"): a capture
      // whose parse exhausted its retries -- or that had no provider at all --
      // is exactly the row the owner most needs a route back for, and the
      // dead-letter handler deliberately PRESERVES its stored tool call so
      // that route exists. `parsed`/`confirmed` already have an entity;
      // `pending` is still in flight; both stay refused.
      if (row.status !== "needs_confirm" && row.status !== "failed") {
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
      //
      // Checkpoint 9.3 adds the second half of that question: a `create_task`
      // whose rrule does not parse ("every monday" is a real shape the model
      // emits -- CreateTaskToolSchema leaves rrule a bare string) or whose
      // recurrence_timezone Intl does not know. The worker's commit now
      // refuses such a call before writing a single row, and a retry
      // recomputes the same refusal, so accepting it here would again be a
      // 202 for work that can only fail. `hasCommittableRecurrence` judges
      // exactly the rule the commit would materialize (same defaulting, same
      // capture timezone) and is deliberately a bare boolean: the refusal
      // stays token-only -- the rule text is model output and is never
      // echoed, only the tool enum member.
      if (
        !isCommittableToolCall(effectiveToolCall) ||
        !hasCommittableRecurrence(effectiveToolCall, row.timezone)
      ) {
        // `tool` is a closed enum member, never model prose -- the `unclear`
        // tool's own `reason` argument is derived from the capture text and
        // is deliberately not echoed.
        return reply
          .code(409)
          .send({ error: "parse_result_not_committable", tool: effectiveToolCall.tool });
      }

      // A `failed` row changes STATUS on confirm, so the queue check moves
      // ahead of every write here: a 503 must leave the row exactly as found,
      // and the pre-9.3 order (write, then check) was tolerable only because a
      // correction is harmless to leave behind, whereas a `needs_confirm`
      // stamp with no job to consume it would strand the row a second time.
      if (!app.bossReady) {
        return reply.code(503).send({ error: "job_queue_unavailable" });
      }

      if (body.corrected_tool_call !== undefined || row.status === "failed") {
        // Write the shape the worker reads (`parse_result.toolCall`). This
        // previously stored the bare tool call, so a correction made the row
        // UNREADABLE to runConfirm and turned the documented escape hatch
        // from an unclear parse into a second silent failure.
        //
        // A `failed` row is rewritten even without a correction: the
        // dead-letter marker (`parse_result.failure`) describes a terminal
        // state the row is now leaving, and the worker's confirm path is
        // keyed on `status = 'needs_confirm'` -- so the row is moved back to
        // `needs_confirm` here, with a clean stored result, and the existing
        // worker commits it exactly as it would any other confirmation. If
        // the commit exhausts its retries again, the dead-letter handler
        // finalizes it as `failed` afresh with a new marker.
        const rewritten: StoredParseResult = {
          toolCall: effectiveToolCall,
          confidenceFlags: stored?.confidenceFlags ?? [],
        };
        await app.db
          .update(inboxItems)
          .set({ parseResult: rewritten, status: "needs_confirm" })
          .where(eq(inboxItems.id, row.id));
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
