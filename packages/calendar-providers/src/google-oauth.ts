// Google OAuth 2.0 token exchange/refresh, plus a bare-minimum decode of the
// OIDC id_token that Google's token endpoint returns alongside the access
// token on the initial authorization_code exchange. This is the only place
// a Google account's stable identity (sub/email) should ever be derived --
// never infer it from a calendar-scoped API response, which is not an
// identity assertion and can be re-shared/re-permissioned independently.
//
// Signature verification of the id_token is deliberately skipped: this code
// runs server-side (the worker process, per this package's contract with
// its only consumer) and receives the token directly from Google's token
// endpoint over TLS in the same request/response as the access token it's
// about to trust anyway -- there is no untrusted third party in the path
// that a JWT signature check would be defending against here.

const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface ExchangeAuthCodeParams extends GoogleOAuthCredentials {
  code: string;
}

export interface ExchangedGoogleTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: Date;
  scope: string;
  /** OIDC `sub` claim -- the stable, unique Google account identifier. */
  googleAccountId: string;
  googleAccountEmail: string;
}

export interface RefreshAccessTokenParams extends GoogleOAuthCredentials {
  refreshToken: string;
}

export interface RefreshedGoogleTokens {
  accessToken: string;
  expiresAt: Date;
}

interface GoogleTokenErrorBody {
  error?: string;
  error_description?: string;
}

interface GoogleTokenSuccessBody {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  id_token?: string;
  token_type: string;
}

/**
 * Thrown whenever Google's token endpoint returns a non-2xx response.
 * `googleErrorCode` carries Google's own machine-readable error string (e.g.
 * "invalid_grant") so callers can classify permanent failures (the grant was
 * revoked or has expired -- the user must re-authorize) from transient ones
 * (network blips, Google 5xx) without string-matching a human message.
 */
export class GoogleOAuthError extends Error {
  readonly googleErrorCode: string | undefined;
  readonly httpStatus: number;

  constructor(message: string, httpStatus: number, googleErrorCode: string | undefined) {
    super(message);
    this.name = "GoogleOAuthError";
    this.httpStatus = httpStatus;
    this.googleErrorCode = googleErrorCode;
  }

  /** True for grants that are permanently dead and need a fresh user re-auth. */
  get isPermanent(): boolean {
    return this.googleErrorCode === "invalid_grant" || this.googleErrorCode === "invalid_client";
  }
}

async function postToken(body: URLSearchParams): Promise<GoogleTokenSuccessBody> {
  const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });

  if (!response.ok) {
    let parsedError: GoogleTokenErrorBody = {};
    try {
      parsedError = (await response.json()) as GoogleTokenErrorBody;
    } catch {
      // Non-JSON error body -- fall through with an empty parsedError.
    }
    throw new GoogleOAuthError(
      parsedError.error_description ?? `Google token endpoint returned HTTP ${response.status}`,
      response.status,
      parsedError.error,
    );
  }

  return (await response.json()) as GoogleTokenSuccessBody;
}

interface DecodedIdToken {
  sub: string;
  email: string;
}

// Decodes (without verifying) the base64url-encoded JWT payload segment.
function decodeIdTokenPayload(idToken: string): DecodedIdToken {
  const segments = idToken.split(".");
  if (segments.length !== 3) {
    throw new GoogleOAuthError("id_token is not a well-formed JWT", 500, undefined);
  }
  const payloadSegment = segments[1];
  if (payloadSegment === undefined) {
    throw new GoogleOAuthError("id_token is missing its payload segment", 500, undefined);
  }
  const base64 = payloadSegment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  const json = Buffer.from(padded, "base64").toString("utf8");
  const payload = JSON.parse(json) as { sub?: unknown; email?: unknown };
  if (typeof payload.sub !== "string" || payload.sub.length === 0) {
    throw new GoogleOAuthError("id_token payload is missing a `sub` claim", 500, undefined);
  }
  if (typeof payload.email !== "string" || payload.email.length === 0) {
    throw new GoogleOAuthError("id_token payload is missing an `email` claim", 500, undefined);
  }
  return { sub: payload.sub, email: payload.email };
}

/**
 * Exchanges a one-time OAuth authorization code for an access/refresh token
 * pair, and extracts the account's stable identity from the accompanying
 * OIDC id_token. Throws {@link GoogleOAuthError} on any non-2xx response.
 */
export async function exchangeAuthCode(params: ExchangeAuthCodeParams): Promise<ExchangedGoogleTokens> {
  // No redirect_uri: this app's native AuthorizationClient flow (Checkpoint
  // 4.5 Stage A) never involves a redirect at all -- the code comes back
  // through an on-device Activity result, not a browser redirect. Sending a
  // redirect_uri here would be describing a request that never happened, and
  // Stage A's real device-to-Google exchange was verified to succeed with
  // this exact parameter set (no redirect_uri) against a real account.
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    code: params.code,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const tokenResponse = await postToken(body);

  if (!tokenResponse.refresh_token) {
    throw new GoogleOAuthError(
      "Google did not return a refresh_token on the authorization_code exchange " +
        "(this typically means the request omitted access_type=offline and/or prompt=consent)",
      500,
      undefined,
    );
  }
  if (!tokenResponse.id_token) {
    throw new GoogleOAuthError(
      "Google did not return an id_token on the authorization_code exchange " +
        "(this typically means the request's scope list omitted openid/email)",
      500,
      undefined,
    );
  }

  const identity = decodeIdTokenPayload(tokenResponse.id_token);

  return {
    accessToken: tokenResponse.access_token,
    refreshToken: tokenResponse.refresh_token,
    expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
    scope: tokenResponse.scope,
    googleAccountId: identity.sub,
    googleAccountEmail: identity.email,
  };
}

/**
 * Exchanges a stored refresh token for a fresh access token. Google does NOT
 * always return a new refresh_token on this call -- callers must keep using
 * the existing stored refresh token when this response omits one.
 */
export async function refreshAccessToken(params: RefreshAccessTokenParams): Promise<RefreshedGoogleTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    client_secret: params.clientSecret,
  });

  const tokenResponse = await postToken(body);

  return {
    accessToken: tokenResponse.access_token,
    expiresAt: new Date(Date.now() + tokenResponse.expires_in * 1000),
  };
}
