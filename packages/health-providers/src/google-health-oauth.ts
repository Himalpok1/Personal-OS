// Google OAuth 2.0 for the Google Health API.
//
// WHY THIS IS NOT packages/calendar-providers/src/google-oauth.ts:
//
//   1. That module deliberately OMITS redirect_uri, because Phase 4's flow is a
//      native AuthorizationClient whose code arrives via an Activity result, not
//      a browser redirect. Its comment records that the omission was verified
//      against a real account. Google Health documents a Web Server client, so
//      redirect_uri is REQUIRED here -- the opposite requirement.
//   2. We request no `openid`/`email` scope, so Google returns NO id_token and
//      the account identity must come from users.getIdentity instead of a JWT.
//   3. @personal-os/calendar-providers is the standing zero-drift regression
//      canary at exactly 57 tests; editing it to serve Health would destroy
//      that signal for no benefit.
//
// The near-duplication is therefore deliberate and documented. A follow-up to
// extract a shared packages/google-oauth and rewire both is filed, not done.

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";

export interface GoogleHealthOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ExchangedHealthTokens {
  accessToken: string;
  /**
   * Null only when the caller passed requireRefreshToken: false AND Google
   * omitted one -- which happens when consent was not re-prompted because a
   * valid grant already exists. The caller must then keep its stored token.
   */
  refreshToken: string | null;
  expiresAt: Date;
  /** Space-delimited scopes Google actually granted -- may be a subset. */
  scope: string;
}

export interface RefreshedHealthTokens {
  accessToken: string;
  expiresAt: Date;
}

interface TokenErrorBody {
  error?: string;
  error_description?: string;
}

interface TokenSuccessBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * Thrown on any non-2xx from Google's token endpoint. `googleErrorCode` carries
 * Google's own machine-readable string so callers classify permanent failures
 * without string-matching a human message.
 */
export class GoogleHealthOAuthError extends Error {
  readonly googleErrorCode: string | undefined;
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number, googleErrorCode: string | undefined) {
    super(message);
    this.name = "GoogleHealthOAuthError";
    this.httpStatus = httpStatus;
    this.googleErrorCode = googleErrorCode;
  }

  /**
   * True for grants that are permanently dead and need fresh user consent.
   *
   * The caller's contract on seeing this is to mark the connection
   * needs_reauth and RETURN, never to throw -- a dead grant must not become a
   * pg-boss retry storm.
   */
  get isPermanent(): boolean {
    return this.googleErrorCode === "invalid_grant" || this.googleErrorCode === "invalid_client";
  }
}

export type FetchLike = typeof globalThis.fetch;

async function postForm(url: string, body: URLSearchParams, fetchFn: FetchLike): Promise<Response> {
  return fetchFn(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function readToken(response: Response): Promise<TokenSuccessBody> {
  if (!response.ok) {
    let parsed: TokenErrorBody = {};
    try {
      parsed = (await response.json()) as TokenErrorBody;
    } catch {
      // Non-JSON error body -- fall through with an empty parsed error.
    }
    throw new GoogleHealthOAuthError(
      parsed.error_description ?? `Google token endpoint returned HTTP ${response.status}`,
      response.status,
      parsed.error,
    );
  }
  return (await response.json()) as TokenSuccessBody;
}

export interface BuildAuthorizeUrlParams {
  clientId: string;
  /** MUST already have been validated against the server-side allowlist. */
  redirectUri: string;
  scopes: readonly string[];
  state: string;
  /**
   * Force the consent screen, which is what makes Google mint a refresh token.
   *
   * Only pass true when a refresh token is genuinely required -- a first
   * connection, or one whose stored token is dead. Google caps an account at
   * 100 live refresh tokens per client and silently evicts the oldest beyond
   * that, so prompting on every reconnect would slowly destroy older grants.
   */
  forceConsent: boolean;
}

/**
 * Builds the consent URL.
 *
 * access_type=offline plus prompt=consent is what makes Google return a
 * refresh_token at all. Note prompt=consent mints a NEW refresh token on every
 * run, and Google caps an account at 100 live refresh tokens per client, so
 * this must not be loop-tested.
 */
export function buildAuthorizeUrl(params: BuildAuthorizeUrlParams): string {
  const query = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: "code",
    scope: params.scopes.join(" "),
    // access_type=offline is ALWAYS sent: it is the precondition for offline
    // access at all. prompt=consent is what actually re-mints a refresh token,
    // and is sent only when one is needed.
    access_type: "offline",
    // ========================================================================
    // `true` IS LOAD-BEARING. `false` REVOKES THE OTHER INTEGRATIONS. (ADR-053a)
    // ========================================================================
    //
    // This read `false` until Checkpoint 7.8A, on the same least-privilege
    // reasoning the Gmail client used -- and with the same inverted effect.
    //
    // `include_granted_scopes=false` does not merely decline to widen the new
    // TOKEN. It makes the consent NON-ADDITIVE, so the grant it produces
    // DEFINES what the app may do and everything the account previously
    // granted is dropped. Google's consent model is per APP, and all three of
    // this project's OAuth clients live in one Google Cloud project --
    // therefore one consent screen, therefore ONE grant set. Separate clients
    // give separate tokens; they do not give separate grants.
    //
    // Proven the expensive way. Checkpoint 7.2's GMAIL consent on 2026-08-31
    // left the account granting `gmail.metadata` alone, and this Health
    // connection failed `invalid_grant` 56 minutes later at its next refresh --
    // `request_count = 0`, refused at the grant before any API call. The three
    // scopes below were simply no longer granted. Health had run since Phase 6.
    //
    // Symmetry is the point: with Gmail additive and Health not, reauthorizing
    // Health would revoke Gmail and Calendar -- the same incident, during the
    // recovery meant to end it. Both must be additive, or neither helps.
    //
    // What Personal OS REQUESTS is unchanged and asserted by test: exactly the
    // three PHASE_6A_SCOPES, all `.readonly`, and never the fourth
    // (`googlehealth.settings.readonly`) that ADR-046 cut with paired-device
    // support. Incremental authorization changes what the returned TOKEN may
    // carry; it must never change what is asked for.
    include_granted_scopes: "true",
    state: params.state,
  });
  if (params.forceConsent) query.set("prompt", "consent");
  return `${GOOGLE_AUTH_ENDPOINT}?${query.toString()}`;
}

