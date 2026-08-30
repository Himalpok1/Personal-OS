import type { MailClient } from "./mail-client.js";

// Account identity for a mail connection (ADR-053).
//
// The Phase 4 calendar flow derives identity from an OIDC `id_token`. Phase 7
// deliberately does NOT: `gmail.metadata` authorises `users.getProfile`, which
// returns the mailbox address directly, so no `openid`/`email` scope is
// requested and no id_token is expected or parsed. That is one fewer scope on a
// consent screen already carrying restricted Calendar and Health grants.
//
// The same call also returns the provider's current cursor, so a first connect
// gets its identity binding and its incremental starting point from one
// request rather than two.

export interface MailIdentity {
  /**
   * The account-binding identity, normalized. Becomes
   * `mail_connections.external_account_id`, one half of the
   * `(provider, external_account_id)` unique key.
   */
  externalAccountId: string;
  /**
   * The provider's cursor at connect time, opaque.
   *
   * Seeds `mail_sync_cursors.cursor_value`. Note what this does NOT mean: a
   * connection that starts here syncs forward from now and has no history
   * before it. Reaching further back is a deliberate `backfill`, which is why
   * that is a distinct `MailSyncRunKind` rather than an implicit first pass.
   */
  bootstrapCursor: string;
}

/**
 * Normalizes a mailbox address for use as an identity key.
 *
 * Lowercases and trims, and nothing else. In particular it does NOT strip
 * `+tag` suffixes or dots from a Gmail local part: those are Gmail delivery
 * conveniences, not identity rules, and applying them would make
 * `a.b@gmail.com` and `ab@gmail.com` collide on the unique index even though
 * the provider considers them one account and would report one canonical
 * address anyway. Over-normalizing an identity key is how two real accounts
 * become one row.
 */
export function normalizeMailAccountId(address: string): string {
  return address.trim().toLowerCase();
}

/**
 * Resolves identity and the bootstrap cursor from one `getProfile` call.
 *
 * Throws if the provider returns an empty address or cursor. That is
 * deliberate: `mail_connections.external_account_id` is NOT NULL precisely
 * because a Postgres unique index permits unlimited NULLs, so a connection with
 * an unknown identity would bypass the account-mismatch guard entirely. Failing
 * here means the row is never written, which is the correct outcome.
 */
export async function resolveMailIdentity(
  client: MailClient,
  accessToken: string,
  signal?: AbortSignal,
): Promise<MailIdentity> {
  const profile = await client.getProfile(accessToken, signal);
  const externalAccountId = normalizeMailAccountId(profile.emailAddress ?? "");
  if (externalAccountId === "") {
    throw new Error("mail identity: provider returned no mailbox address");
  }
  const bootstrapCursor = (profile.historyId ?? "").trim();
  if (bootstrapCursor === "") {
    throw new Error("mail identity: provider returned no cursor");
  }
  return { externalAccountId, bootstrapCursor };
}
