import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import { mailConnections, mailOauthStates, type Db } from "@personal-os/db";
import {
  buildGmailAuthorizeUrl,
  exchangeGmailAuthCode,
  GmailOAuthError,
  PHASE_7_MAIL_SCOPES,
  resolveMailIdentity,
  revokeGmailToken,
  type MailClient,
} from "@personal-os/mail-providers";
import { and, eq, isNull } from "drizzle-orm";
import { env } from "../env.js";

// The Gmail connection lifecycle (ADR-052/053, Checkpoint 7.2).
//
// Deliberately a NEAR-COPY of services/health-connection.ts wherever the
// semantics match. That machinery -- hash-only state, atomic single-use
// consumption, redirect binding, exact-match allowlist, revoke-then-clear
// disconnect -- is proven in production, and premature abstraction over two
// providers whose flows differ in one structural way would be worse than
// duplication. Phase 6 made the same call about its own OAuth module and was
// right.
//
// THE ONE STRUCTURAL DIFFERENCE, and everything downstream of it:
// Health is single-account by nature and looks its prior connection up with
// `.limit(1)` BEFORE spending the authorization code. Mail is not: ADR-052
// permits multiple legitimate mailboxes, identity is
// (provider, external_account_id), and WHICH mailbox is being connected is
// unknowable until the profile call has run -- which requires the exchange to
// have already happened. The order below is therefore exchange-then-identify,
// and the refresh-token decision that Health makes up front is made after
// identity here instead. See completeGmailConnection.

const PROVIDER = "gmail";

// A state lives just long enough for a human to complete a consent screen.
const STATE_TTL_MS = 10 * 60_000;

export class MailNotConfiguredError extends Error {
  constructor() {
    super("Gmail OAuth is not configured on this server");
    this.name = "MailNotConfiguredError";
  }
}

export class InvalidMailRedirectUriError extends Error {
  constructor() {
    // Deliberately says nothing about what WAS allowed -- an attacker probing
    // redirect URIs learns only that theirs was rejected.
    super("redirect_uri is not in the server-side allowlist");
    this.name = "InvalidMailRedirectUriError";
  }
}

export class InvalidMailStateError extends Error {
  constructor(reason: string) {
    super(`OAuth state ${reason}`);
    this.name = "InvalidMailStateError";
  }
}

export class MissingRefreshTokenError extends Error {
  constructor() {
    // No identifiers: this message reaches a client response.
    super("Google issued no refresh token and none is stored for this mailbox");
    this.name = "MissingRefreshTokenError";
  }
}

export interface MailOAuthConfig {
  clientId: string;
  clientSecret: string;
  allowedRedirectUris: readonly string[];
}

/**
 * Reads the Gmail OAuth configuration, or throws if it is absent.
 *
 * All three env vars are optional so the API still boots without them; every
 * mail route surfaces that as a structured 409 rather than the process refusing
 * to start. An unconfigured Gmail integration must never take down capture,
 * calendar, health, reminders or notifications.
 */
export function getMailOAuthConfig(): MailOAuthConfig {
  const clientId = env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET;
  const allowed = env.GMAIL_OAUTH_REDIRECT_URI;
  // All-or-nothing: a half-configured client cannot complete a flow, and
  // failing at the route with one clear code beats failing at Google with three
  // different ones.
  if (!clientId || !clientSecret || allowed.length === 0) throw new MailNotConfiguredError();
  return { clientId, clientSecret, allowedRedirectUris: allowed };
}

