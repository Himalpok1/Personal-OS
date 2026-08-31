import { decryptSecret, encryptSecret, type EncryptedSecret } from "@personal-os/ai-providers";
import { mailConnections, type Db } from "@personal-os/db";
import {
  GmailOAuthError,
  refreshGmailAccessToken,
  type RefreshAccessTokenParams,
  type RefreshedGmailTokens,
} from "@personal-os/mail-providers";
import { sanitizeMailSyncErrorCode, type MailSyncErrorCode } from "@personal-os/schema";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";

// Worker-LOCAL Gmail access-token resolution.
//
// WHY THIS IS NOT AN IMPORT FROM apps/api:
//
// apps/api owns the mail connection lifecycle in services/mail-connection.ts.
// The worker does not import it, exactly as health/token.ts keeps its own copy
// rather than reaching into the API's service layer: apps/api and apps/worker
// are separate processes whose only interface is Postgres and pg-boss
// (ARCHITECTURE.md). An import would make the worker's build depend on the HTTP
// app's module graph -- Fastify plugins, route registration, request-scoped
// config -- for the sake of forty lines.
//
// The near-duplication is deliberate and the two differ where it matters:
// the API can 409 back to a human, and the worker cannot, so the worker has to
// distinguish "permanently dead grant" (record it and stop) from "transient"
// (leave the connection alone and let the next tick retry) with much more care.
//
// NOTHING IN THIS FILE EVER LOGS, RETURNS OR STORES A TOKEN.

/** Refresh this far before the recorded expiry rather than at it. */
const TOKEN_EXPIRY_SAFETY_MARGIN_MS = 60_000;

/**
 * The per-pass refresh allowance.
 *
 * A mutable counter rather than a boolean because it is SHARED by two
 * independent paths -- the proactive refresh when a stored token is near
 * expiry, and the reactive refresh-and-retry after a 401 mid-pass -- and
 * "exactly one refresh per pass" must hold across both together, not once each.
 */
export interface MailRefreshBudget {
  remaining: number;
}

export function createMailRefreshBudget(): MailRefreshBudget {
  return { remaining: 1 };
}

/** Gmail OAuth is not configured on this deployment. */
export class MailNotConfiguredError extends Error {
  constructor() {
    super("GMAIL_OAUTH_CLIENT_ID/_SECRET are not set");
    this.name = "MailNotConfiguredError";
  }
}

/**
 * The grant is permanently dead. The connection has already been marked
 * `needs_reauth` by the time this is thrown.
 *
 * A distinct type because the caller's obligation is distinct: record a failed
 * run and RETURN. Throwing this out of a pg-boss handler would turn a dead
 * grant into a retry storm against Google's token endpoint.
 */
export class MailAuthPermanentError extends Error {
  readonly reason: MailSyncErrorCode;
  constructor(reason: MailSyncErrorCode) {
    super(`gmail grant is permanently invalid (${reason})`);
    this.name = "MailAuthPermanentError";
    this.reason = reason;
  }
}

/**
 * A 401 arrived after this pass had already spent its single refresh.
 *
 * Deliberately NOT treated as a dead grant: one 401 after one successful
 * refresh is far more likely to be a Google-side propagation blip than proof
 * the user revoked consent, and marking `needs_reauth` on it would log the user
 * out of mail for a transient fault. The pass aborts instead and the next tick
 * re-derives everything from current state.
 */
export class MailRefreshBudgetExhaustedError extends Error {
  constructor() {
    super("gmail refresh budget exhausted for this pass");
    this.name = "MailRefreshBudgetExhaustedError";
  }
}

/** No usable refresh token is stored, so unattended sync is impossible. */
export class MailNoRefreshTokenError extends Error {
  constructor() {
    super("mail connection has no stored refresh token");
    this.name = "MailNoRefreshTokenError";
  }
}

export type MailConnectionRow = typeof mailConnections.$inferSelect;

export type MailRefreshFn = (params: RefreshAccessTokenParams) => Promise<RefreshedGmailTokens>;

export interface ResolveMailTokenOptions {
  /**
   * Refresh even when the stored access token still looks fresh.
   *
   * Set only by the 401-retry path: the provider has just said the token is
   * bad, so its recorded expiry is not evidence of anything.
   */
  force?: boolean;
  /** Injected in tests. Defaults to the real token endpoint. */
  refresh?: MailRefreshFn;
}

function encryptedFromColumns(
  ciphertext: Buffer | null,
  iv: Buffer | null,
  authTag: Buffer | null,
): EncryptedSecret | null {
  // Migration 0014 CHECKs each credential triple all-or-nothing, so a partial
  // triple is unrepresentable in the database. The guard stays because this
  // function is also handed rows built in tests.
  if (!ciphertext || !iv || !authTag) return null;
  return { ciphertext, iv, authTag };
}

/**
 * Records that the grant is dead and the user must re-authorize.
 *
 * `reason` is typed to the closed `MailSyncErrorCode` and re-sanitized on the
 * way in, so a provider message cannot reach this column even if a future
 * caller passes one. That is the Checkpoint 6.5 lesson made structural: Google's
 * `error_description` reached a user's Settings screen through exactly this
 * kind of free-text column.
 */
