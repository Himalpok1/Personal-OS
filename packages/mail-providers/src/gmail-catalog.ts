// Gmail capability metadata, in code rather than in columns (ADR-053).
//
// The same reasoning google-health-catalog.ts records: this is capability
// metadata, not per-user state. Duplicating it into database columns would
// create a second source of truth, which AGENTS.md forbids. mail_sync_cursors
// holds ONLY what changes per user.

/**
 * The one scope Phase 7 requests. Nothing else, ever.
 *
 * `gmail.readonly` is deliberately NOT here. Google classifies BOTH as
 * Restricted, so the narrower scope buys no verification or CASA relief -- what
 * it buys is that a message body is *unfetchable* rather than merely unstored,
 * which is what removes the retention question (ADR-054) and bounds the
 * attacker-authored surface to a subject and a display name.
 *
 * Two consequences are load-bearing and are enforced by this package's client
 * interface rather than left to a reviewer to remember:
 *   - `q` is rejected under this scope with
 *     `403 Metadata scope does not support 'q' parameter`, so no request type
 *     here has a `q` field.
 *   - `format=FULL` and `format=RAW` are rejected, so the client always asks
 *     for metadata and no request type has a `format` field.
 */
export const GMAIL_METADATA_SCOPE = "https://www.googleapis.com/auth/gmail.metadata";

/** Every scope Phase 7 may request, as sent to the authorization endpoint. */
export const PHASE_7_MAIL_SCOPES: readonly string[] = [GMAIL_METADATA_SCOPE];

export const GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1";
export const GOOGLE_OAUTH_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_OAUTH_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

/**
 * Gmail's own system labels.
 *
 * Provider-specific by definition -- this is exactly why `mail_messages` names
 * its column `provider_labels` rather than `label_ids`. A provider that models
 * mail as folders will have a different set, and must not be forced to describe
 * folders as labels.
 *
 * `CATEGORY_*` is the useful half: Gmail already classifies Promotions, Social,
 * Updates and Forums, so the digest gets that triage for free rather than
 * asking a model to infer it from a subject line.
 */
export const GMAIL_SYSTEM_LABELS = {
  INBOX: "INBOX",
  UNREAD: "UNREAD",
  STARRED: "STARRED",
  IMPORTANT: "IMPORTANT",
  SENT: "SENT",
  DRAFT: "DRAFT",
  SPAM: "SPAM",
  TRASH: "TRASH",
} as const;

export const GMAIL_CATEGORY_LABELS = {
  PERSONAL: "CATEGORY_PERSONAL",
  SOCIAL: "CATEGORY_SOCIAL",
  PROMOTIONS: "CATEGORY_PROMOTIONS",
  UPDATES: "CATEGORY_UPDATES",
  FORUMS: "CATEGORY_FORUMS",
} as const;

/**
 * The headers the client asks for when fetching metadata.
 *
 * An allowlist, not a convenience: `messages.get` with `format=metadata` returns
 * EVERY header unless `metadataHeaders` narrows it, and full headers carry
 * routing chains, spam scores, originating IPs and `Received:` trails. Asking
 * for four named headers means the rest never enters the process, let alone a
 * column -- the same structural-exclusion reasoning as BriefInput's allowlist.
 */
export const GMAIL_METADATA_HEADERS: readonly string[] = ["From", "Subject", "Date", "To"];

/**
 * Quota unit costs, per Gmail's published usage limits.
 *
 * The per-user ceiling is 6,000 quota units per minute (not per second), which
 * at 20 units for a metadata `messages.get` is ~300 messages/minute for a
 * single user -- generous, but the sync engine's limiter still needs the
 * numbers to pace itself, so they live here rather than as magic constants in
 * Checkpoint 7.3.
 */
export const GMAIL_QUOTA_UNITS = {
  messagesList: 5,
  messagesGet: 20,
  historyList: 2,
  threadsList: 10,
  threadsGet: 40,
  labelsList: 1,
  getProfile: 1,
} as const;

export const GMAIL_QUOTA_UNITS_PER_MINUTE_PER_USER = 6000;

/** Gmail caps `maxResults` at 500 on both `messages.list` and `history.list`. */
export const GMAIL_MAX_RESULTS_CAP = 500;

/**
 * The cursor kind this provider stores in `mail_sync_cursors.cursor_kind`.
 *
 * Named rather than inlined so the one place that knows Gmail's cursor is
 * called a "history id" is this catalog, not the sync engine.
 */
export const GMAIL_CURSOR_KIND = "gmail_history_id";

/**
 * The single sync scope for a Gmail mailbox.
 *
 * `mail_sync_cursors.scope_key` exists because Microsoft Graph's delta cursor
 * is PER FOLDER (ADR-052), so the column had to be representable before Graph
 * was implemented. Gmail's `historyId` is not per-label -- it is one monotonic
 * cursor for the whole mailbox -- so Gmail uses exactly one scope, and calling
 * it `"INBOX"` would be a lie that a later reader would reasonably act on.
 *
 * The value is lowercase precisely so it cannot be mistaken for a Gmail label
 * id, which are uppercase.
 */
export const GMAIL_MAILBOX_SCOPE = "mailbox";

/**
 * The history event types the sync engine subscribes to.
 *
 * All four, deliberately. `messageAdded` and `messageDeleted` are the obvious
 * ones; `labelAdded`/`labelRemoved` matter because `mail_messages.provider_labels`
 * is what the digest triages on -- a message moving out of INBOX or losing
 * UNREAD is a change we store, and omitting those two would leave stored labels
 * permanently frozen at whatever they were when the message first arrived.
 */
export const GMAIL_HISTORY_TYPES: readonly string[] = [
  "messageAdded",
  "messageDeleted",
  "labelAdded",
  "labelRemoved",
];

/**
 * Bounds on a single sync pass. Every one of them exists because
 * `history.list`/`messages.list` return REFERENCES, so metadata costs one extra
 * request per message -- an N+1 shape (confirmed live in Checkpoint 7.2P) that
 * is bounded here rather than left to the provider's patience.
 */
export const GMAIL_SYNC_BOUNDS = {
  /** Pages of `history.list` a single incremental pass will follow. */
  maxHistoryPages: 10,
  /** Pages of `messages.list` a single bounded full resync will follow. */
  maxFullSyncPages: 5,
  /** `maxResults` per list page. Gmail's own cap is 500. */
  pageSize: 100,
  /**
   * Hard ceiling on `messages.get` calls in one pass, across every source of
   * message ids.
   *
   * THE LOAD-BEARING BOUND. A mailbox that received 50,000 messages since the
   * cursor was written would otherwise produce 50,000 metadata requests in one
   * job.
   *
   * Hitting it is not an error and MUST NOT stall progress. The pass persists
   * what it fetched and advances the cursor to the id of the last history
   * record it processed IN FULL -- never to the response's own historyId, which
   * would skip the untouched remainder, and never leaving the cursor unmoved,
   * which would replay the same prefix every tick and never reach the tail. A
   * history record's `id` IS a cursor value, so resuming from it re-delivers at
   * most that one record, which persistence absorbs idempotently.
   */
  maxMessagesPerPass: 500,
} as const;
