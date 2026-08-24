import { healthConnections, healthMetricStreams } from "@personal-os/db";
import {
  buildAuthorizeUrl,
  GoogleHealthApiError,
  GoogleHealthOAuthError,
  PHASE_6A_SCOPES,
} from "@personal-os/health-providers";
import {
  ConnectGoogleHealthRequestSchema,
  HealthAuthorizeUrlQuerySchema,
  HealthAuthorizeUrlResponseSchema,
  HealthConnectionListResponseSchema,
  HealthConnectionSchema,
  HealthMetricStreamListResponseSchema,
  HealthStreamUpdateSchema,
} from "@personal-os/schema";
import { and, asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
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
    last_sync_error: row.lastSyncError,
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
    last_sync_error: row.lastSyncError,
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
      for (const update of updates) {
        // Scoped by connection AND metric: a bare metric match would update
        // every connection's stream if a second provider is ever added.
        const streamWhere = and(
          eq(healthMetricStreams.connectionId, connection.id),
          eq(healthMetricStreams.metric, update.metric),
        );
        const [row] = await app.db.select().from(healthMetricStreams).where(streamWhere);
        if (!row) {
          return reply.code(404).send({ error: "unknown_metric", metric: update.metric });
        }
        // A stream whose scope was never granted must not be enablable -- doing
        // so would only produce a storm of 403s at sync time.
        if (update.sync_enabled && row.lastSyncError === "scope_not_granted") {
          return reply.code(409).send({ error: "scope_not_granted", metric: update.metric });
        }
        await app.db
          .update(healthMetricStreams)
          .set({ syncEnabled: update.sync_enabled, updatedAt: now })
          .where(streamWhere);
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
