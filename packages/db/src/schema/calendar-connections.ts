import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// Calendar connections (Phase 4 Checkpoint 4.5 Stage B & Checkpoint 4.6 CalDAV).
// Token/password columns are nullable because a disconnect action nulls them
// out and sets status='disconnected' rather than deleting the row -- the row
// itself is retained as connection history.
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    // Google-specific fields
    googleAccountEmail: text("google_account_email"),
    googleAccountId: text("google_account_id").unique(
      "calendar_connections_google_account_id_unique",
    ),
    accessTokenCiphertext: bytea("access_token_ciphertext"),
    accessTokenIv: bytea("access_token_iv"),
    accessTokenAuthTag: bytea("access_token_auth_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenIv: bytea("refresh_token_iv"),
    refreshTokenAuthTag: bytea("refresh_token_auth_tag"),
    grantedScope: text("granted_scope"),
    // CalDAV-specific fields
    serverUrl: text("server_url"),
    username: text("username"),
    authType: text("auth_type").default("basic"),
    principalUrl: text("principal_url"),
    calendarHomeSetUrl: text("calendar_home_set_url"),
    passwordCiphertext: bytea("password_ciphertext"),
    passwordIv: bytea("password_iv"),
    passwordAuthTag: bytea("password_auth_tag"),
    // Common fields
    status: text("status").notNull().default("active"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("calendar_connections_provider", sql`${table.provider} in ('google', 'caldav')`),
    check(
      "calendar_connections_status",
      sql`${table.status} in ('active','needs_reauth','revoked','disconnected')`,
    ),
    check(
      "calendar_connections_provider_invariants",
      sql`(${table.provider} = 'google' AND ${table.googleAccountEmail} IS NOT NULL AND ${table.googleAccountId} IS NOT NULL) OR (${table.provider} = 'caldav' AND ${table.serverUrl} IS NOT NULL AND ${table.username} IS NOT NULL)`,
    ),
  ],
);