export interface ExchangeHealthAuthCodeParams extends GoogleHealthOAuthCredentials {
  code: string;
  /** MUST match the redirect_uri used to obtain the code, and the allowlist. */
  redirectUri: string;
  /**
   * Whether a missing refresh_token is an error. Defaults to true.
   *
   * Pass false only when a usable refresh token is already stored for this
   * account, i.e. when consent was deliberately not re-prompted.
   */
  requireRefreshToken?: boolean;
}

/**
 * Exchanges a one-time authorization code for an access/refresh pair.
 *
 * No id_token is requested or expected: the three Health read scopes carry no
 * identity claim, so the account is identified afterwards via users.getIdentity
 * (healthUserId), not from a JWT.
 */
export async function exchangeHealthAuthCode(
  params: ExchangeHealthAuthCodeParams,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<ExchangedHealthTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
    redirect_uri: params.redirectUri,
  });

  const token = await readToken(await postForm(GOOGLE_TOKEN_ENDPOINT, body, fetchFn));

  if (!token.refresh_token && params.requireRefreshToken !== false) {
    throw new GoogleHealthOAuthError(
      "Google did not return a refresh_token on the authorization_code exchange " +
        "(this typically means the request omitted access_type=offline and/or prompt=consent)",
      500,
      undefined,
    );
  }

  return {
    accessToken: token.access_token,
    refreshToken: token.refresh_token ?? null,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
    scope: token.scope,
  };
}

export interface RefreshHealthTokenParams extends GoogleHealthOAuthCredentials {
  refreshToken: string;
}

/**
 * Exchanges a stored refresh token for a fresh access token.
 *
 * Google does NOT always return a new refresh_token here, so callers must keep
 * using the stored one. This function deliberately does not surface one, so a
 * caller cannot accidentally overwrite a good refresh token with undefined.
 */
export async function refreshHealthAccessToken(
  params: RefreshHealthTokenParams,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<RefreshedHealthTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const token = await readToken(await postForm(GOOGLE_TOKEN_ENDPOINT, body, fetchFn));

  return {
    accessToken: token.access_token,
    expiresAt: new Date(Date.now() + token.expires_in * 1000),
  };
}

/**
 * Best-effort revocation at Google. Resolves false rather than throwing on
 * failure: a disconnect must always proceed to NULL the local credentials even
 * if Google is unreachable, or a user could be stuck unable to disconnect.
 */
export async function revokeHealthToken(
  token: string,
  fetchFn: FetchLike = globalThis.fetch,
): Promise<boolean> {
  try {
    const response = await postForm(
      GOOGLE_REVOKE_ENDPOINT,
      new URLSearchParams({ token }),
      fetchFn,
    );
    return response.ok;
  } catch {
    return false;
  }
}
