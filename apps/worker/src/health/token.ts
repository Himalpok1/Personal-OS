import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import { healthConnections, type Db } from "@personal-os/db";
import {
  GoogleHealthOAuthError,
  refreshHealthAccessToken,
  type RefreshedHealthTokens,
  type RefreshHealthTokenParams,
} from "@personal-os/health-providers";
import { eq } from "drizzle-orm";
import { env } from "../env.js";

// Worker-LOCAL Google Health access-token resolution.
//
// WHY THIS IS NOT AN IMPORT FROM apps/api:
//
// apps/api owns an equivalent `resolveFreshHealthAccessToken` in
// services/health-connection.ts. The worker does not import it, exactly as
// calendar-sync-calendar.ts keeps its own private copy rather than reaching
// into the API's service layer: apps/api and apps/worker are separate
// processes whose only interface is Postgres and pg-boss (ARCHITECTURE.md).
// An import would make the worker's build depend on the HTTP app's module
// graph -- Fastify plugins, route registration, request-scoped config -- for
// the sake of forty lines.
//
// The near-duplication is deliberate and the two differ in ways that matter,
// which is the second reason not to share:
//
//   * The API refreshes opportunistically, once, per request. The worker
//     refreshes under a PASS BUDGET: a sync pass fans out across eighteen
//     streams, so an unbudgeted refresh-on-401 could hammer Google's token
//     endpoint eighteen times in one pass with the same dead grant.
//   * The API can 409 back to a human. The worker cannot, so it has to
//     distinguish "permanently dead grant" (record it and stop) from
//     "transient" (leave the connection alone and let the hourly cron retry)
//     with much more care -- see needsReauth below.
//
// NOTHING IN THIS FILE EVER LOGS, RETURNS OR STORES A TOKEN.

/** Refresh this far before the recorded expiry rather than at it. */
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * The per-pass refresh allowance.
 *
 * A mutable counter rather than a boolean because it is SHARED by two
 * independent paths -- the proactive refresh when a stored token is already
 * near expiry, and the reactive refresh-and-retry after a 401 mid-pass -- and
 * "exactly one refresh per pass" must hold across both of them together, not
 * once each. One object is threaded through the whole pass so the second path
 * can see that the first already spent it.
 */
export interface RefreshBudget {
  remaining: number;
}

export function createRefreshBudget(): RefreshBudget {
  return { remaining: 1 };
}

/** Google Health OAuth is not configured on this deployment. */
export class HealthNotConfiguredError extends Error {
  constructor() {
    super("GOOGLE_HEALTH_OAUTH_CLIENT_ID/_SECRET are not set");
    this.name = "HealthNotConfiguredError";
  }
}

/**
 * The grant is permanently dead. The connection has already been marked
 * needs_reauth by the time this is thrown.
 *
 * A distinct type because the caller's obligation is distinct: record a failed
 * run, alert once, and RETURN. Throwing this out of a pg-boss handler would
 * turn a dead grant into a retry storm against Google's token endpoint.
 */
export class HealthAuthPermanentError extends Error {
  readonly reason: string;
  constructor(reason: string) {
    super(`google health grant is permanently invalid (${reason})`);
    this.name = "HealthAuthPermanentError";
    this.reason = reason;
  }
}

/**
 * A 401 arrived after this pass had already spent its single refresh.
 *
 * Deliberately NOT treated as a dead grant: one 401 after one successful
 * refresh is far more likely to be a Google-side propagation blip than proof
 * that the user revoked consent, and marking needs_reauth on it would log the
 * user out of Health for a transient fault. The pass aborts instead and the
 * hourly cron re-derives everything from current state.
 */
export class HealthRefreshBudgetExhaustedError extends Error {
  constructor() {
    super("google health refresh budget exhausted for this pass");
    this.name = "HealthRefreshBudgetExhaustedError";
  }
}

export type HealthConnectionRow = typeof healthConnections.$inferSelect;

export type RefreshFn = (params: RefreshHealthTokenParams) => Promise<RefreshedHealthTokens>;

export interface ResolveTokenOptions {
  /**
   * Refresh even when the stored access token still looks fresh.
   *
   * Set only by the 401-retry path: Google has just told us the token is bad,
   * so its recorded expiry is not evidence of anything.
   */
  force?: boolean;
  /** Injected in tests. Defaults to the real token endpoint. */
  refresh?: RefreshFn;
}

function encryptedFromColumns(
  ciphertext: Buffer | null,
  iv: Buffer | null,
  authTag: Buffer | null,
): EncryptedSecret | null {
  // Migration 0013 CHECKs each credential triple all-or-nothing, so a partial
  // triple is unrepresentable in the database. The guard stays because this
  // function is also handed rows built in tests.
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag };
}

