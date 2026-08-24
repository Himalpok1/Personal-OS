import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import {
  healthConnections,
  healthMetricStreams,
  healthOauthStates,
  type Db,
} from "@personal-os/db";
import {
  exchangeHealthAuthCode,
  GoogleHealthOAuthError,
  HEALTH_METRICS,
  metricsForGrantedScopes,
  refreshHealthAccessToken,
  revokeHealthToken,
  type GoogleHealthClient,
} from "@personal-os/health-providers";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { env } from "../env.js";

// The single internal service both the GET callback and any manual completion
// path go through. Neither performs its own exchange -- if they did, the
// redirect allowlist, the state check and the account-mismatch guard would each
// have two implementations that could drift apart.

// A state lives just long enough for a human to complete a consent screen.
const STATE_TTL_MS = 10 * 60_000;
// Refresh a little before expiry so a long request cannot straddle the boundary.
const TOKEN_REFRESH_MARGIN_MS = 60_000;

export class HealthNotConfiguredError extends Error {
  constructor() {
    super("Google Health OAuth is not configured on this server");
    this.name = "HealthNotConfiguredError";
  }
}

export class InvalidRedirectUriError extends Error {
  constructor() {
    // Deliberately says nothing about what WAS allowed -- an attacker probing
    // redirect URIs learns only that theirs was rejected.
    super("redirect_uri is not in the server-side allowlist");
    this.name = "InvalidRedirectUriError";
  }
}

export class InvalidStateError extends Error {
  constructor(reason: string) {
    super(`OAuth state ${reason}`);
    this.name = "InvalidStateError";
  }
}

export class AccountMismatchError extends Error {
  constructor() {
    // No identifiers in the message: it reaches a client response.
    super("this Google Health account does not match the existing connection");
    this.name = "AccountMismatchError";
  }
}

export interface HealthOAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedRedirectUris: readonly string[];
}

/**
 * Reads the Health OAuth configuration, or throws if it is absent.
 *
 * The three env vars are optional so the API still boots without them; every
 * Health route surfaces that as a structured 409 rather than the process
 * refusing to start, mirroring the AI layer's no_provider_configured path.
 */
export function getHealthOAuthConfig(): HealthOAuthConfig {
  const clientId = env.GOOGLE_HEALTH_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_HEALTH_OAUTH_CLIENT_SECRET;
  const allowed = env.GOOGLE_HEALTH_OAUTH_REDIRECT_URI;
  if (!clientId || !clientSecret || allowed.length === 0) throw new HealthNotConfiguredError();
  return { clientId, clientSecret, allowedRedirectUris: allowed };
}

export function isHealthConfigured(): boolean {
  try {
    getHealthOAuthConfig();
    return true;
  } catch {
    return false;
  }
}

/**
 * Exact-match allowlist check.
 *
 * No normalization, no prefix matching, no wildcards, no trailing-slash
 * tolerance: every one of those is a way for an open redirect to sneak in. The
 * value must be byte-identical to something configured, which is in turn
 * byte-identical to something registered in the Google Cloud Console.
 */
export function assertAllowedRedirectUri(config: HealthOAuthConfig, redirectUri: string): void {
  if (!config.allowedRedirectUris.includes(redirectUri)) throw new InvalidRedirectUriError();
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export interface CreatedOAuthState {
  state: string;
  expiresAt: Date;
}

/**
 * Mints a single-use OAuth state bound to one redirect URI.
 *
 * Only the sha256 is stored -- never the raw value -- mirroring how
 * device_pairing_codes stores only a hash. A database dump therefore cannot be
 * replayed into a consent flow.
 */
export async function createOAuthState(
  db: Db,
  redirectUri: string,
  now: Date = new Date(),
): Promise<CreatedOAuthState> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
  await db.insert(healthOauthStates).values({
    stateHash: hashState(state),
    redirectUri,
    expiresAt,
  });
  return { state, expiresAt };
}

