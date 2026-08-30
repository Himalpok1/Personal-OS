import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// ADR-052/053 Gmail mail integration (migration 0014).
//
// Token columns are nullable because a disconnect NULLs them and sets
// status='disconnected' rather than deleting the row -- the row is retained as
// connection history, exactly as health_connections and calendar_connections do.
//
// provider carries NO check constraint on purpose (ADR-050): it is a growing
// vocabulary, and Microsoft Graph is explicitly deferred rather than excluded
// (ADR-052). Widening a CHECK later would need a DROP CONSTRAINT, which
// reconcile-drizzle-tracking.ts cannot process -- the 0009 fallout. Zod's
// MailProviderSchema enforces it instead.
//
// IDENTITY IS (provider, external_account_id), NOT external_account_id ALONE.
// This is a deliberate divergence from health_connections, which is unique on
// health_user_id by itself because a person has exactly one Google Health
// account. Two mailboxes are legitimate -- personal and work -- and a future
// second provider could mint a colliding account id, so the provider is part of
// the key. external_account_id is NOT NULL for the same reason health_user_id
// is: a Postgres unique index permits unlimited NULLs, so a nullable identity
// would let a partially-failed connect bypass the account-mismatch guard.
//
// last_sync_error holds a SANITIZED CLASSIFICATION TOKEN, never a provider
// message. See packages/schema/src/mail-connections.ts's MailSyncErrorCode --
// the wire field is typed to that closed enum, so a prose leak is a parse
// failure rather than a silently-passing string (the Checkpoint 6.5 pattern).
export const mailConnections = pgTable(
  "mail_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    externalAccountId: text("external_account_id").notNull(),
    accessTokenCiphertext: bytea("access_token_ciphertext"),
    accessTokenIv: bytea("access_token_iv"),
    accessTokenAuthTag: bytea("access_token_auth_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenIv: bytea("refresh_token_iv"),
    refreshTokenAuthTag: bytea("refresh_token_auth_tag"),
    grantedScope: text("granted_scope"),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    lastSyncError: text("last_sync_error"),
    lastSyncErrorAt: timestamp("last_sync_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "mail_connections_status",
      sql`${table.status} in ('active','needs_reauth','revoked','disconnected')`,
    ),
    // An encrypted secret is a three-column triple; a partially-populated one
    // is undecryptable and must be unrepresentable rather than merely unlikely.
    // calendar_connections lacks these; health_connections added them and this
    // copies health, not calendar.
    check(
      "mail_connections_access_token_triple",
      sql`(${table.accessTokenCiphertext} is null and ${table.accessTokenIv} is null and ${table.accessTokenAuthTag} is null) or (${table.accessTokenCiphertext} is not null and ${table.accessTokenIv} is not null and ${table.accessTokenAuthTag} is not null)`,
    ),
    check(
      "mail_connections_refresh_token_triple",
      sql`(${table.refreshTokenCiphertext} is null and ${table.refreshTokenIv} is null and ${table.refreshTokenAuthTag} is null) or (${table.refreshTokenCiphertext} is not null and ${table.refreshTokenIv} is not null and ${table.refreshTokenAuthTag} is not null)`,
    ),
    uniqueIndex("mail_connections_provider_account_unique").on(
      table.provider,
      table.externalAccountId,
    ),
  ],
);
