import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// ADR-046 Google Health cloud integration (migration 0013).
//
// Token columns are nullable because a disconnect NULLs them and sets
// status='disconnected' rather than deleting the row -- the row is retained as
// connection history, exactly as calendar_connections does.
//
// health_user_id is NOT NULL and is the account-binding identity (ADR-046):
// the three approved read scopes return no email and no OIDC id_token, so
// there is deliberately no google_account_email/google_account_id here. A
// Postgres unique index permits unlimited NULLs, so a nullable identity would
// let a partially-failed connect leave a row the uniqueness guarantee and the
// account-mismatch check could not see -- hence NOT NULL, with the row
// inserted only after getIdentity succeeds.
//
// provider and source_family carry NO check constraint on purpose (ADR-050):
// they are provider-defined/growing vocabularies, and widening a CHECK later
// would need a DROP CONSTRAINT, which reconcile-drizzle-tracking.ts cannot
// process (the 0009 fallout).
export const healthConnections = pgTable(
  "health_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    healthUserId: text("health_user_id").notNull(),
    legacyUserId: text("legacy_user_id"),
    accessTokenCiphertext: bytea("access_token_ciphertext"),
    accessTokenIv: bytea("access_token_iv"),
    accessTokenAuthTag: bytea("access_token_auth_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenIv: bytea("refresh_token_iv"),
    refreshTokenAuthTag: bytea("refresh_token_auth_tag"),
    grantedScope: text("granted_scope"),
    // Full resource name, not a bare string -- the API documents
    // "users/me/dataSourceFamilies/all-sources" and friends.
    sourceFamily: text("source_family")
      .notNull()
      .default("users/me/dataSourceFamilies/all-sources"),
    identityVerifiedAt: timestamp("identity_verified_at", { withTimezone: true }),
    status: text("status").notNull().default("active"),
    lastSyncError: text("last_sync_error"),
    lastSyncErrorAt: timestamp("last_sync_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "health_connections_status",
      sql`${table.status} in ('active','needs_reauth','revoked','disconnected')`,
    ),
    // An encrypted secret is a three-column triple; a partially-populated one
    // is undecryptable and must be unrepresentable rather than merely unlikely.
    check(
      "health_connections_access_token_triple",
      sql`(${table.accessTokenCiphertext} is null and ${table.accessTokenIv} is null and ${table.accessTokenAuthTag} is null) or (${table.accessTokenCiphertext} is not null and ${table.accessTokenIv} is not null and ${table.accessTokenAuthTag} is not null)`,
    ),
    check(
      "health_connections_refresh_token_triple",
      sql`(${table.refreshTokenCiphertext} is null and ${table.refreshTokenIv} is null and ${table.refreshTokenAuthTag} is null) or (${table.refreshTokenCiphertext} is not null and ${table.refreshTokenIv} is not null and ${table.refreshTokenAuthTag} is not null)`,
    ),
    uniqueIndex("health_connections_health_user_id_unique").on(table.healthUserId),
  ],
);
