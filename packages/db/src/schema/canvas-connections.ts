import { sql } from "drizzle-orm";
import { bigint, check, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { bytea } from "./custom-types.js";

// ADR-068 Canvas LMS integration (migration 0020).
//
// Auth is a Canvas Personal Access Token, not OAuth2 -- a PAT already carries
// the full grant of the account and there is no finer scope to request, and a
// Developer Key needs institution-side registration this single-user
// self-hosted app has no path to obtain. There is therefore no refresh flow to
// build: unlike mail_connections/health_connections, there is no separate
// refresh-token pair, just the one credential triple. The triple is still
// nullable, exactly like mail/health's own token columns, and for the same
// reason -- disconnect clears it. A disconnected Canvas connection retains no
// usable credential at all, not merely an unread one gated by `status`; the
// triple-null-or-all-three CHECK below is the mail_connections precedent,
// verbatim. The triple is encrypted at rest with the existing
// packages/ai-providers AES-256-GCM ciphertext/iv/auth-tag pattern (the
// mail_connections precedent) whenever it is present.
//
// canvas_user_id/canvas_user_name come back from GET /users/self at connect
// time and are stored for display only; canvas_user_name is bounded at write
// by the caller (packages/schema), not by a DB constraint, matching every
// other provider-authored display string in this codebase.
//
// canvas_base_url is the identity: a single Canvas installation
// (e.g. https://uta.instructure.com) per connection row, unique so the same
// institution cannot be connected twice.
//
// last_sync_error holds a SANITIZED CLASSIFICATION TOKEN, never provider
// prose -- see canvas_sync_runs below and the mail_sync_runs precedent this
// mirrors exactly.
export const canvasConnections = pgTable(
  "canvas_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    canvasBaseUrl: text("canvas_base_url").notNull(),
    canvasUserId: bigint("canvas_user_id", { mode: "number" }).notNull(),
    canvasUserName: text("canvas_user_name"),
    accessTokenCiphertext: bytea("access_token_ciphertext"),
    accessTokenIv: bytea("access_token_iv"),
    accessTokenAuthTag: bytea("access_token_auth_tag"),
    status: text("status").notNull().default("active"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    lastSyncError: text("last_sync_error"),
    lastSyncErrorAt: timestamp("last_sync_error_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    check(
      "canvas_connections_status",
      sql`${table.status} in ('active','disconnected','invalid_token')`,
    ),
    check(
      "canvas_connections_access_token_triple",
      sql`(${table.accessTokenCiphertext} is null and ${table.accessTokenIv} is null and ${table.accessTokenAuthTag} is null)
        or (${table.accessTokenCiphertext} is not null and ${table.accessTokenIv} is not null and ${table.accessTokenAuthTag} is not null)`,
    ),
    uniqueIndex("canvas_connections_base_url_unique").on(table.canvasBaseUrl),
  ],
);
