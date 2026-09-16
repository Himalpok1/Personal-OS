import { canvasConnections, canvasSyncRuns } from "@personal-os/db";
import {
  CanvasConnectRequestSchema,
  CanvasConnectionSchema,
  CanvasConnectionsListResponseSchema,
  CanvasSyncRunsResponseSchema,
  CanvasSyncTokenSchema,
  CanvasSyncTriggerResponseSchema,
} from "@personal-os/schema";
import { asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { CANVAS_SYNC_CONNECTION_QUEUE } from "../queue-names.js";
import {
  CanvasAccountMismatchError,
  CanvasAlreadyConnectedError,
  CanvasAuthFailedError,
  CanvasUrlBlockedForConnectError,
  connectCanvasConnection,
  disconnectCanvasConnection,
  type CanvasConnectionRow,
} from "../services/canvas-connection.js";

// Canvas LMS connection routes (ADR-068, Checkpoint 10.1).
//
// Tailscale-perimeter-only, like mail-connections.ts and
// health-connections.ts -- no device-token hook. Every response shape is
// Zod-parsed on the way out, and none of those shapes can express a token:
// the credential columns simply have no counterpart in CanvasConnectionSchema.

type SyncRunRow = typeof canvasSyncRuns.$inferSelect;

/**
 * Neutralizes a `last_sync_error`/`failure_class`/`error_message` value that
 * does not match the token shape (`CanvasSyncTokenSchema`) rather than
 * crashing on it.
 *
 * `packages/schema/src/canvas.ts` exports the SHAPE (a Zod schema used to
 * validate a value being written) but not a sanitizer for reading one back,
 * unlike `sanitizeMailSyncErrorCode`/`sanitizeHealthSyncErrorToken`. This is
 * the read-side counterpart, built on the SAME exported schema rather than
 * re-deriving the regex, so a row written by an older or buggier build is
 * still safe to serve with no data migration -- the identical defense in
 * depth the mail/health sanitizers document.
 */
function sanitizeCanvasSyncToken(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined || raw === "") return null;
  return CanvasSyncTokenSchema.safeParse(raw).success ? raw : "provider_error";
}

/**
 * The safe wire projection of a Canvas connection.
 *
 * ENCRYPTED COLUMNS ARE NOT MENTIONED HERE AT ALL -- not omitted from a
 * spread, not filtered out, simply never read. Combined with
 * CanvasConnectionSchema.parse, which is a non-passthrough (`.strict()`)
 * object schema, a ciphertext/iv/auth-tag column is structurally incapable
 * of reaching the wire. Mirrors `mail-connections.ts`'s
 * `toConnectionResponse` exactly.
 */