/**
 * Consumes a state exactly once, checking expiry and redirect binding.
 *
 * The single-use guarantee comes from the UPDATE ... WHERE consumed_at IS NULL
 * ... RETURNING, which is atomic in Postgres -- the same pattern
 * routes/devices.ts uses for pairing codes. Two concurrent callbacks racing on
 * one state cannot both win.
 */
export async function consumeOAuthState(
  db: Db,
  state: string,
  redirectUri: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .update(healthOauthStates)
    .set({ consumedAt: now })
    .where(
      and(eq(healthOauthStates.stateHash, hashState(state)), isNull(healthOauthStates.consumedAt)),
    )
    .returning();

  // Covers both "no such state" and "already consumed" with one message, so a
  // replay cannot be distinguished from a forgery.
  if (!row) throw new InvalidStateError("is unknown, already used, or expired");
  if (row.expiresAt.getTime() <= now.getTime()) throw new InvalidStateError("has expired");

  // A state minted for one allowlisted redirect must not be replayable against
  // another. Constant-time only because the comparands are attacker-influenced
  // strings of equal expected shape; the lookup above is already a hash match.
  const a = Buffer.from(row.redirectUri);
  const b = Buffer.from(redirectUri);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidStateError("was issued for a different redirect_uri");
  }
}

/** Deletes states that can no longer be used. Operational metadata only. */
export async function sweepExpiredOAuthStates(db: Db, now: Date = new Date()): Promise<number> {
  const rows = await db
    .delete(healthOauthStates)
    .where(lt(healthOauthStates.expiresAt, now))
    .returning();
  return rows.length;
}

function encryptedColumns(secret: EncryptedSecret) {
  return { ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag };
}

function toEncryptedSecret(
  ciphertext: Buffer | null,
  iv: Buffer | null,
  authTag: Buffer | null,
): EncryptedSecret | null {
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag };
}

export type HealthConnectionRow = typeof healthConnections.$inferSelect;

export interface CompleteConnectionParams {
  db: Db;
  client: GoogleHealthClient;
  code: string;
  redirectUri: string;
  state: string;
  now?: Date;
}

export interface CompleteConnectionResult {
  connection: HealthConnectionRow;
  created: boolean;
}

/**
 * The whole connect path, start to finish. Both entry points call this.
 *
 * Order matters and is defensive: the redirect and state are validated BEFORE
 * the authorization code is spent, so a forged callback never causes a token
 * exchange.
 */
export async function completeHealthConnection(
  params: CompleteConnectionParams,
): Promise<CompleteConnectionResult> {
  const now = params.now ?? new Date();
  const config = getHealthOAuthConfig();

  assertAllowedRedirectUri(config, params.redirectUri);
  await consumeOAuthState(params.db, params.state, params.redirectUri, now);

  const existing = await params.db.select().from(healthConnections).limit(1);
  const prior = existing[0];
  const priorRefresh = prior
    ? toEncryptedSecret(
        prior.refreshTokenCiphertext,
        prior.refreshTokenIv,
        prior.refreshTokenAuthTag,
      )
    : null;

  const tokens = await exchangeHealthAuthCode({
    clientId: config.clientId,
    clientSecret: config.clientSecret,
    code: params.code,
    redirectUri: params.redirectUri,
    // A missing refresh token is only tolerable when we already hold one.
    requireRefreshToken: priorRefresh === null,
  });

  // Identity comes from getIdentity, never from a JWT: the three Health read
  // scopes carry no identity claim and Google returns no id_token for them.
  const identity = await params.client.getIdentity(tokens.accessToken);

  if (prior && prior.healthUserId !== identity.healthUserId) {
    // Silently rebinding would attach one person's history to another account.
    throw new AccountMismatchError();
  }

  const accessSecret = encryptSecret(tokens.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  const access = encryptedColumns(accessSecret);
  const refreshSecret = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken, env.CREDENTIALS_ENCRYPTION_KEY)
    : null;

  const base = {
    provider: "google_health",
    healthUserId: identity.healthUserId,
    legacyUserId: identity.legacyUserId,
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenAuthTag: access.authTag,
    accessTokenExpiresAt: tokens.expiresAt,
    grantedScope: tokens.scope,
    identityVerifiedAt: now,
    status: "active" as const,
    lastSyncError: null,
    lastSyncErrorAt: null,
    updatedAt: now,
  };

  // Only overwrite the refresh triple when Google actually issued one --
  // otherwise the stored token, which is still valid, would be destroyed.
  const refreshColumns = refreshSecret
    ? {
        refreshTokenCiphertext: refreshSecret.ciphertext,
        refreshTokenIv: refreshSecret.iv,
        refreshTokenAuthTag: refreshSecret.authTag,
      }
    : {};

  let connection: HealthConnectionRow;
  let created: boolean;
  if (prior) {
    const [row] = await params.db
      .update(healthConnections)
      .set({ ...base, ...refreshColumns })
      .where(eq(healthConnections.id, prior.id))
      .returning();
    connection = row!;
    created = false;
  } else {
    const [row] = await params.db
      .insert(healthConnections)
      .values({ ...base, ...refreshColumns })
      .returning();
    connection = row!;
    created = true;
  }

  await syncStreamsForGrantedScopes(params.db, connection.id, tokens.scope, now);
  return { connection, created };
}