/** Records that the grant is dead and the user must re-authorize. */
export async function markHealthConnectionNeedsReauth(
  db: Db,
  connectionId: string,
  reason: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(healthConnections)
    .set({
      status: "needs_reauth",
      // `reason` is always one of this module's own literals -- never an
      // upstream message. GoogleHealthOAuthError.message is Google's prose and
      // must not reach a stored column.
      lastSyncError: reason,
      lastSyncErrorAt: now,
      updatedAt: now,
    })
    .where(eq(healthConnections.id, connectionId));
}

/**
 * Returns a usable Google Health access token for `connection`.
 *
 * Reuses the stored token when it is more than a minute from expiry;
 * otherwise spends the pass's single refresh allowance.
 *
 * @throws HealthNotConfiguredError    OAuth client env vars absent
 * @throws HealthAuthPermanentError    dead grant; connection already marked
 * @throws HealthRefreshBudgetExhaustedError  refresh needed but already spent
 * @throws GoogleHealthOAuthError      transient token-endpoint failure
 */
export async function resolveFreshHealthAccessToken(
  db: Db,
  connection: HealthConnectionRow,
  budget: RefreshBudget,
  now: Date = new Date(),
  options: ResolveTokenOptions = {},
): Promise<string> {
  const accessSecret = encryptedFromColumns(
    connection.accessTokenCiphertext,
    connection.accessTokenIv,
    connection.accessTokenAuthTag,
  );
  const refreshSecret = encryptedFromColumns(
    connection.refreshTokenCiphertext,
    connection.refreshTokenIv,
    connection.refreshTokenAuthTag,
  );

  const expiresAt = connection.accessTokenExpiresAt;
  const stillFresh =
    accessSecret !== null &&
    expiresAt !== null &&
    expiresAt.getTime() - now.getTime() > TOKEN_EXPIRY_SAFETY_MARGIN_MS;

  if (stillFresh && options.force !== true && accessSecret) {
    return decryptSecret(accessSecret, env.CREDENTIALS_ENCRYPTION_KEY);
  }

  const clientId = env.GOOGLE_HEALTH_OAUTH_CLIENT_ID;
  const clientSecret = env.GOOGLE_HEALTH_OAUTH_CLIENT_SECRET;
  if (clientId === undefined || clientSecret === undefined) {
    // Both env vars are OPTIONAL (see apps/worker/src/env.ts), so the worker
    // boots on a deployment where Health was never configured. Degrading to a
    // typed error the orchestrator logs and skips is the point -- a crash-loop
    // here would take the calendar, capture and notification queues down with
    // it.
    throw new HealthNotConfiguredError();
  }

  if (refreshSecret === null) {
    // No stored refresh token and a token that is expired (or force-refreshed
    // after a 401). Nothing this process can do without fresh user consent, so
    // this is treated identically to invalid_grant.
    await markHealthConnectionNeedsReauth(db, connection.id, "no_refresh_token_stored", now);
    throw new HealthAuthPermanentError("no_refresh_token_stored");
  }

  if (budget.remaining <= 0) {
    throw new HealthRefreshBudgetExhaustedError();
  }
  // Decremented BEFORE the call, not after: a refresh that throws still
  // consumed the allowance. Decrementing on success only would let a failing
  // token endpoint be hit once per stream.
  budget.remaining -= 1;

  const refreshFn = options.refresh ?? refreshHealthAccessToken;
  let refreshed: RefreshedHealthTokens;
  try {
    refreshed = await refreshFn({
      clientId,
      clientSecret,
      refreshToken: decryptSecret(refreshSecret, env.CREDENTIALS_ENCRYPTION_KEY),
    });
  } catch (err) {
    if (err instanceof GoogleHealthOAuthError && err.isPermanent) {
      // invalid_grant / invalid_client ONLY. A 500 from Google's token
      // endpoint, a socket reset, or a bare 401 from the Health API are all
      // explicitly NOT this: marking needs_reauth on any of them would sign
      // the user out of Health because Google had a bad minute.
      const reason = `oauth_${err.googleErrorCode ?? "invalid_grant"}`;
      await markHealthConnectionNeedsReauth(db, connection.id, reason, now);
      throw new HealthAuthPermanentError(reason);
    }
    throw err;
  }

  const secret = encryptSecret(refreshed.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  await db
    .update(healthConnections)
    .set({
      accessTokenCiphertext: secret.ciphertext,
      accessTokenIv: secret.iv,
      accessTokenAuthTag: secret.authTag,
      accessTokenExpiresAt: refreshed.expiresAt,
      updatedAt: now,
    })
    .where(eq(healthConnections.id, connection.id));
  // The refresh-token columns are deliberately NOT in that SET. Google usually
  // omits a refresh_token on a refresh grant, and RefreshedHealthTokens does
  // not even carry one -- so there is nothing to write, and a naive
  // "overwrite everything" update would null the only credential that lets
  // this connection ever recover.

  return refreshed.accessToken;
}
