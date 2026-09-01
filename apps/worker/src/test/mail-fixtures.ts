import { encryptSecret } from "@personal-os/ai-providers";
import { mailConnections, mailSyncCursors, type Db } from "@personal-os/db";
import { GMAIL_MAILBOX_SCOPE } from "@personal-os/mail-providers";
import { and, eq } from "drizzle-orm";
import { env } from "../env.js";

// Fixtures for the mail sync tests.
//
// Deliberately builds connections through the REAL encryption path rather than
// stubbing it: `resolveFreshMailAccessToken` decrypts what it finds, so a
// fixture writing plaintext would exercise a code path production never takes
// and would hide a key-handling regression.

export interface SeedMailConnectionOptions {
  status?: "active" | "needs_reauth" | "revoked" | "disconnected";
  externalAccountId?: string;
  /** Null omits the triple entirely, which the all-or-nothing CHECK requires. */
  accessToken?: string | null;
  refreshToken?: string | null;
  /**
   * Defaults to FAR in the future, so the stored token is reused and no refresh
   * is attempted.
   *
   * Deliberately not `Date.now() + 1h`: tests inject their own clock, and a
   * fixture anchored to the system clock silently expires against any injected
   * `now` later in the same day -- which sends the pass down the refresh path
   * and, with no injected refresh function, into a REAL request to Google's
   * token endpoint. That is exactly what happened while writing these tests.
   */
  accessTokenExpiresAt?: Date | null;
}

let seq = 0;

export async function seedMailConnection(
  db: Db,
  options: SeedMailConnectionOptions = {},
): Promise<typeof mailConnections.$inferSelect> {
  seq += 1;
  const access =
    options.accessToken === null
      ? null
      : encryptSecret(options.accessToken ?? "test-access-token", env.CREDENTIALS_ENCRYPTION_KEY);
  const refresh =
    options.refreshToken === null
      ? null
      : encryptSecret(options.refreshToken ?? "test-refresh-token", env.CREDENTIALS_ENCRYPTION_KEY);

  const [row] = await db
    .insert(mailConnections)
    .values({
      provider: "gmail",
      externalAccountId: options.externalAccountId ?? `fixture-${seq}@example.test`,
      status: options.status ?? "active",
      accessTokenCiphertext: access?.ciphertext ?? null,
      accessTokenIv: access?.iv ?? null,
      accessTokenAuthTag: access?.authTag ?? null,
      accessTokenExpiresAt:
        options.accessTokenExpiresAt === undefined
          ? new Date("2099-01-01T00:00:00.000Z")
          : options.accessTokenExpiresAt,
      refreshTokenCiphertext: refresh?.ciphertext ?? null,
      refreshTokenIv: refresh?.iv ?? null,
      refreshTokenAuthTag: refresh?.authTag ?? null,
      grantedScope: "https://www.googleapis.com/auth/gmail.metadata",
      identityVerifiedAt: new Date(),
    })
    .returning();
  return row!;
}

/** Seeds the single mailbox-scope cursor row, as an already-synced connection has. */
export async function seedMailCursor(
  db: Db,
  connectionId: string,
  options: { cursorValue?: string | null; needsFullResync?: boolean } = {},
): Promise<typeof mailSyncCursors.$inferSelect> {
  const [row] = await db
    .insert(mailSyncCursors)
    .values({
      connectionId,
      scopeKey: GMAIL_MAILBOX_SCOPE,
      cursorKind: "gmail_history_id",
      cursorValue: options.cursorValue ?? "1000",
      needsFullResync: options.needsFullResync ?? false,
    })
    .returning();
  return row!;
}

export async function readMailCursor(
  db: Db,
  connectionId: string,
): Promise<typeof mailSyncCursors.$inferSelect | undefined> {
  const [row] = await db
    .select()
    .from(mailSyncCursors)
    .where(
      and(
        eq(mailSyncCursors.connectionId, connectionId),
        eq(mailSyncCursors.scopeKey, GMAIL_MAILBOX_SCOPE),
      ),
    )
    .limit(1);
  return row;
}
