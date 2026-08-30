import {
  MAIL_CURSOR_VALUE_MAX_CHARS,
  MAIL_ADDRESS_MAX_CHARS,
  MAIL_SCOPE_KEY_MAX_CHARS,
} from "@personal-os/core/mail/provider-strings";
import { z } from "zod";
import { MailSyncErrorCodeSchema } from "./mail-sync-errors.js";

// Phase 7 mail connection contracts (ADR-052/053).
//
// STRUCTURALLY CREDENTIAL-FREE. Nothing in this file can express an access
// token, a refresh token, ciphertext, an IV, an auth tag or an OAuth state.
// That is not a review rule -- `mail-connections.test.ts` walks these schemas'
// keys and fails if a credential-shaped name appears, the same proof
// `health-metrics.test.ts` runs.

/**
 * Mail providers.
 *
 * A closed Zod enum, but deliberately NOT a database CHECK constraint
 * (ADR-050): Microsoft Graph is deferred rather than excluded (ADR-052), and a
 * CHECK would make adding it require a `DROP CONSTRAINT` that
 * `reconcile-drizzle-tracking.ts` cannot process. Widening THIS enum is a
 * one-line change with no migration.
 */
export const MailProviderSchema = z.enum(["gmail"]);
export type MailProvider = z.infer<typeof MailProviderSchema>;

/**
 * Connection lifecycle. Closed by design and CHECK-constrained in the database,
 * matching `health_connections` and `calendar_connections` exactly.
 *
 * `disconnected` is distinct from `revoked`: a disconnect is the user's own
 * action and NULLs the credentials while retaining the row as history; revoked
 * means the provider ended the grant.
 */
export const MailConnectionStatusSchema = z.enum([
  "active",
  "needs_reauth",
  "revoked",
  "disconnected",
]);
export type MailConnectionStatus = z.infer<typeof MailConnectionStatusSchema>;

/**
 * The safe wire representation of a mail connection.
 *
 * `last_sync_error` is typed to the closed `MailSyncErrorCode`, not
 * `z.string()`. That is the load-bearing choice: it makes an accidental
 * provider-prose leak a PARSE FAILURE at the API boundary rather than a
 * silently-passing free-text field -- the trick `CalendarConnectionSchema`
 * adopted in Checkpoint 6.5 after Google's own prose reached the Settings
 * screen through exactly this field.
 *
 * `external_account_id` is the mailbox address. It is the account-binding
 * identity and is intentionally present: unlike Google Health, whose three read
 * scopes return no email at all, `gmail.metadata` authorises
 * `users.getProfile`, which returns `emailAddress`. Showing the user which
 * mailbox is connected is the whole point of the Settings card.
 */
export const MailConnectionSchema = z.object({
  id: z.string().uuid(),
  provider: MailProviderSchema,
  external_account_id: z.string().max(MAIL_ADDRESS_MAX_CHARS),
  status: MailConnectionStatusSchema,
  granted_scope: z.string().nullable(),
  identity_verified_at: z.string().datetime({ offset: true }).nullable(),
  // A CODE, never a message. See MailSyncErrorCodeSchema.
  last_sync_error: MailSyncErrorCodeSchema.nullable(),
  last_sync_error_at: z.string().datetime({ offset: true }).nullable(),
  created_at: z.string().datetime({ offset: true }),
  updated_at: z.string().datetime({ offset: true }),
});
export type MailConnection = z.infer<typeof MailConnectionSchema>;

/**
 * Provider cursor semantics.
 *
 * Not CHECK-constrained (ADR-050) for the same reason `provider` is not: a
 * second provider brings its own kind (`graph_delta_token`) and must not need a
 * `DROP CONSTRAINT`.
 */
export const MailCursorKindSchema = z.enum(["gmail_history_id"]);
export type MailCursorKind = z.infer<typeof MailCursorKindSchema>;

/**
 * Incremental sync state for one (connection, scope).
 *
 * `cursor_value` IS OPAQUE. It is typed as a bounded string and nothing in this
 * codebase parses it, orders by it, compares it for magnitude, or converts it
 * to a timestamp. Gmail's `historyId` happens to be decimal today; that is an
 * implementation detail of one provider and treating it as a number would bake
 * it into the contract.
 *
 * This is the deliberate inversion of `health_metric_streams`, whose cursor is
 * a date precisely because the Google Health API offers no incremental
 * primitive to be opaque about. Gmail offers one, it is the only one, and it
 * expires -- so `needs_full_resync` models expiry as durable state rather than
 * leaving it inexpressible.
 */
export const MailSyncCursorSchema = z.object({
  id: z.string().uuid(),
  connection_id: z.string().uuid(),
  scope_key: z.string().min(1).max(MAIL_SCOPE_KEY_MAX_CHARS),
  cursor_value: z.string().min(1).max(MAIL_CURSOR_VALUE_MAX_CHARS).nullable(),
  cursor_kind: MailCursorKindSchema,
  needs_full_resync: z.boolean(),
  last_successful_sync_at: z.string().datetime({ offset: true }).nullable(),
  last_full_sync_at: z.string().datetime({ offset: true }).nullable(),
});
export type MailSyncCursor = z.infer<typeof MailSyncCursorSchema>;

/**
 * Why a sync pass ran. Closed by design and CHECK-constrained.
 *
 * `full` is the bounded resync a `cursor_expired` escalates to; `backfill` is a
 * deliberate reach further back than the cursor covers. They are different
 * intentions with different bounds, so they are different kinds.
 */
export const MailSyncRunKindSchema = z.enum(["incremental", "full", "backfill", "manual"]);
export type MailSyncRunKind = z.infer<typeof MailSyncRunKindSchema>;

export const MailSyncRunStatusSchema = z.enum(["succeeded", "failed", "skipped", "cancelled"]);
export type MailSyncRunStatus = z.infer<typeof MailSyncRunStatusSchema>;
