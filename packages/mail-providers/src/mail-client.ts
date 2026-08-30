// The provider-facing mail client interface (ADR-052/053).
//
// Shaped on GoogleHealthClient, which was itself shaped on the CalDAV client
// "rather than its Google Calendar client -- the latter closes over a
// module-scope fetch and consequently has no test file at all. That is a
// mistake worth not repeating."
//
// ONE IMPLEMENTATION AND ONE FAKE. Microsoft Graph is deferred (ADR-052) and is
// deliberately NOT designed for here: an interface generalized against a
// provider nobody has implemented is guesswork, and Phase 6 chose deliberate
// near-duplication over premature sharing and was right. What this interface
// does do is avoid Gmail's *vocabulary* where a neutral word exists, so a
// second implementation is a new file rather than a rename of this one.

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Identity plus the bootstrap cursor, from one call. */
export interface MailProfile {
  /** The mailbox address. Becomes mail_connections.external_account_id. */
  emailAddress: string;
  /**
   * The provider's current cursor, opaque. Seeds mail_sync_cursors.cursor_value
   * on a first connect so the first incremental pass has somewhere to start.
   */
  historyId: string;
  messagesTotal?: number;
  threadsTotal?: number;
}

/** One header name/value pair as the provider returns it. */
export interface MailHeader {
  name: string;
  value: string;
}

/**
 * A message as `format=metadata` returns it.
 *
 * There is no `body`, no `snippet`, no `payload.parts` and no attachment field,
 * because under `gmail.metadata` the provider does not return them. The type
 * mirrors that: a body is not merely undocumented here, it is inexpressible.
 */
export interface MailMessageMetadata {
  id: string;
  threadId: string;
  /** Provider-defined tags. Gmail calls them labels; the contract does not. */
  labelIds?: string[];
  /** Epoch milliseconds, as a string. Gmail returns it stringified. */
  internalDate?: string;
  sizeEstimate?: number;
  payload?: { headers?: MailHeader[] };
}

export interface MailMessageRef {
  id: string;
  threadId: string;
}

export interface ListMessagesRequest {
  /**
   * Provider label/folder ids to restrict to. ANDed by Gmail.
   *
   * NOTE THE ABSENCE OF `q`. Gmail rejects the search-query parameter under
   * `gmail.metadata` with `403 Metadata scope does not support 'q' parameter`,
   * so it is not a field a caller can set and then be surprised by. Label
   * scoping covers INBOX/UNREAD/IMPORTANT/STARRED/CATEGORY_*, which is what
   * the digest needs. Same reasoning that removed `pageSize` from
   * DailyRollUpRequest in Checkpoint 6.2P: make the trap unrepresentable.
   */
  labelIds?: readonly string[];
  maxResults?: number;
  pageToken?: string;
  includeSpamTrash?: boolean;
}

export interface ListMessagesResponse {
  messages?: MailMessageRef[];
  nextPageToken?: string;
  resultSizeEstimate?: number;
}

export interface GetMessageMetadataRequest {
  id: string;
  /**
   * Header allowlist. Omitted means the provider returns every header, which
   * includes routing chains and spam scores, so callers should pass
   * GMAIL_METADATA_HEADERS.
   *
   * NOTE THE ABSENCE OF `format`: the client always requests metadata.
   */
  metadataHeaders?: readonly string[];
}

export interface ListHistoryRequest {
  /** The opaque cursor. Never parsed, never compared for magnitude. */
  startHistoryId: string;
  labelId?: string;
  historyTypes?: readonly string[];
  maxResults?: number;
  pageToken?: string;
}

export interface MailHistoryRecord {
  id: string;
  messagesAdded?: { message: MailMessageRef }[];
  messagesDeleted?: { message: MailMessageRef }[];
  labelsAdded?: { message: MailMessageRef; labelIds?: string[] }[];
  labelsRemoved?: { message: MailMessageRef; labelIds?: string[] }[];
}

export interface ListHistoryResponse {
  history?: MailHistoryRecord[];
  /** The provider's cursor as of this response. Opaque. */
  historyId: string;
  nextPageToken?: string;
}

/**
 * Every operation Phase 7 may perform. Read-only, by construction.
 *
 * There is no send, reply, modify, trash, delete, or label-mutation method
 * here, and there never will be under ADR-052 -- the app may not act on mail.
 * An interface that cannot express an action is a stronger guarantee than a
 * policy saying not to call one.
 *
 * Every method is a SINGLE-PAGE primitive: it returns the provider's page token
 * and never loops. The pagination loop, its page cap and its truncation
 * reporting belong to the caller that owns the concurrency budget -- the split
 * google-health-client.ts uses, so truncation is visible to completeness logic
 * rather than silently swallowed inside the transport.
 *
 * There is no default timeout for the same reason: whether a call may run for
 * 5s or 60s is a scheduling decision belonging to the caller, not the
 * transport. An AbortSignal is threaded per request.
 */
export interface MailClient {
  getProfile(accessToken: string, signal?: AbortSignal): Promise<MailProfile>;
  listMessages(
    accessToken: string,
    request: ListMessagesRequest,
    signal?: AbortSignal,
  ): Promise<ListMessagesResponse>;
  getMessageMetadata(
    accessToken: string,
    request: GetMessageMetadataRequest,
    signal?: AbortSignal,
  ): Promise<MailMessageMetadata>;
  listHistory(
    accessToken: string,
    request: ListHistoryRequest,
    signal?: AbortSignal,
  ): Promise<ListHistoryResponse>;
}
