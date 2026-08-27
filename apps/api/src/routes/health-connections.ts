import {
  clearBackfill,
  requestBackfillCancel,
  startBackfill,
  BackfillTransitionError,
  type BackfillColumns,
} from "@personal-os/core/health/backfill";
import { healthConnections, healthMetricStreams, healthSyncRuns } from "@personal-os/db";
import {
  buildAuthorizeUrl,
  getHealthMetric,
  GoogleHealthApiError,
  GoogleHealthOAuthError,
  PHASE_6A_SCOPES,
} from "@personal-os/health-providers";
import {
  ConnectGoogleHealthRequestSchema,
  HealthBackfillRequestSchema,
  HealthSyncQueuedResponseSchema,
  HealthSyncRequestSchema,
  HealthSyncRunListResponseSchema,
  HealthMetricStreamSchema,
  HealthAuthorizeUrlQuerySchema,
  HealthAuthorizeUrlResponseSchema,
  HealthConnectionListResponseSchema,
  HealthConnectionSchema,
  HealthMetricStreamListResponseSchema,
  HealthStreamUpdateSchema,
  sanitizeHealthSyncErrorToken,
} from "@personal-os/schema";
import { and, asc, desc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { HEALTH_SYNC_CONNECTION_QUEUE } from "../queue-names.js";
import {
  AccountMismatchError,
  assertAllowedRedirectUri,
  completeHealthConnection,
  createOAuthState,
  disconnectHealthConnection,
  getHealthOAuthConfig,
  HealthNotConfiguredError,
  InvalidRedirectUriError,
  InvalidStateError,
  needsForcedConsent,
  type HealthConnectionRow,
} from "../services/health-connection.js";

// Google Health OAuth connection routes (Phase 6 Checkpoint 6.2).
//
// Tailscale-perimeter-only, like calendar-connections.ts -- no device-token
// hook. Every response shape is Zod-parsed on the way out, and none of those
// shapes can express a token: the credential columns simply have no counterpart
// in HealthConnectionSchema.

type StreamRow = typeof healthMetricStreams.$inferSelect;

function toConnectionResponse(row: HealthConnectionRow) {
  return HealthConnectionSchema.parse({
    id: row.id,
    provider: row.provider,
    health_user_id: row.healthUserId,
    legacy_user_id: row.legacyUserId,
    granted_scope: row.grantedScope,
    source_family: row.sourceFamily,
    status: row.status,
    identity_verified_at: row.identityVerifiedAt?.toISOString() ?? null,
    last_sync_error: sanitizeHealthSyncErrorToken(row.lastSyncError),
    last_sync_error_at: row.lastSyncErrorAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

function toStreamResponse(row: StreamRow) {
  return {
    id: row.id,
    connection_id: row.connectionId,
    metric: row.metric,
    sync_enabled: row.syncEnabled,
    capability_status: row.capabilityStatus,
    capability_checked_at: row.capabilityCheckedAt?.toISOString() ?? null,
    verified_through_date: row.verifiedThroughDate,
    earliest_verified_date: row.earliestVerifiedDate,
    first_data_date: row.firstDataDate,
    last_successful_sync_at: row.lastSuccessfulSyncAt?.toISOString() ?? null,
    last_full_sync_at: row.lastFullSyncAt?.toISOString() ?? null,
    backfill_status: row.backfillStatus,
    backfill_target_date: row.backfillTargetDate,
    backfill_cursor_date: row.backfillCursorDate,
    backfill_cancel_requested: row.backfillCancelRequested,
    last_sync_error: sanitizeHealthSyncErrorToken(row.lastSyncError),
  };
}

/**
 * Maps a service/provider failure to a status code and a STATIC error string.
 *
 * Nothing from a provider error message is ever forwarded: a Google error can
 * carry a connection label, an internal id, or a decryption failure naming a
 * key. Callers get a code they can branch on and nothing else.
 */
function replyForError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof HealthNotConfiguredError) {
    return { status: 409, body: { error: "health_not_configured" } };
  }
  if (err instanceof InvalidRedirectUriError) {
    return { status: 400, body: { error: "invalid_redirect_uri" } };
  }
  if (err instanceof InvalidStateError) {
    return { status: 400, body: { error: "invalid_state" } };
  }
  if (err instanceof AccountMismatchError) {
    return { status: 409, body: { error: "account_mismatch" } };
  }
  if (err instanceof GoogleHealthOAuthError) {
    return { status: 422, body: { error: "google_oauth_failed" } };
  }
  if (err instanceof GoogleHealthApiError) {
    return { status: 422, body: { error: "google_health_api_failed" } };
  }
  return null;
}

export default function healthConnectionsRoutes(app: FastifyInstance): void {
  // ---- authorization URL -------------------------------------------------
  app.get("/health-connections/google/authorize-url", async (request, reply) => {
    try {
      const query = HealthAuthorizeUrlQuerySchema.parse(request.query);
      const config = getHealthOAuthConfig();
      // The client may only SELECT among allowlisted redirects; it can never
      // introduce one. This is what stops the endpoint becoming an open
      // redirect against our own OAuth client.
      assertAllowedRedirectUri(config, query.redirect_uri);

      const forceConsent = await needsForcedConsent(app.db);
      const state = await createOAuthState(app.db, query.redirect_uri);

      return reply.send(
        HealthAuthorizeUrlResponseSchema.parse({
          url: buildAuthorizeUrl({
            clientId: config.clientId,
            redirectUri: query.redirect_uri,
            scopes: PHASE_6A_SCOPES,
            state: state.state,
            forceConsent,
          }),
          state_expires_at: state.expiresAt.toISOString(),
        }),
      );
    } catch (err) {
      const mapped = replyForError(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  // ---- browser callback --------------------------------------------------
  // Google redirects the USER'S BROWSER here; Google's servers never call it.
  // That is why a Tailscale-only host works as a redirect target at all.
  app.get<{ Querystring: Record<string, string | undefined> }>(
    "/health-connections/google/callback",
    async (request, reply) => {
      const { code, state, error: providerError } = request.query;

      // Google reports a denied consent as ?error=access_denied. Surface it as
      // a clean 400 rather than letting it fall through as a missing code.
      if (providerError) {
        return reply.code(400).send({ error: "google_consent_failed" });
      }
      if (!code || !state) {
        return reply.code(400).send({ error: "missing_code_or_state" });
      }

      try {
        const config = getHealthOAuthConfig();
        // The callback's own URL is the redirect that was used, so it must be
        // the one this server advertises -- take it from the allowlist rather
        // than reconstructing it from request headers, which are client-controlled.
        const redirectUri = config.allowedRedirectUris.find((uri) =>
          uri.endsWith("/health-connections/google/callback"),
        );
        if (!redirectUri) throw new InvalidRedirectUriError();

        const result = await completeHealthConnection({
          db: app.db,
          client: app.googleHealthClient,
          code,
          redirectUri,
          state,
        });
        return reply.code(result.created ? 201 : 200).send(toConnectionResponse(result.connection));
      } catch (err) {
        const mapped = replyForError(err);
        if (mapped) {
          // Log the CODE ONLY -- never the error message, which may carry
          // provider detail, and never the query string.
          request.log.warn({ healthOauthError: mapped.body.error }, "health oauth callback failed");
          return reply.code(mapped.status).send(mapped.body);
        }
        throw err;
      }
    },
  );

  // ---- manual completion (admin fallback) --------------------------------
  // Same service, same allowlist, same single-use state. Exists so a flow that
  // could not use the browser callback still cannot bypass any check.
  app.post("/health-connections/google", async (request, reply) => {
    try {
      const body = ConnectGoogleHealthRequestSchema.parse(request.body);
      const result = await completeHealthConnection({
        db: app.db,
        client: app.googleHealthClient,
        code: body.auth_code,
        redirectUri: body.redirect_uri,
        state: body.state,
      });
      return reply.code(result.created ? 201 : 200).send(toConnectionResponse(result.connection));
    } catch (err) {
      const mapped = replyForError(err);
      if (mapped) return reply.code(mapped.status).send(mapped.body);
      throw err;
    }
  });

  // ---- read --------------------------------------------------------------
  app.get("/health-connections", async () => {
    const rows = await app.db
      .select()
      .from(healthConnections)
      .orderBy(asc(healthConnections.createdAt));
    return HealthConnectionListResponseSchema.parse({ items: rows.map(toConnectionResponse) });
  });

  app.get<{ Params: { id: string } }>("/health-connections/:id", async (request, reply) => {
    const [row] = await app.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.id, request.params.id));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(toConnectionResponse(row));
  });

  app.get<{ Params: { id: string } }>("/health-connections/:id/streams", async (request, reply) => {
    const [connection] = await app.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.id, request.params.id));
    if (!connection) return reply.code(404).send({ error: "not_found" });

    const rows = await app.db
      .select()
      .from(healthMetricStreams)
      .where(eq(healthMetricStreams.connectionId, connection.id))
      .orderBy(asc(healthMetricStreams.metric));
    return reply.send(
      HealthMetricStreamListResponseSchema.parse({ items: rows.map(toStreamResponse) }),
    );
  });

  app.patch<{ Params: { id: string } }>(
    "/health-connections/:id/streams",
    async (request, reply) => {
      const updates = HealthStreamUpdateSchema.array().parse(request.body);
      const [connection] = await app.db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, request.params.id));
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const now = new Date();

      // Validate EVERY update before applying ANY of them. Previously each
      // update was checked and written in the same pass, so a batch whose
      // second entry was rejected had already committed its first -- the
      // caller got a 4xx describing a state the database had partly entered.
      const planned: Array<{ metric: string; syncEnabled: boolean }> = [];
      for (const update of updates) {
        const [row] = await app.db
          .select()
          .from(healthMetricStreams)
          .where(
            and(
              eq(healthMetricStreams.connectionId, connection.id),
              eq(healthMetricStreams.metric, update.metric),
            ),
          );
        if (!row) {
          return reply.code(404).send({ error: "unknown_metric", metric: update.metric });
        }
        if (update.sync_enabled) {
          // Structural exclusion of heart-rate-intraday, and of any future
          // reconcile metric -- the SAME guard the backfill route already
          // applies, tested on MODE rather than on the metric name.
          //
          // Without it this route was the one path that could set
          // sync_enabled = true on a sample_reconcile stream, contradicting
          // the standing rule that raw intraday heart rate stays disabled
          // while F5 (reconcile identity stability) is unproven. The worker's
          // isSyncableMetric filter meant such a stream was never actually
          // fetched, so the flag was inert -- but it still misreported the
          // stream as enabled to every reader of this endpoint. Found live in
          // Checkpoint 6.6.
          let mode: string;
          try {
            mode = getHealthMetric(update.metric).mode;
          } catch {
            return reply.code(404).send({ error: "unknown_metric", metric: update.metric });
          }
          if (mode === "sample_reconcile") {
            return reply.code(409).send({ error: "metric_out_of_scope", metric: update.metric });
          }
          // A stream whose scope was never granted must not be enablable --
          // doing so would only produce a storm of 403s at sync time.
          if (row.lastSyncError === "scope_not_granted") {
            return reply.code(409).send({ error: "scope_not_granted", metric: update.metric });
          }
        }
        // Disabling is deliberately NOT gated on any of the above. A stream
        // that is somehow enabled must always be switchable back off, or the
        // invariant this guard protects would be unrecoverable through the API.
        planned.push({ metric: update.metric, syncEnabled: update.sync_enabled });
      }

      for (const change of planned) {
        // Scoped by connection AND metric: a bare metric match would update
        // every connection's stream if a second provider is ever added.
        await app.db
          .update(healthMetricStreams)
          .set({ syncEnabled: change.syncEnabled, updatedAt: now })
          .where(
            and(
              eq(healthMetricStreams.connectionId, connection.id),
              eq(healthMetricStreams.metric, change.metric),
            ),
          );
      }

      const rows = await app.db
        .select()
        .from(healthMetricStreams)
        .where(eq(healthMetricStreams.connectionId, connection.id))
        .orderBy(asc(healthMetricStreams.metric));
      return reply.send(
        HealthMetricStreamListResponseSchema.parse({ items: rows.map(toStreamResponse) }),
      );
    },
  );

  // ---- sync --------------------------------------------------------------
  // Enqueues ONE connection-level job. There is deliberately no per-metric
  // sync route: a per-stream job would let all 18 streams of one connection
  // run concurrently, and "do not overlap syncs for the same connection" is
  // the whole reason the worker orchestrates a connection at a time.
  app.post<{ Params: { id: string } }>("/health-connections/:id/sync", async (request, reply) => {
    const body = HealthSyncRequestSchema.parse(request.body ?? {});
    const [connection] = await app.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.id, request.params.id));
    if (!connection) return reply.code(404).send({ error: "not_found" });
    if (connection.status !== "active") {
      return reply.code(409).send({ error: "connection_not_active", status: connection.status });
    }
    if (!app.bossReady) return reply.code(503).send({ error: "queue_unavailable" });

    const payload = {
      connectionId: connection.id,
      trigger: "manual" as const,
      // The requested kind is HONOURED, not discarded. `hot` must keep hot's
      // non-authoritative rules -- it is the one mode ADR-046 says may never
      // densify or tombstone -- so silently promoting it to an authoritative
      // manual pass would inverse exactly the caller's intent.
      requestedKind: body.kind,
    };
    const options = { singletonKey: connection.id, startAfter: 0 };

    // upsert, not send: under `policy: "stately"` a plain send is suppressed
    // to null when a job is already queued, which would silently drop the
    // user's request behind a queued scheduled pass. upsert edits that
    // queued job's payload in place instead, so a manual request always wins
    // and can never be downgraded. startAfter: 0 is explicit because
    // updateJob otherwise inherits the existing row's start_after.
    const result = await app.boss.upsert(HEALTH_SYNC_CONNECTION_QUEUE, payload, options);
    let queued = result.updated + result.inserted;
    if (queued === 0) {
      // Possible when the conflicting row is activated between the match and
      // the update. A plain send then creates a fresh `created` row, which
      // `stately` permits alongside the now-active one.
      const id = await app.boss.send(HEALTH_SYNC_CONNECTION_QUEUE, payload, options);
      queued = id === null ? 0 : 1;
    }
    return reply.code(202).send(HealthSyncQueuedResponseSchema.parse({ queued }));
  });

  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    "/health-connections/:id/sync-runs",
    async (request, reply) => {
      const [connection] = await app.db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, request.params.id));
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const parsed = Number.parseInt(request.query.limit ?? "50", 10);
      const limit = Number.isFinite(parsed) ? Math.min(Math.max(parsed, 1), 200) : 50;

      const rows = await app.db
        .select()
        .from(healthSyncRuns)
        .where(eq(healthSyncRuns.connectionId, connection.id))
        .orderBy(desc(healthSyncRuns.startedAt))
        .limit(limit);

      return reply.send(
        HealthSyncRunListResponseSchema.parse({
          items: rows.map((row) => ({
            id: row.id,
            metric: row.metric,
            kind: row.kind,
            status: row.status,
            range_start_date: row.rangeStartDate,
            range_end_date: row.rangeEndDate,
            // Same shape guard as the two connection/stream projections. The
            // sync engine only ever stores its own classes here, but this is
            // the one health error field the 6.5 sweep would otherwise have
            // left as a review rule rather than a structural guarantee.
            failure_class: sanitizeHealthSyncErrorToken(row.failureClass),
            rows_inserted: row.rowsInserted,
            rows_updated: row.rowsUpdated,
            rows_unchanged: row.rowsUnchanged,
            rows_tombstoned: row.rowsTombstoned,
            rows_rejected: row.rowsRejected,
            rows_collapsed: row.rowsCollapsed,
            started_at: row.startedAt.toISOString(),
            finished_at: row.finishedAt?.toISOString() ?? null,
          })),
        }),
      );
    },
  );

  // ---- backfill ----------------------------------------------------------
  async function loadStream(connectionId: string, metric: string) {
    const [row] = await app.db
      .select()
      .from(healthMetricStreams)
      .where(
        and(
          eq(healthMetricStreams.connectionId, connectionId),
          eq(healthMetricStreams.metric, metric),
        ),
      );
    return row;
  }

  async function applyBackfillColumns(streamId: string, columns: BackfillColumns) {
    // Every transition writes all four columns together. A partial update is
    // how migration 0013's backfill_invariants CHECK gets violated (23514).
    const [row] = await app.db
      .update(healthMetricStreams)
      .set({
        backfillStatus: columns.backfillStatus,
        backfillTargetDate: columns.backfillTargetDate,
        backfillCursorDate: columns.backfillCursorDate,
        backfillCancelRequested: columns.backfillCancelRequested,
        updatedAt: new Date(),
      })
      .where(eq(healthMetricStreams.id, streamId))
      .returning();
    return row!;
  }

  app.post<{ Params: { id: string; metric: string } }>(
    "/health-connections/:id/streams/:metric/backfill",
    async (request, reply) => {
      const body = HealthBackfillRequestSchema.parse(request.body);
      const [connection] = await app.db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, request.params.id));
      if (!connection) return reply.code(404).send({ error: "not_found" });

      let mode: string;
      try {
        mode = getHealthMetric(request.params.metric).mode;
      } catch {
        return reply.code(404).send({ error: "unknown_metric", metric: request.params.metric });
      }
      // Structural exclusion of heart-rate-intraday, and of any future
      // reconcile metric, rather than a string blocklist.
      if (mode === "sample_reconcile") {
        return reply
          .code(409)
          .send({ error: "metric_out_of_scope", metric: request.params.metric });
      }

      const stream = await loadStream(connection.id, request.params.metric);
      if (!stream) {
        return reply.code(404).send({ error: "unknown_metric", metric: request.params.metric });
      }
      if (!stream.syncEnabled) {
        return reply.code(409).send({ error: "stream_disabled", metric: request.params.metric });
      }

      const state = {
        backfillStatus: stream.backfillStatus as BackfillColumns["backfillStatus"],
        backfillTargetDate: stream.backfillTargetDate,
        backfillCursorDate: stream.backfillCursorDate,
        backfillCancelRequested: stream.backfillCancelRequested,
        earliestVerifiedDate: stream.earliestVerifiedDate,
      };

      try {
        // A request against a SETTLED stream clears to idle first, in the same
        // call: that is the only caller clearBackfill needs, and it is how a
        // complete/cancelled/failed/paused backfill is restarted with a new
        // target without a separate reset route.
        //
        // A RUNNING stream is deliberately NOT cleared. Clearing it would reset
        // the status to idle, so startBackfill's own guard could never fire --
        // and worse, an in-flight chunk composes its commit from state
        // snapshotted before its fetch, so it would write the OLD target and
        // cursor back over the new ones. The restart would return 200 and then
        // silently un-happen.
        const SETTLED: readonly string[] = ["complete", "cancelled", "failed", "paused"];
        const base = SETTLED.includes(state.backfillStatus)
          ? { ...state, ...clearBackfill() }
          : state;
        const columns = startBackfill(base, body.target_date, new Date());
        const updated = await applyBackfillColumns(stream.id, columns);

        if (app.bossReady) {
          await app.boss.send(
            HEALTH_SYNC_CONNECTION_QUEUE,
            { connectionId: connection.id, trigger: "scheduled" as const },
            { singletonKey: connection.id },
          );
        }
        return reply.send(HealthMetricStreamSchema.parse(toStreamResponse(updated)));
      } catch (err) {
        if (err instanceof BackfillTransitionError) {
          return reply.code(409).send({ error: err.code });
        }
        throw err;
      }
    },
  );

  app.post<{ Params: { id: string; metric: string } }>(
    "/health-connections/:id/streams/:metric/backfill/cancel",
    async (request, reply) => {
      const [connection] = await app.db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, request.params.id));
      if (!connection) return reply.code(404).send({ error: "not_found" });

      const stream = await loadStream(connection.id, request.params.metric);
      if (!stream) {
        return reply.code(404).send({ error: "unknown_metric", metric: request.params.metric });
      }

      try {
        // Only the flag is set. The worker consumes it at its next chunk
        // boundary, so a run that is mid-chunk still commits that chunk's
        // transaction cleanly rather than being torn in half.
        const columns = requestBackfillCancel({
          backfillStatus: stream.backfillStatus as BackfillColumns["backfillStatus"],
          backfillTargetDate: stream.backfillTargetDate,
          backfillCursorDate: stream.backfillCursorDate,
          backfillCancelRequested: stream.backfillCancelRequested,
          earliestVerifiedDate: stream.earliestVerifiedDate,
        });
        const updated = await applyBackfillColumns(stream.id, columns);
        return reply.send(HealthMetricStreamSchema.parse(toStreamResponse(updated)));
      } catch (err) {
        if (err instanceof BackfillTransitionError) {
          return reply.code(409).send({ error: err.code });
        }
        throw err;
      }
    },
  );

  // ---- disconnect --------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/health-connections/:id/disconnect",
    async (request, reply) => {
      const [row] = await app.db
        .select()
        .from(healthConnections)
        .where(eq(healthConnections.id, request.params.id));
      if (!row) return reply.code(404).send({ error: "not_found" });

      const result = await disconnectHealthConnection(app.db, row);
      return reply.send(toConnectionResponse(result.connection));
    },
  );
}
