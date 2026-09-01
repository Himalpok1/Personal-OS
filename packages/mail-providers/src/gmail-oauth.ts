import {
  GOOGLE_OAUTH_AUTHORIZE_URL,
  GOOGLE_OAUTH_REVOKE_URL,
  GOOGLE_OAUTH_TOKEN_URL,
  PHASE_7_MAIL_SCOPES,
} from "./gmail-catalog.js";
import type { FetchLike } from "./mail-client.js";

// Gmail OAuth PRIMITIVES (ADR-053). Pure functions with an injectable fetch.
//
// Checkpoint 7.1 builds the primitives and nothing else: there is no route, no
// state table access, no connection lifecycle and no real flow here. Those are
// Checkpoint 7.2's, and they will call these.
//
// WHICH OF THE TWO EXISTING SHAPES THIS FOLLOWS, AND WHY
//
// The repository already has two incompatible Google OAuth implementations:
//
//   - packages/calendar-providers (Phase 4) deliberately sends NO redirect_uri,
//     because the code arrives through an on-device Android AuthorizationClient
//     and a redirect_uri "would be describing a request that never happened".
//     It also REQUIRES an id_token and derives identity from it.
//   - packages/health-providers (Phase 6) is a Web Server client and REQUIRES
//     redirect_uri, with identity coming from an API call because its three
//     read scopes carry no identity claim.
//
// Gmail is a browser-redirect flow, so this follows the HEALTH shape: send
// redirect_uri, exact-match allowlisted by the caller, never taken from the
// client. It does NOT graft Phase 4's id_token path back on, because
// `gmail.metadata` authorises `users.getProfile`, which returns the mailbox
// address directly -- so no `openid`/`email` scope is needed and none is
// requested.

export class GmailOAuthError extends Error {
  readonly googleErrorCode: string | undefined;
  readonly httpStatus: number | undefined;

  constructor(googleErrorCode: string | undefined, httpStatus: number | undefined) {
    // Constructed, never lifted from the provider. Google's
    // `error_description` is prose that has already reached a user's screen
    // once in this project's history (Checkpoint 6.5), and pg-boss persists a
    // thrown error's own-enumerable properties into a durable table.
    super(
      `Gmail OAuth failed${googleErrorCode !== undefined ? ` (${googleErrorCode})` : ""}` +
        `${httpStatus !== undefined ? ` [${httpStatus}]` : ""}`,
    );
    this.name = "GmailOAuthError";
    this.googleErrorCode = googleErrorCode;
    this.httpStatus = httpStatus;
  }

  /**
   * The grant is dead and retrying will never fix it.
   *
   * The caller's contract on seeing this is to mark the connection
   * `needs_reauth` and RETURN -- never to throw, because a dead grant must not
   * become a pg-boss retry storm.
   */
  get isPermanent(): boolean {
    return this.googleErrorCode === "invalid_grant" || this.googleErrorCode === "invalid_client";
  }
}

export interface BuildAuthorizeUrlParams {
  clientId: string;
  /**
   * Must come from the server's exact-match allowlist, never from a request
   * header or a client-supplied value. This function does not validate it --
   * the allowlist check belongs to the caller that owns the config, and 7.2
   * performs it before this is called.
   */
  redirectUri: string;
  /** The opaque CSRF state. Only its sha256 is ever persisted. */
  state: string;
  /**
   * Send `prompt=consent` ONLY when a refresh token is genuinely required.
   *
   * Google caps an account at 100 live refresh tokens per client and silently
   * evicts the oldest beyond that, so prompting on every reconnect would slowly
   * destroy older grants -- including, in this project, the Calendar and Health
   * ones, which share the same Google account.
   */
  forceConsent?: boolean;
  scopes?: readonly string[];
}

