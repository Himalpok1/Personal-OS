import {
  CanvasConnectionSchema,
  CanvasConnectionsListResponseSchema,
  CanvasSyncRunsResponseSchema,
  CanvasSyncTriggerResponseSchema,
  CanvasUpcomingAssignmentsResponseSchema,
  type CanvasConnectRequest,
  type CanvasConnection,
  type CanvasConnectionsListResponse,
  type CanvasSyncRun,
  type CanvasSyncRunsResponse,
  type CanvasSyncTriggerResponse,
  type CanvasUpcomingAssignmentsResponse,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// Checkpoint 10.1 (ADR-068) -- Canvas LMS integration: connection lifecycle,
// a manual sync trigger, and the sync-run audit trail. No message, course,
// assignment or announcement CRUD lives here, and never will: this
// integration is read-only against Canvas by construction --
// `packages/canvas-providers`'s client implements only `GET` methods, so
// there is no write route this file could ever bind to (ADR-068 §6).
//
// Named listCanvas*/getCanvas*/connectCanvas* etc., mirroring the
// listMail*/getMail*/connectGmail* convention `mail.ts` adopted for the
// identical reason: `createApiClient()` (./index.ts) is one flat method bag,
// not a canvas.list()/mail.list() namespace, so a bare list()/get() here
// would collide with every other provider's own method of the same bare
// name.

export type {
  CanvasConnectRequest,
  CanvasConnection,
  CanvasConnectionsListResponse,
  CanvasSyncRun,
  CanvasSyncRunsResponse,
  CanvasSyncTriggerResponse,
  CanvasUpcomingAssignmentsResponse,
};

export async function listCanvasConnections(
  baseUrl: string,
): Promise<CanvasConnectionsListResponse> {
  return await fetchJson(baseUrl, "/canvas-connections", CanvasConnectionsListResponseSchema);
}

export async function getCanvasConnection(baseUrl: string, id: string): Promise<CanvasConnection> {
  return await fetchJson(
    baseUrl,
    `/canvas-connections/${encodeURIComponent(id)}`,
    CanvasConnectionSchema,
  );
}

/**
 * The owner's one-time Canvas connection: their Canvas instance's base URL
 * plus a Personal Access Token (ADR-068 §2).
 *
 * Unlike every OAuth `connect*` method in this package (`connectGmail`,
 * `connectGoogleCalendar`), there is no authorize URL, no redirect and no
 * single-use state token to round-trip first -- a Canvas PAT is pasted once
 * and sent directly in the body, matching `CanvasConnectRequestSchema`'s two
 * fields verbatim (`base_url`, the owner's own Canvas instance, e.g.
 * `https://uta.instructure.com`; `personal_access_token`).
 */
export async function connectCanvas(
  baseUrl: string,
  body: CanvasConnectRequest,
): Promise<CanvasConnection> {
  return await fetchJson(baseUrl, "/canvas-connections", CanvasConnectionSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

/**
 * Disconnects a Canvas connection.
 *
 * Unlike `disconnectMailConnection`, the response carries no `revoked` flag:
 * a Personal Access Token has no server-side revocation call this app can
 * make on the owner's behalf (ADR-068 §2 -- Canvas either accepts a token or
 * it does not, and there is no OAuth grant to revoke), so disconnecting only
 * ever clears the stored credential and flips `status` locally. The updated
 * connection is the whole response.
 */
export async function disconnectCanvasConnection(
  baseUrl: string,
  id: string,
): Promise<CanvasConnection> {
  return await fetchJson(
    baseUrl,
    `/canvas-connections/${encodeURIComponent(id)}/disconnect`,
    CanvasConnectionSchema,
    { method: "POST" },
  );
}

/**
 * Enqueues a manual Canvas sync; never runs it inline.
 *
 * RESOLVES TO AN ACKNOWLEDGEMENT (`{ queued }`), NOT SYNCED DATA -- the same
 * contract as `generateMailDigest`. The sync itself runs in the worker
 * per-course, with per-course failure containment (ADR-068 §4/§5); re-read
 * `listCanvasConnections` (for `last_sync_at`/`last_sync_error`) or
 * `listCanvasSyncRuns` to see the result.
 *
 * Sends NO BODY, so `fetchJson` omits `Content-Type` -- the same
 * bodyless-POST contract `generateMailDigest`/`disconnectMailConnection`
 * already rely on to avoid Fastify's `FST_ERR_CTP_EMPTY_JSON_BODY`.
 */
export async function triggerCanvasSync(
  baseUrl: string,
  id: string,
): Promise<CanvasSyncTriggerResponse> {
  return await fetchJson(
    baseUrl,
    `/canvas-connections/${encodeURIComponent(id)}/sync`,
    CanvasSyncTriggerResponseSchema,
    { method: "POST" },
  );
}

/**
 * The sync-run audit trail for one connection (ADR-068 §5), newest first.
 *
 * `limit` is optional and omitted from the query string entirely when unset
 * -- `buildQuery` never serializes `undefined` as the literal string
 * "undefined", the same convention every other paginated list method in
 * this package relies on.
 */
export async function listCanvasSyncRuns(
  baseUrl: string,
  id: string,
  limit?: number,
): Promise<CanvasSyncRunsResponse> {
  return await fetchJson(
    baseUrl,
    `/canvas-connections/${encodeURIComponent(id)}/sync-runs${buildQuery({ limit })}`,
    CanvasSyncRunsResponseSchema,
  );
}

/**
 * Assignments due within `withinDays` (server default/clamp: 7, max 30)
 * across every active connection's unarchived courses, denormalized with
 * each assignment's course name and sorted by `due_at` ascending
 * (`GET /canvas-assignments/upcoming`, ADR-068 Checkpoint 10.1). Read-only,
 * like the rest of this integration -- there is no per-assignment method
 * here because nothing in this app ever creates, edits, or submits one.
 */
export async function listUpcomingCanvasAssignments(
  baseUrl: string,
  withinDays?: number,
): Promise<CanvasUpcomingAssignmentsResponse> {
  return await fetchJson(
    baseUrl,
    `/canvas-assignments/upcoming${buildQuery({ within_days: withinDays })}`,
    CanvasUpcomingAssignmentsResponseSchema,
  );
}