export async function markMailConnectionNeedsReauth(
  db: Db,
  connectionId: string,
  reason: MailSyncErrorCode,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(mailConnections)
    .set({
      status: "needs_reauth",
      lastSyncError: sanitizeMailSyncErrorCode(reason),
      lastSyncErrorAt: now,
      updatedAt: now,
    })
    .where(eq(mailConnections.id, connectionId));
}

/** Records a non-fatal sync failure without changing the connection's status. */
export async function recordMailConnectionError(
  db: Db,
  connectionId: string,
  reason: MailSyncErrorCode,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(mailConnections)
    .set({
      lastSyncError: sanitizeMailSyncErrorCode(reason),
      lastSyncErrorAt: now,
      updatedAt: now,
    })
    .where(eq(mailConnections.id, connectionId));
}

/** Clears a recorded failure after a successful pass. */
export async function clearMailConnectionError(
  db: Db,
  connectionId: string,
  now: Date = new Date(),
): Promise<void> {
  await db
    .update(mailConnections)
    .set({ lastSyncError: null, lastSyncErrorAt: null, updatedAt: now })
    .where(eq(mailConnections.id, connectionId));
}

/**
 * Returns a usable Gmail access token for `connection`.
 *
 * Reuses the stored token when it is more than a minute from expiry; otherwise
 * spends the pass's single refresh allowance.
 *
 * THE STORED REFRESH TOKEN IS NEVER OVERWRITTEN HERE. `refreshGmailAccessToken`
 * returns only an access token and an expiry -- a deliberately narrower type
 * than the exchange's -- so a refresh structurally cannot clobber a good stored
 * refresh token with an absent one.
 *
 * @throws MailNotConfiguredError          OAuth client env vars absent
 * @throws MailNoRefreshTokenError         nothing to refresh with
 * @throws MailAuthPermanentError          dead grant; connection already marked
 * @throws MailRefreshBudgetExhaustedError refresh needed but already spent
 * @throws GmailOAuthError                 transient token-endpoint failure
 */
export async function resolveFreshMailAccessToken(
  db: Db,
  connection: MailConnectionRow,
  budget: MailRefreshBudget,
  now: Date = new Date(),
  options: ResolveMailTokenOptions = {},
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

  const clientId = env.GMAIL_OAUTH_CLIENT_ID;
  const clientSecret = env.GMAIL_OAUTH_CLIENT_SECRET;
  if (clientId === undefined || clientSecret === undefined) {
    // Both env vars are OPTIONAL (see ../env.ts), so the worker boots on a
    // deployment where mail was never configured. Degrading to a typed error
    // the orchestrator logs and skips is the point -- a crash-loop here would
    // take the calendar, capture, health and notification queues with it.
    throw new MailNotConfiguredError();
  }

  if (refreshSecret === null) throw new MailNoRefreshTokenError();

  if (budget.remaining <= 0) throw new MailRefreshBudgetExhaustedError();
  budget.remaining -= 1;

  const refreshFn = options.refresh ?? refreshGmailAccessToken;
  let refreshed: RefreshedGmailTokens;
  try {
    refreshed = await refreshFn({
      refreshToken: decryptSecret(refreshSecret, env.CREDENTIALS_ENCRYPTION_KEY),
      clientId,
      clientSecret,
    });
  } catch (err) {
    if (err instanceof GmailOAuthError && err.isPermanent) {
      // `invalid_grant`/`invalid_client` only. Everything else -- a 500, a
      // network fault, a rate limit at the token endpoint -- is left to the
      // next tick rather than logging the user out of their own mailbox.
      await markMailConnectionNeedsReauth(db, connection.id, "auth_expired", now);
      throw new MailAuthPermanentError("auth_expired");
    }
    throw err;
  }

  // The access triple is re-encrypted with the SAME master key apps/api used, so
  // both processes read each other's writes. The refresh triple is untouched.
  const secret = encryptSecret(refreshed.accessToken, env.CREDENTIALS_ENCRYPTION_KEY);
  await db
    .update(mailConnections)
    .set({
      accessTokenCiphertext: secret.ciphertext,
      accessTokenIv: secret.iv,
      accessTokenAuthTag: secret.authTag,
      accessTokenExpiresAt: refreshed.expiresAt,
      updatedAt: now,
    })
    // SCOPED BY STATUS AS WELL AS ID, deliberately.
    //
    // A disconnect landing between this pass reading the row and writing it back
    // must not have its credential-clearing undone. `disconnectGmailConnection`
    // NULLs every secret column and sets `disconnected`; a write scoped by id
    // alone would win last and resurrect a token the user had just revoked --
    // and would do it silently, because the CHECK is satisfied by a complete
    // triple whatever the status says.
    //
    // `docs/STATUS.md` records exactly this as a latent defect in the API's
    // health equivalent ("writes the access-token columns by id without
    // re-checking status ... last-write-wins"). It is not recreated here. The
    // token is still returned: this pass may use it, it simply may not persist
    // it to a connection that is no longer active.
    .where(and(eq(mailConnections.id, connection.id), eq(mailConnections.status, "active")));

  return refreshed.accessToken;
}