/** Builds the consent URL. Pure -- no network, no clock, no randomness. */
export function buildGmailAuthorizeUrl(params: BuildAuthorizeUrlParams): string {
  const url = new URL(GOOGLE_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("client_id", params.clientId);
  url.searchParams.set("redirect_uri", params.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", (params.scopes ?? PHASE_7_MAIL_SCOPES).join(" "));
  // Always: a refresh token is what makes unattended sync possible at all.
  url.searchParams.set("access_type", "offline");
  // ==========================================================================
  // `true` IS LOAD-BEARING. `false` REVOKES THE OTHER INTEGRATIONS. (ADR-053a)
  // ==========================================================================
  //
  // This line previously read `false`, under the comment "Never silently widen
  // a grant by inheriting scopes from another client." The instinct was right
  // and the effect was the opposite of what it intended.
  //
  // `include_granted_scopes=false` does not merely decline to widen the new
  // TOKEN. It makes the consent NON-ADDITIVE, so the grant it produces DEFINES
  // what the app may do -- and everything the account previously granted is
  // dropped. Google's consent model is per APP, and all three of this project's
  // OAuth clients share one Google Cloud project, therefore one consent screen,
  // therefore ONE grant set. Separate clients give separate tokens; they do not
  // give separate grants.
  //
  // That is not a reading of the documentation, it is what happened. Checkpoint
  // 7.2's Gmail consent at 2026-08-31T23:04Z left the account granting
  // `gmail.metadata` and nothing else; Google Calendar failed `auth_expired`
  // 11 minutes later and Google Health failed `invalid_grant` 56 minutes later,
  // each at its next token refresh. Both had run for months.
  //
  // `true` selects Google's incremental authorization: the new consent is ADDED
  // to what the account already granted, so connecting mail leaves calendar and
  // health alone.
  //
  // The cost, stated rather than discovered: the token Google returns may now
  // carry previously granted scopes too. That is accepted, because breadth of
  // scope on a token is not capability exercised -- `MailClient` exposes no
  // send, reply, modify, trash or label method to call -- and because the
  // alternative destroys two working integrations. What Personal OS REQUESTS is
  // unchanged and is asserted by test: exactly `gmail.metadata`.
  url.searchParams.set("include_granted_scopes", "true");
  url.searchParams.set("state", params.state);
  if (params.forceConsent === true) url.searchParams.set("prompt", "consent");
  return url.toString();
}

export interface GmailTokenResponse {
  accessToken: string;
  /**
   * Null when Google did not issue one. A caller must NOT overwrite a stored
   * refresh token with null: Google omits it on most reconnects, and the stored
   * one is still valid.
   */
  refreshToken: string | null;
  expiresAt: Date;
  grantedScope: string | null;
}

interface RawTokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
}

async function postToken(
  body: URLSearchParams,
  fetchFn: FetchLike,
  now: number,
): Promise<GmailTokenResponse> {
  const response = await fetchFn(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  let parsed: RawTokenResponse = {};
  try {
    parsed = (await response.json()) as RawTokenResponse;
  } catch {
    // Non-JSON body. Nothing to salvage; `error` stays undefined.
  }

  if (!response.ok || parsed.access_token === undefined) {
    // `error_description` is deliberately NOT read. Only the machine-readable
    // `error` token crosses this boundary.
    throw new GmailOAuthError(parsed.error, response.status);
  }

  return {
    accessToken: parsed.access_token,
    refreshToken: parsed.refresh_token ?? null,
    expiresAt: new Date(now + (parsed.expires_in ?? 3600) * 1000),
    grantedScope: parsed.scope ?? null,
  };
}

export interface ExchangeAuthCodeParams {
  code: string;
  clientId: string;
  clientSecret: string;
  /** Sent, unlike the Phase 4 calendar flow. See the module comment. */
  redirectUri: string;
}

export async function exchangeGmailAuthCode(
  params: ExchangeAuthCodeParams,
  fetchFn: FetchLike = globalThis.fetch,
  now: number = Date.now(),
): Promise<GmailTokenResponse> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });
  return await postToken(body, fetchFn, now);
}

export interface RefreshAccessTokenParams {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
}

export interface RefreshedGmailTokens {
  accessToken: string;
  expiresAt: Date;
}

/**
 * Refreshes the access token.
 *
 * The return type carries ONLY the access token and its expiry -- deliberately
 * narrower than `GmailTokenResponse`, so a caller structurally CANNOT clobber a
 * good stored refresh token with an absent one. Same discipline as
 * `RefreshedGoogleTokens` in packages/calendar-providers.
 */
export async function refreshGmailAccessToken(
  params: RefreshAccessTokenParams,
  fetchFn: FetchLike = globalThis.fetch,
  now: number = Date.now(),
): Promise<RefreshedGmailTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });
  const result = await postToken(body, fetchFn, now);
  return { accessToken: result.accessToken, expiresAt: result.expiresAt };
}

/**
 * Best-effort revocation.
 *
 * Resolves `false` rather than throwing, so a disconnect can always proceed
 * locally: failing to tell Google must never leave the user unable to clear
 * their own credentials.
 */
export async function revokeGmailToken(
  token: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await fetchFn(GOOGLE_OAUTH_REVOKE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }).toString(),
    });
    return response.ok;
  } catch {
    return false;
  }
}