/**
 * Creates or updates one stream row per catalog metric, enabling only those
 * whose scope the user actually granted.
 *
 * Resolving partial consent HERE, at connect time, turns what would otherwise be
 * a storm of runtime 403s into a single recorded fact.
 */
export async function syncStreamsForGrantedScopes(
  db: Db,
  connectionId: string,
  grantedScope: string,
  now: Date = new Date(),
): Promise<void> {
  const granted = new Set(metricsForGrantedScopes(grantedScope));

  for (const metric of HEALTH_METRICS) {
    const isGranted = granted.has(metric);
    // Intraday heart rate stays off until the 6.2P identity-stability probe
    // passes: it is the only high-volume stream, and enabling it before its
    // identity strategy is proven would churn rows on every warm pass.
    const enabled = isGranted && metric !== "heart-rate-intraday";
    const values = {
      connectionId,
      metric,
      syncEnabled: enabled,
      lastSyncError: isGranted ? null : "scope_not_granted",
      updatedAt: now,
    };
    await db
      .insert(healthMetricStreams)
      .values(values)
      .onConflictDoUpdate({
        target: [healthMetricStreams.connectionId, healthMetricStreams.metric],
        // Deliberately does NOT reset sync_enabled: a user who turned a stream
        // off must not have it silently re-enabled by a reconnect. Only the
        // scope verdict is refreshed.
        set: {
          lastSyncError: values.lastSyncError,
          updatedAt: now,
          ...(isGranted ? {} : { syncEnabled: false }),
        },
      });
  }
}

export interface FreshAccessToken {
  accessToken: string;
  connection: HealthConnectionRow;
}

/**
 * Returns a usable access token, refreshing it if it is close to expiry.
 *
 * A permanently dead grant marks the connection needs_reauth and throws
 * GoogleHealthOAuthError with isPermanent true, so callers can distinguish
 * "reconnect required" from "try again later" without string matching.
 */
