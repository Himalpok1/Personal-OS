import {
  MailAuthorizeUrlResponseSchema,
  MailConnectionListResponseSchema,
  MailConnectionSchema,
  MailDisconnectResponseSchema,
  type ConnectGmailRequest,
  type MailAuthorizeUrlResponse,
  type MailConnection,
  type MailConnectionListResponse,
  type MailDisconnectResponse,
  MailDigestCurrentResponseSchema,
  MailDigestGenerateAcceptedSchema,
  type MailDigestCurrentResponse,
  type MailDigestGenerateAccepted,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

// Phase 7 Checkpoint 7.2 -- the mail CONNECTION LIFECYCLE only.
//
// Named listMail*/getMail*/connectGmail* rather than list()/get(), following
// the getHealth* convention adopted for the same reason: a bare name here
// collides with the flat method bag's existing surface. There is deliberately
// no sync, message, digest or monitoring method -- those belong to 7.3 and
// later, and adding a client method before the route exists would be a
// contract nobody can honour.

export type {
  ConnectGmailRequest,
  MailAuthorizeUrlResponse,
  MailConnection,
  MailConnectionListResponse,
  MailDisconnectResponse,
};

/**
 * Builds the Gmail consent URL for one allowlisted redirect.
 *
 * The server rejects any `redirect_uri` outside its own allowlist, so a client
 * may only SELECT among redirects, never introduce one.
 */
export async function getGmailAuthorizeUrl(
  baseUrl: string,
  redirectUri: string,
): Promise<MailAuthorizeUrlResponse> {
  return await fetchJson(
    baseUrl,
    `/mail-connections/gmail/authorize-url${buildQuery({ redirect_uri: redirectUri })}`,
    MailAuthorizeUrlResponseSchema,
  );
}

/**
 * Completes a Gmail connection from an authorization code.
 *
 * The manual fallback for a flow that could not use the browser callback; it
 * runs the same allowlist and the same single-use state check, so it bypasses
 * nothing.
 */
export async function connectGmail(
  baseUrl: string,
  body: ConnectGmailRequest,
): Promise<MailConnection> {
  return await fetchJson(baseUrl, "/mail-connections/gmail", MailConnectionSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function listMailConnections(baseUrl: string): Promise<MailConnectionListResponse> {
  return await fetchJson(baseUrl, "/mail-connections", MailConnectionListResponseSchema);
}

export async function getMailConnection(baseUrl: string, id: string): Promise<MailConnection> {
  return await fetchJson(
    baseUrl,
    `/mail-connections/${encodeURIComponent(id)}`,
    MailConnectionSchema,
  );
}

/**
 * Disconnects a mailbox.
 *
 * `revoked` reports whether Google accepted the revocation and is separate from
 * the call succeeding: revocation is best-effort, so a `false` here still
 * accompanies a fully disconnected connection with its credentials cleared.
 */
export async function disconnectMailConnection(
  baseUrl: string,
  id: string,
): Promise<MailDisconnectResponse> {
  return await fetchJson(
    baseUrl,
    `/mail-connections/${encodeURIComponent(id)}/disconnect`,
    MailDisconnectResponseSchema,
    { method: "POST" },
  );
}

// ---------------------------------------------------------------------------
// Mail digest (Checkpoint 7.6)
// ---------------------------------------------------------------------------

/**
 * The current digest plus the two facts an honest empty state needs.
 *
 * NO `tz` ARGUMENT, DELIBERATELY. A digest's identity is `(digest_date,
 * timezone)` where the zone is the SERVER's configuration, so a client that
 * passed its own zone against a server configured for UTC -- the default --
 * would find nothing and show an empty digest forever while one sat in the
 * table. The returned row carries its own date and zone instead.
 */
export async function getCurrentMailDigest(baseUrl: string): Promise<MailDigestCurrentResponse> {
  return await fetchJson(baseUrl, "/mail-digests/current", MailDigestCurrentResponseSchema);
}

/**
 * Asks the server to generate a digest now.
 *
 * RESOLVES TO AN ACKNOWLEDGEMENT, NOT A DIGEST. Generation runs in the worker,
 * so a successful call means the job was accepted and the caller must re-read
 * `getCurrentMailDigest` to see a result. Preconditions the server can decide
 * synchronously (no mailbox, no model route) arrive as an `ApiClientError` with
 * a specific code rather than as silence.
 *
 * Sends NO BODY, so `fetchJson` omits `Content-Type` -- Fastify rejects a
 * declared JSON body that is empty, which cost a Phase 2 debugging cycle.
 */
export async function generateMailDigest(baseUrl: string): Promise<MailDigestGenerateAccepted> {
  return await fetchJson(baseUrl, "/mail-digests", MailDigestGenerateAcceptedSchema, {
    method: "POST",
  });
}