export function isMailConfigured(): boolean {
  try {
    getMailOAuthConfig();
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
export function assertAllowedMailRedirectUri(config: MailOAuthConfig, redirectUri: string): void {
  if (!config.allowedRedirectUris.includes(redirectUri)) throw new InvalidMailRedirectUriError();
}

function hashState(state: string): string {
  return createHash("sha256").update(state).digest("hex");
}

export interface CreatedMailOAuthState {
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
export async function createMailOAuthState(
  db: Db,
  redirectUri: string,
  now: Date = new Date(),
): Promise<CreatedMailOAuthState> {
  const state = randomBytes(32).toString("base64url");
  const expiresAt = new Date(now.getTime() + STATE_TTL_MS);
  await db.insert(mailOauthStates).values({ stateHash: hashState(state), redirectUri, expiresAt });
  return { state, expiresAt };
}

/**
 * Consumes a state exactly once, checking expiry and redirect binding.
 *
 * The single-use guarantee comes from the UPDATE ... WHERE consumed_at IS NULL
 * ... RETURNING, which is atomic in Postgres. Two concurrent callbacks racing
 * on one state cannot both win.
 */
export async function consumeMailOAuthState(
  db: Db,
  state: string,
  redirectUri: string,
  now: Date = new Date(),
): Promise<void> {
  const [row] = await db
    .update(mailOauthStates)
    .set({ consumedAt: now })
    .where(and(eq(mailOauthStates.stateHash, hashState(state)), isNull(mailOauthStates.consumedAt)))
    .returning();

  // Covers both "no such state" and "already consumed" with one message, so a
  // replay cannot be distinguished from a forgery.
  if (!row) throw new InvalidMailStateError("is unknown, already used, or expired");
  if (row.expiresAt.getTime() <= now.getTime()) throw new InvalidMailStateError("has expired");

  // A state minted for one allowlisted redirect must not be replayable against
  // another.
  const a = Buffer.from(row.redirectUri);
  const b = Buffer.from(redirectUri);
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    throw new InvalidMailStateError("was issued for a different redirect_uri");
  }
}

// Expired states are deleted by the worker's daily `retention.cleanup` job
// (apps/worker/src/jobs/retention-cleanup.ts, Checkpoint 9.0 Part D), on the
// row's own `expires_at` alone -- the same arrangement as health_oauth_states.
// The sweep function that used to live here was never referenced anywhere,
// not even by a test (ADR-057 #1 as sharpened by the 8.6 decision record), and
// was removed rather than wired for the reason given in health-connection.ts.

type MailConnectionRow = typeof mailConnections.$inferSelect;

function toEncryptedSecret(
  ciphertext: Buffer | null,
  iv: Buffer | null,
  authTag: Buffer | null,
): EncryptedSecret | null {
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag };
}

function encryptedColumns(secret: EncryptedSecret) {
  return { ciphertext: secret.ciphertext, iv: secret.iv, authTag: secret.authTag };
}

export interface CompleteMailConnectionParams {
  db: Db;
  client: MailClient;
  code: string;
  redirectUri: string;
  state: string;
  now?: Date;
}

export interface CompleteMailConnectionResult {
  connection: MailConnectionRow;
  created: boolean;
}

/**
 * The whole connect path, start to finish. Both entry points call this.
 *
 * ORDER IS DEFENSIVE AND DELIBERATE:
 *
 *  1. allowlist the redirect and 2. consume the state BEFORE the authorization
 *     code is spent, so a forged or replayed callback never causes a token
 *     exchange;
 *  3. exchange, then 4. resolve identity from users.getProfile -- NOT from an
 *     id_token, because `gmail.metadata` authorises the profile call and adding
 *     `openid`/`email` to get a JWT would widen a consent screen that already
 *     carries restricted Calendar and Health grants for no gain;
 *  5. only THEN look the mailbox up, because until the profile call returns we
 *     do not know which of several legitimate mailboxes this is;
 *  6. reject a grant with no usable refresh token before writing anything, so a
 *     connection that could never sync unattended is not persisted as active;
 *  7. encrypt, and 8. upsert on (provider, external_account_id).
 *
 * Nothing is written until identity is verified, so a failure part-way through
 * cannot persist an unverified connection.
 */
export async function completeGmailConnection(
  params: CompleteMailConnectionParams,
): Promise<CompleteMailConnectionResult> {
  const now = params.now ?? new Date();
  const config = getMailOAuthConfig();

  assertAllowedMailRedirectUri(config, params.redirectUri);
  await consumeMailOAuthState(params.db, params.state, params.redirectUri, now);

  const tokens = await exchangeGmailAuthCode(
    {
      clientId: config.clientId,
      clientSecret: config.clientSecret,
      code: params.code,
      redirectUri: params.redirectUri,
    },
    undefined,
    now.getTime(),
  );

  // Identity from users.getProfile, which also yields the bootstrap cursor.
  const identity = await resolveMailIdentity(params.client, tokens.accessToken);

  // Lookup happens HERE, after identity, and is scoped to this mailbox. This is
  // what stops a callback for mailbox B overwriting mailbox A's connection --
  // the failure mode Health cannot have because it is single-account.
  const [prior] = await params.db
    .select()
    .from(mailConnections)
    .where(
      and(
        eq(mailConnections.provider, PROVIDER),
        eq(mailConnections.externalAccountId, identity.externalAccountId),
      ),
    )
    .limit(1);

  const priorRefresh = prior
    ? toEncryptedSecret(
        prior.refreshTokenCiphertext,
        prior.refreshTokenIv,
        prior.refreshTokenAuthTag,
      )
    : null;

  // Google omits refresh_token on most re-authorizations. That is fine when we
  // already hold one for THIS mailbox and fatal when we do not: without it the
  // connection could never refresh unattended, and persisting it as `active`
  // would be a lie the next checkpoint would trip over.
  if (tokens.refreshToken === null && priorRefresh === null) {
    throw new MissingRefreshTokenError();
  }

  const accessSecret = encryptSecret(tokens.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  const access = encryptedColumns(accessSecret);
  const refreshSecret = tokens.refreshToken
    ? encryptSecret(tokens.refreshToken, env.CREDENTIALS_ENCRYPTION_KEY)
    : null;

  const base = {
    provider: PROVIDER,
    externalAccountId: identity.externalAccountId,
    accessTokenCiphertext: access.ciphertext,
    accessTokenIv: access.iv,
    accessTokenAuthTag: access.authTag,
    accessTokenExpiresAt: tokens.expiresAt,
    grantedScope: tokens.grantedScope,
    identityVerifiedAt: now,
    status: "active" as const,
    // A successful reconnect clears whatever failure sent the user here.
    lastSyncError: null,
    lastSyncErrorAt: null,
    updatedAt: now,
  };

  // Only overwrite the refresh triple when Google actually issued one --
  // otherwise the stored token, which is still valid, would be destroyed. The
  // all-or-nothing CHECK means a partial write is impossible either way.
  const refreshColumns = refreshSecret
    ? {
        refreshTokenCiphertext: refreshSecret.ciphertext,
        refreshTokenIv: refreshSecret.iv,
        refreshTokenAuthTag: refreshSecret.authTag,
      }
    : {};

  if (prior) {
    const [row] = await params.db
      .update(mailConnections)
      .set({ ...base, ...refreshColumns })
      .where(eq(mailConnections.id, prior.id))
      .returning();
    return { connection: row!, created: false };
  }

  const [row] = await params.db
    .insert(mailConnections)
    .values({ ...base, ...refreshColumns })
    .returning();
  return { connection: row!, created: true };
}

/**
 * Best-effort revocation at Google, then unconditional local credential
 * destruction.
 *
 * The row is KEPT, with every secret column NULLed and status set to
 * `disconnected` -- the same non-destructive shape health_connections and
 * calendar_connections use, so connection history survives. Revocation failure
 * never blocks the local clearing: a user must always be able to disconnect.
 *
 * NOTHING ELSE IS DELETED HERE. `mail_messages` rows are untouched by a
 * disconnect: the only automatic deletion of stored mail is the bounded,
 * age-based prune ADR-054 permits and requires, which lives in the worker's
 * `retention.cleanup` job (Checkpoint 8.6C) and keys on `internal_date`, never
 * on connection status. Unlike the Health disconnect there are no per-stream
 * flags to disable -- see reconnect semantics in the route module for why that
 * absence is deliberate rather than incidental.
 */
export async function disconnectGmailConnection(
  db: Db,
  connection: MailConnectionRow,
  now: Date = new Date(),
): Promise<{ connection: MailConnectionRow; revoked: boolean }> {
  let revoked = false;
  const refresh = toEncryptedSecret(
    connection.refreshTokenCiphertext,
    connection.refreshTokenIv,
    connection.refreshTokenAuthTag,
  );
  if (refresh) {
    try {
      revoked = await revokeGmailToken(decryptSecret(refresh, env.CREDENTIALS_ENCRYPTION_KEY));
    } catch {
      // Includes a decryption failure after a key rotation. Clearing must
      // proceed regardless.
      revoked = false;
    }
  }

  const [row] = await db
    .update(mailConnections)
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
    .where(eq(mailConnections.id, connection.id))
    .returning();

  return { connection: row!, revoked };
}

/**
 * Whether the next authorization must force the consent screen.
 *
 * Google caps an account at 100 live refresh tokens per client and silently
 * evicts the oldest, so `prompt=consent` on every reconnect would slowly
 * destroy older grants -- including the Calendar and Health ones held by the
 * same Google account. It is forced only when a new refresh token is genuinely
 * required.
 *
 * Scoped to ONE mailbox when the caller knows which, and true when it does not:
 * the authorize-url endpoint runs before identity is known, and a first
 * connection for an unknown mailbox always needs a refresh token. A caller that
 * passes no mailbox therefore gets the safe answer.
 */
export async function needsForcedConsent(db: Db, externalAccountId?: string): Promise<boolean> {
  if (externalAccountId === undefined) {
    // No mailbox named: this may be a brand-new connection, so force consent.
    // Being wrong in this direction costs one extra consent screen; being wrong
    // the other way costs a connection that can never refresh.
    return true;
  }
  const [row] = await db
    .select()
    .from(mailConnections)
    .where(
      and(
        eq(mailConnections.provider, PROVIDER),
        eq(mailConnections.externalAccountId, externalAccountId),
      ),
    )
    .limit(1);
  if (!row) return true;
  if (row.status !== "active") return true;
  return (
    toEncryptedSecret(row.refreshTokenCiphertext, row.refreshTokenIv, row.refreshTokenAuthTag) ===
    null
  );
}

/** The authorization URL for a fresh consent flow. */
export function buildMailAuthorizeUrl(
  config: MailOAuthConfig,
  redirectUri: string,
  state: string,
  forceConsent: boolean,
): string {
  return buildGmailAuthorizeUrl({
    clientId: config.clientId,
    redirectUri,
    state,
    forceConsent,
    // Exactly one scope, from the provider catalog. Never gmail.readonly, never
    // a mutation scope, never openid/email.
    scopes: PHASE_7_MAIL_SCOPES,
  });
}

export { GmailOAuthError };
export type { MailConnectionRow };
