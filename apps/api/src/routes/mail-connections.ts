import { mailConnections } from "@personal-os/db";
import { GmailApiError } from "@personal-os/mail-providers";
import {
  ConnectGmailRequestSchema,
  MailAuthorizeUrlQuerySchema,
  MailAuthorizeUrlResponseSchema,
  MailConnectionListResponseSchema,
  MailConnectionSchema,
  MailDisconnectResponseSchema,
  sanitizeMailSyncErrorCode,
} from "@personal-os/schema";
import { asc, eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import {
  assertAllowedMailRedirectUri,
  buildMailAuthorizeUrl,
  completeGmailConnection,
  createMailOAuthState,
  disconnectGmailConnection,
  getMailOAuthConfig,
  GmailOAuthError,
  InvalidMailRedirectUriError,
  InvalidMailStateError,
  isMailConfigured,
  MailNotConfiguredError,
  MissingRefreshTokenError,
  needsForcedConsent,
  type MailConnectionRow,
} from "../services/mail-connection.js";

const CALLBACK_PATH = "/mail-connections/gmail/callback";

/**
 * The safe wire projection of a mail connection.
 *
 * ENCRYPTED COLUMNS ARE NOT MENTIONED HERE AT ALL -- not omitted from a spread,
 * not filtered out, simply never read. Combined with
 * MailConnectionSchema.parse, which is a non-passthrough object schema, a
 * ciphertext/iv/auth-tag column is structurally incapable of reaching the wire.
 *
 * `last_sync_error` goes through sanitizeMailSyncErrorCode, so a row written by
 * any build that got this wrong is neutralised on the way out rather than
 * needing a data migration.
 */
function toConnectionResponse(row: MailConnectionRow) {
  return MailConnectionSchema.parse({
    id: row.id,
    provider: row.provider,
    external_account_id: row.externalAccountId,
    status: row.status,
    granted_scope: row.grantedScope,
    identity_verified_at: row.identityVerifiedAt?.toISOString() ?? null,
    last_sync_error: sanitizeMailSyncErrorCode(row.lastSyncError),
    last_sync_error_at: row.lastSyncErrorAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
    updated_at: row.updatedAt.toISOString(),
  });
}

/**
 * Maps a service/provider failure to a status code and a STATIC error string.
 *
 * Nothing from a provider error message is ever forwarded. A Gmail error can
 * echo the offending request back, and a decryption failure can name a key.
 * Callers get a code they can branch on and nothing else.
 */
function replyForError(err: unknown): { status: number; body: { error: string } } | null {
  if (err instanceof MailNotConfiguredError) {
    return { status: 409, body: { error: "mail_not_configured" } };
  }
  if (err instanceof InvalidMailRedirectUriError) {
    return { status: 400, body: { error: "invalid_redirect_uri" } };
  }
  if (err instanceof InvalidMailStateError) {
    return { status: 400, body: { error: "invalid_state" } };
  }
  if (err instanceof MissingRefreshTokenError) {
    return { status: 409, body: { error: "missing_refresh_token" } };
  }
  if (err instanceof GmailOAuthError) {
    return { status: 422, body: { error: "gmail_oauth_failed" } };
  }
  if (err instanceof GmailApiError) {
    return { status: 422, body: { error: "gmail_api_failed" } };
  }
  return null;
}

export default function mailConnectionsRoutes(app: FastifyInstance): void {
  // ---- authorization URL -------------------------------------------------
  app.get("/mail-connections/gmail/authorize-url", async (request, reply) => {
    try {
      const query = MailAuthorizeUrlQuerySchema.parse(request.query);
      const config = getMailOAuthConfig();
      // The client may only SELECT among allowlisted redirects; it can never
      // introduce one. This is what stops the endpoint becoming an open
      // redirect against our own OAuth client.
      assertAllowedMailRedirectUri(config, query.redirect_uri);

      // No mailbox is known before consent, so this is always true -- see the
      // service comment. Being wrong here costs one extra consent screen;
      // being wrong the other way costs a connection that can never refresh.
      const forceConsent = await needsForcedConsent(app.db);
      const state = await createMailOAuthState(app.db, query.redirect_uri);

      return reply.send(
        MailAuthorizeUrlResponseSchema.parse({
          url: buildMailAuthorizeUrl(config, query.redirect_uri, state.state, forceConsent),
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
  // That is why a Tailscale-only host works as a redirect target at all, and
  // why this needs no public ingress (ADR-018).
  app.get<{ Querystring: Record<string, string | undefined> }>(
    CALLBACK_PATH,
    async (request, reply) => {
      const { code, state, error: providerError } = request.query;

      // Google reports a denied consent as ?error=access_denied. Surface it as
      // a clean 400 rather than letting it fall through as a missing code.
      if (providerError) {
        return reply.code(400).send({ error: "gmail_consent_failed" });
      }
      if (!code || !state) {
        return reply.code(400).send({ error: "missing_code_or_state" });
      }

      try {
        const config = getMailOAuthConfig();
        // The callback's own URL is the redirect that was used, so it must be
        // the one this server advertises -- take it from the allowlist rather
        // than reconstructing it from request headers, which are
        // client-controlled.
        const redirectUri = config.allowedRedirectUris.find((uri) => uri.endsWith(CALLBACK_PATH));
        if (!redirectUri) throw new InvalidMailRedirectUriError();

        const result = await completeGmailConnection({
          db: app.db,
          client: app.gmailClient,
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
          request.log.warn({ mailOauthError: mapped.body.error }, "gmail oauth callback failed");
          return reply.code(mapped.status).send(mapped.body);
        }
        throw err;
      }
    },
  );

  // ---- manual completion (admin fallback) --------------------------------
  // Same service, same allowlist, same single-use state, so a flow that could
  // not use the browser callback still cannot bypass any check.
  app.post("/mail-connections/gmail", async (request, reply) => {
    try {
      const body = ConnectGmailRequestSchema.parse(request.body);
      const result = await completeGmailConnection({
        db: app.db,
        client: app.gmailClient,
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
  app.get("/mail-connections", async () => {
    const rows = await app.db
      .select()
      .from(mailConnections)
      .orderBy(asc(mailConnections.createdAt));
    return MailConnectionListResponseSchema.parse({
      // Reported so a client can distinguish "no mailboxes connected yet" from
      // "this server cannot connect one", which are different states needing
      // different words on screen.
      configured: isMailConfigured(),
      items: rows.map(toConnectionResponse),
    });
  });

  app.get<{ Params: { id: string } }>("/mail-connections/:id", async (request, reply) => {
    const [row] = await app.db
      .select()
      .from(mailConnections)
      .where(eq(mailConnections.id, request.params.id))
      .limit(1);
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(toConnectionResponse(row));
  });

  // ---- disconnect --------------------------------------------------------
  app.post<{ Params: { id: string } }>(
    "/mail-connections/:id/disconnect",
    async (request, reply) => {
      const [row] = await app.db
        .select()
        .from(mailConnections)
        .where(eq(mailConnections.id, request.params.id))
        .limit(1);
      if (!row) return reply.code(404).send({ error: "not_found" });

      // Idempotent by construction: an already-disconnected row has no
      // credentials to revoke and the same columns to clear, so a repeat call
      // succeeds with revoked=false rather than erroring.
      const result = await disconnectGmailConnection(app.db, row);
      return reply.send(
        MailDisconnectResponseSchema.parse({
          connection: toConnectionResponse(result.connection),
          revoked: result.revoked,
        }),
      );
    },
  );
}
