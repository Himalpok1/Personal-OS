import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// Google Calendar OAuth connection (Phase 4 Checkpoint 4.5 Stage B). Token
// columns are nullable because a later disconnect action nulls them out and
// sets status='disconnected' rather than deleting the row -- the row itself
// is retained as connection history, same reasoning as devices.ts's
// revoked_at (keep the row, change its state).
//
// provider is a closed set of one value today ('google'), left as a text +
// check constraint rather than a Postgres enum type, matching this
// project's existing pattern (ai_provider_connections.provider_type) --
// adding a second provider later is a plain migration, not a type
// alteration.
export const calendarConnections = pgTable(
  "calendar_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    googleAccountEmail: text("google_account_email").notNull(),
    // OIDC "sub" -- stable per Google account, used to detect re-connecting
    // the same account.
    googleAccountId: text("google_account_id").notNull().unique(),
    // AES-256-GCM, same scheme as ai_provider_connections' api_key_*
    // columns -- see packages/ai-providers/credential-crypto.ts.
    accessTokenCiphertext: bytea("access_token_ciphertext"),
    accessTokenIv: bytea("access_token_iv"),
    accessTokenAuthTag: bytea("access_token_auth_tag"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenCiphertext: bytea("refresh_token_ciphertext"),
    refreshTokenIv: bytea("refresh_token_iv"),
    refreshTokenAuthTag: bytea("refresh_token_auth_tag"),
    grantedScope: text("granted_scope").notNull(),
    status: text("status").notNull().default("active"),
    lastSyncError: text("last_sync_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check("calendar_connections_provider", sql`${table.provider} in ('google')`),
    check(
      "calendar_connections_status",
      sql`${table.status} in ('active','needs_reauth','revoked','disconnected')`,
    ),
  ],
);