function toConnectionResponse(row: CanvasConnectionRow) {
  return CanvasConnectionSchema.parse({
    id: row.id,
    canvas_base_url: row.canvasBaseUrl,
    canvas_user_id: row.canvasUserId,
    canvas_user_name: row.canvasUserName,
    status: row.status,
    last_sync_at: row.lastSyncAt?.toISOString() ?? null,
    last_sync_error: sanitizeCanvasSyncToken(row.lastSyncError),
    last_sync_error_at: row.lastSyncErrorAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function toSyncRunResponse(row: SyncRunRow) {
  return {
    id: row.id,
    connection_id: row.connectionId,
    kind: row.kind,
    status: row.status,
    started_at: row.startedAt.toISOString(),
    finished_at: row.finishedAt?.toISOString() ?? null,
    courses_synced: row.coursesSynced,
    assignments_synced: row.assignmentsSynced,
    announcements_synced: row.announcementsSynced,
    events_synced: row.eventsSynced,
    failure_class: sanitizeCanvasSyncToken(row.failureClass),
    error_message: sanitizeCanvasSyncToken(row.errorMessage),
  };
}

/**
 * Maps a service failure to a status code and a STATIC error string.
 *
 * Nothing from Canvas's own error body is ever forwarded -- `CanvasApiError`
 * (packages/canvas-providers) already destroys it at construction, and
 * `CanvasAuthFailedError`'s own message is this project's static prose, never
 * anything Canvas said. Mirrors `mail-connections.ts`/`health-connections.ts`'s
 * `replyForError` exactly.
 */
function replyForError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof CanvasAuthFailedError) {
    return { status: 400, body: { error: "canvas_auth_failed" } };
  }
  if (err instanceof CanvasAlreadyConnectedError) {
    return { status: 409, body: { error: "canvas_already_connected" } };
  }
  if (err instanceof CanvasAccountMismatchError) {
    return { status: 409, body: { error: "canvas_account_mismatch" } };
  }
  if (err instanceof CanvasUrlBlockedForConnectError) {
    return { status: 400, body: { error: "canvas_url_blocked" } };
  }
  return null;
}

export default function canvasConnectionsRoutes(app: FastifyInstance): void {
  // ---- connect ------------------------------------------------------------
  app.post("/canvas-connections", async (request, reply) => {
    try {
      const body = CanvasConnectRequestSchema.parse(request.body);
      const result = await connectCanvasConnection({
        db: app.db,
        client: app.canvasClient,
        baseUrl: body.base_url,
        token: body.personal_access_token,
      });
      // 201 for a genuinely new connection, 200 when this call REACTIVATED a
      // prior disconnected/invalid_token row -- mirrors
      // routes/mail-connections.ts's identical `result.created ? 201 : 200`
      // for completeGmailConnection. The client only ever checks `response.ok`
      // (packages/api-client/src/client.ts's fetchJson), so this is purely an
      // honest wire signal, not a compatibility requirement.
      const status = result.created ? 201 : 200;
      return reply.code(status).send(toConnectionResponse(result.connection));
    } catch (err) {
      const mapped = replyForError(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  // ---- read -----------------------------------------------------------
  app.get("/canvas-connections", async () => {
    const rows = await app.db
      .select()
      .from(canvasConnections)
      .orderBy(asc(canvasConnections.createdAt));
    return CanvasConnectionsListResponseSchema.parse({
      // Unlike Gmail/Google Health, Canvas needs no server-side OAuth client
      // configuration at all -- the credential is a PAT the owner pastes
      // directly into the connect request, so this server can always attempt
      // a connection. `configured` is reported for wire-shape parity with the
      // other two connection list endpoints, not because there is a
      // not-configured state to report.
      configured: true,
      items: rows.map(toConnectionResponse),
    });
  });

  app.get<{ Params: { id: string } }>("/canvas-connections/:id", async (request, reply) => {
    const [row] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, request.params.id))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(toConnectionResponse(row));
  });

  // ---- disconnect -----------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/canvas-connections/:id/disconnect",
    async (request, reply) => {
      const [row] = await app.db
        .select()
        .from(canvasConnections)
        .where(eq(canvasConnections.id, request.params.id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "not_found" });

      // Idempotent by construction: re-disconnecting an already-disconnected
      // row just re-writes the same status.
      const updated = await disconnectCanvasConnection(app.db, row);
      return reply.send(toConnectionResponse(updated));
    },
  );

  // ---- sync -------------------------------------------------------------
  // Enqueues ONE connection-level job; never runs a sync inline. Mirrors
  // POST /health-connections/:id/sync exactly, including WHY upsert rather
  // than a plain send: under the queue's `policy: "stately"` (queue-names.ts)
  // a plain send is suppressed to null when a job is already queued for this
  // connection, which would silently drop the caller's manual "sync now"
  // behind whatever triggered the queued job first. `boss.upsert` edits that
  // queued job's payload in place instead, so a manual request always wins
  // and can never be silently downgraded. `startAfter: 0` is explicit because
  // `updateJob` otherwise inherits the existing row's `start_after`.
  app.post<{ Params: { id: string } }>("/canvas-connections/:id/sync", async (request, reply) => {
    const [connection] = await app.db
      .select()
      .from(canvasConnections)
      .where(eq(canvasConnections.id, request.params.id))
      .limit(1);
    if (!connection) return reply.code(404).send({ error: "not_found" });
    if (connection.status !== "active") {
      return reply.code(409).send({ error: "connection_not_active", status: connection.status });
    }
    if (!app.bossReady) return reply.code(503).send({ error: "queue_unavailable" });

    // `kind`, not `trigger`: apps/worker's `CanvasSyncJobData`
    // (apps/worker/src/canvas/orchestrate.ts) reads `data.kind`, matching
    // `CanvasSyncRunKindSchema`'s ("manual" | "cron") vocabulary -- the value
    // this route persists as `canvas_sync_runs.kind` end to end.
    const payload = { connectionId: connection.id, kind: "manual" as const };
    const options = { singletonKey: connection.id, startAfter: 0 };

    const result = await app.boss.upsert(CANVAS_SYNC_CONNECTION_QUEUE, payload, options);
    let queuedCount = result.updated + result.inserted;
    if (queuedCount === 0) {
      // Possible when the conflicting row is activated between the match and
      // the update. A plain send then creates a fresh `created` row, which
      // `stately` permits alongside the now-active one.
      const id = await app.boss.send(CANVAS_SYNC_CONNECTION_QUEUE, payload, options);
      queuedCount = id === null ? 0 : 1;
    }
    return reply.code(202).send(CanvasSyncTriggerResponseSchema.parse({ queued: queuedCount > 0 }));
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/canvas-connections/:id/sync-runs",
    async (request, reply) => {
      const [connection] = await app.db
        .select()
        .from(canvasConnections)
        .where(eq(canvasConnections.id, request.params.id))
        .limit(1);
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const parsed = Number.parseInt(request.query.limit ?? "50", 10);
      const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;

      const rows = await app.db
        .select()
        .from(canvasSyncRuns)
        .where(eq(canvasSyncRuns.connectionId, connection.id))
        .orderBy(desc(canvasSyncRuns.startedAt))
        .limit(limit);

      return reply.send(CanvasSyncRunsResponseSchema.parse({ items: rows.map(toSyncRunResponse) }));
    },
  );
}