export async function resolveFreshAccessToken(
  db: Db,
  connection: HealthConnectionRow,
  now: Date = new Date(),
): Promise<FreshAccessToken> {
  const config = getHealthOAuthConfig();
  const access = toEncryptedSecret(
    connection.accessTokenCiphertext,
    connection.accessTokenIv,
    connection.accessTokenAuthTag,
  );

  const stillFresh =
    access !== null &&
    connection.accessTokenExpiresAt !== null &&
    connection.accessTokenExpiresAt.getTime() - now.getTime() > TOKEN_REFRESH_MARGIN_MS;

  if (stillFresh && access) {
    return { accessToken: decryptSecret(access, env.CREDENTIALS_ENCRYPTION_KEY), connection };
  }

  const refresh = toEncryptedSecret(
    connection.refreshTokenCiphertext,
    connection.refreshTokenIv,
    connection.refreshTokenAuthTag,
  );
  if (!refresh) {
    await markNeedsReauth(db, connection.id, "no refresh token stored", now);
    throw new GoogleHealthOAuthError("no refresh token stored", 401, "invalid_grant");
  }

  try {
    const refreshed = await refreshHealthAccessToken({
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      refreshToken: decryptSecret(refresh, env.CREDENTIALS_ENCRYPTION_KEY),
    });
    const secret = encryptSecret(refreshed.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
    const [row] = await db
      .update(healthConnections)
      .set({
        accessTokenCiphertext: secret.ciphertext,
        accessTokenIv: secret.iv,
        accessTokenAuthTag: secret.authTag,
        accessTokenExpiresAt: refreshed.expiresAt,
        lastSyncError: null,
        lastSyncErrorAt: null,
        updatedAt: now,
      })
      .where(eq(healthConnections.id, connection.id))
      .returning();
    return { accessToken: refreshed.accessToken, connection: row! };
  } catch (err) {
    if (err instanceof GoogleHealthOAuthError && err.isPermanent) {
      await markNeedsReauth(db, connection.id, `oauth ${err.googleErrorCode ?? "failure"}`, now);
    }
    throw err;
  }
}

/** Records that the grant is dead and the user must re-authorize. */
export async function markNeedsReauth(
  db: Db,
  connectionId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(healthConnections)
    .set({ status: "needs_reauth", lastSyncError: reason, lastSyncErrorAt: now, updatedAt: now })
    .where(eq(healthConnections.id, connectionId));
}

/**
 * Best-effort revocation at Google, then unconditional local credential
 * destruction.
 *
 * The row itself is KEPT, with every secret column NULLed and status set to
 * disconnected -- the same non-destructive shape calendar_connections uses, so
 * connection history survives a disconnect. Revocation failure never blocks the
 * local clearing: a user must always be able to disconnect.
 */
export async function disconnectHealthConnection(
  db: Db,
  connection: HealthConnectionRow,
  now: Date = new Date(),
): Promise<{ connection: HealthConnectionRow; revoked: boolean }> {
  let revoked = false;
  const refresh = toEncryptedSecret(
    connection.refreshTokenCiphertext,
    connection.refreshTokenIv,
    connection.refreshTokenAuthTag,
  );
  if (refresh) {
    try {
      revoked = await revokeHealthToken(decryptSecret(refresh, env.CREDENTIALS_ENCRYPTION_KEY));
    } catch {
      // Includes a decryption failure after a key rotation. Clearing must
      // proceed regardless.
      revoked = false;
    }
  }

  const [row] = await db
    .update(healthConnections)
    .set({
      accessTokenCiphertext: null,
      accessTokenIv: null,
      accessTokenAuthTag: null,
      accessTokenExpiresAt: null,
      refreshTokenCiphertext: null,
      refreshTokenIv: null,
      refreshTokenAuthTag: null,
      status: "disconnected",
      updatedAt: now,
    })
    .where(eq(healthConnections.id, connection.id))
    .returning();

  await db
    .update(healthMetricStreams)
    .set({ syncEnabled: false, updatedAt: now })
    .where(eq(healthMetricStreams.connectionId, connection.id));

  return { connection: row!, revoked };
}

/**
 * Whether the next authorization must force the consent screen.
 *
 * True when there is no connection, or its grant is unusable -- exactly the
 * cases where a new refresh token is genuinely required.
 */
export async function needsForcedConsent(db: Db): Promise<boolean> {
  const [row] = await db.select().from(healthConnections).limit(1);
  if (!row) return true;
  if (row.status !== "active") return true;
  return (
    toEncryptedSecret(row.refreshTokenCiphertext, row.refreshTokenIv, row.refreshTokenAuthTag) ===
    null
  );
}

/** Count of stored connections. Used only to keep the single-connection rule. */
export async function countHealthConnections(db: Db): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(healthConnections);
  return row?.n ?? 0;
}
