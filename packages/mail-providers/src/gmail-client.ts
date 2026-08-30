import { GMAIL_API_BASE, GMAIL_METADATA_HEADERS, GMAIL_MAX_RESULTS_CAP } from "./gmail-catalog.js";
import type {
  FetchLike,
  GetMessageMetadataRequest,
  ListHistoryRequest,
  ListHistoryResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MailClient,
  MailMessageMetadata,
  MailProfile,
} from "./mail-client.js";

/**
 * Parses an HTTP `Retry-After` header into whole seconds.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT COPIED FROM HEALTH
 *
 * `packages/health-providers/src/sync/limiter.ts` uses BLIND full-jitter
 * backoff, and its comment is explicit about why: "Google's Health API
 * documents no `Retry-After` header and no `X-RateLimit-*` headers... so there
 * is no server hint to honour."
 *
 * Gmail is not that API. It sends `Retry-After`, and so does Microsoft Graph.
 * Carrying the blind-jitter reasoning across would mean ignoring a hint the
 * provider is actively giving us, which is both slower to recover and ruder to
 * the quota. ADR-053 therefore requires honouring it -- and requires proving
 * that DETERMINISTICALLY rather than by provoking a real 429, because
 * provoking one means deliberately abusing the quota.
 *
 * Accepts both documented forms: delta-seconds, and an HTTP-date. Returns
 * `null` for anything it cannot read with confidence, so the caller falls back
 * to its own backoff rather than acting on a misparse. A date in the past
 * clamps to 0 -- "retry now" -- rather than going negative.
 *
 * `now` is injected so the HTTP-date branch is testable against a fixed clock
 * instead of a tolerance window. A limiter whose backoff is only tested "within
 * a plausible range" is a limiter whose off-by-one you find in production.
 */
export function parseRetryAfterSeconds(
  headerValue: string | null | undefined,
  now: number = Date.now(),
): number | null {
  if (headerValue === null || headerValue === undefined) return null;
  const raw = headerValue.trim();
  if (raw === "") return null;

  // delta-seconds. Deliberately strict: a bare integer only, so "12.5" and
  // "12s" fall through to the date branch and are then rejected rather than
  // silently truncated.
  if (/^\d+$/.test(raw)) {
    const seconds = Number(raw);
    return Number.isSafeInteger(seconds) ? seconds : null;
  }

  // Only attempt the date branch for something that actually looks like an
  // HTTP-date. `Date.parse` is far too permissive to use as a validator: it
  // reads "12.5" as 5 December and "-5" as a date in 2001, both of which are in
  // the past and would therefore clamp to 0 -- telling the caller "retry now"
  // on a value it should have rejected. All three RFC 7231 formats carry an
  // h:mm:ss time; neither of those strings does.
  if (!/\d{1,2}:\d{2}:\d{2}/.test(raw)) return null;

  const at = Date.parse(raw);
  if (Number.isNaN(at)) return null;
  const deltaMs = at - now;
  if (deltaMs <= 0) return 0;
  return Math.ceil(deltaMs / 1000);
}

interface GmailApiErrorDetail {
  reason?: string;
  domain?: string;
}

function dedupe(values: readonly (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const v of values) {
    if (v !== undefined && v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * A Gmail API failure, carrying only enumerable machine-readable facts.
 *
 * THE PROVIDER'S MESSAGE IS DESTROYED, NOT STORED.
 *
 * This is the same rule GoogleHealthApiError enforces, and it matters more
 * here, not less. Gmail's `INVALID_ARGUMENT` prose echoes the offending request
 * back -- a bad `startHistoryId` comes back with the value in it, and a header
 * filter comes back with the header names. The worker process has NO log
 * redaction whatsoever, and pg-boss serializes a thrown error into
 * `pgboss.job.output`, a durable Postgres table, by copying every
 * own-enumerable property. So a retained message is a caller-controlled channel
 * that ends in plaintext in Postgres, forever.
 *
 * The message this error carries is CONSTRUCTED from a status code and a status
 * token. `cause` is deliberately not retained either: serialize-error
 * special-cases `cause` explicitly rather than relying on enumerability, so
 * keeping it would walk the provider payload straight back in.
 */
export class GmailApiError extends Error {
  readonly httpStatus: number;
  readonly gmailStatus: string | undefined;
  /** Deduped `error.errors[].reason` / `error.details[].reason` tokens. */
  readonly reasons: readonly string[];
  readonly domains: readonly string[];
  /** Seconds the provider asked us to wait, when it said so. */
  readonly retryAfterSeconds: number | null;

  constructor(
    httpStatus: number,
    gmailStatus: string | undefined,
    details: readonly GmailApiErrorDetail[],
    retryAfterSeconds: number | null,
  ) {
    super(`Gmail API ${httpStatus}${gmailStatus !== undefined ? ` ${gmailStatus}` : ""}`);
    this.name = "GmailApiError";
    this.httpStatus = httpStatus;
    this.gmailStatus = gmailStatus;
    this.reasons = dedupe(details.map((d) => d.reason));
    this.domains = dedupe(details.map((d) => d.domain));
    this.retryAfterSeconds = retryAfterSeconds;
  }

  /** 429. Unlike Google Health, Gmail may supply `retryAfterSeconds`. */
  get isRateLimited(): boolean {
    return this.httpStatus === 429;
  }

  /** The grant itself is dead -- the connection needs re-authorization. */
  get isAuthFailure(): boolean {
    return this.httpStatus === 401;
  }

  /**
   * 403. NOT by itself evidence of a missing scope: Gmail also returns 403 for
   * rate limiting and for `q` used under `gmail.metadata`. The reason tokens
   * are what distinguish them, which is why they are retained and the prose is
   * not.
   */
  get isForbidden(): boolean {
    return this.httpStatus === 403;
  }

  /**
   * 404. On `history.list` specifically this is the documented signal that
   * `startHistoryId` is older than the provider's retention -- ADR-053's
   * cursor-expiry transition. The client cannot make that call on its own,
   * because 404 on `messages.get` merely means the message is gone; the
   * caller knows which operation it issued and classifies accordingly.
   */
  get isNotFound(): boolean {
    return this.httpStatus === 404;
  }

  /** Worth retrying: transport hiccups and provider-side faults. */
  get isTransient(): boolean {
    return this.httpStatus === 429 || this.httpStatus >= 500;
  }
}

interface GmailErrorBody {
  error?: {
    status?: string;
    errors?: GmailApiErrorDetail[];
    details?: GmailApiErrorDetail[];
  };
}

async function request<T>(
  url: string,
  accessToken: string,
  fetchFn: FetchLike,
  signal: AbortSignal | undefined,
): Promise<T> {
  const response = await fetchFn(url, {
    ...(signal !== undefined ? { signal } : {}),
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    let parsed: GmailErrorBody = {};
    try {
      parsed = (await response.json()) as GmailErrorBody;
    } catch {
      // Non-JSON error body. Nothing to salvage, and nothing worth retaining.
    }
    const details = [...(parsed.error?.errors ?? []), ...(parsed.error?.details ?? [])];
    throw new GmailApiError(
      response.status,
      parsed.error?.status,
      details,
      parseRetryAfterSeconds(response.headers.get("retry-after")),
    );
  }

  return (await response.json()) as T;
}

function appendRepeated(params: URLSearchParams, key: string, values: readonly string[]): void {
  for (const value of values) params.append(key, value);
}

/**
 * The real Gmail client.
 *
 * `fetchFn` is injectable and defaults to the global. Health's client records
 * why that matters: the Google Calendar client closes over a module-scope fetch
 * "and consequently has no test file at all".
 */
export function createGmailClient(fetchFn: FetchLike = globalThis.fetch): MailClient {
  return {
    async getProfile(accessToken, signal) {
      // One call yields BOTH the mailbox address and the bootstrap cursor, and
      // `gmail.metadata` authorises it -- so Phase 7 needs no `openid`/`email`
      // scope and no id_token, unlike the Phase 4 calendar flow.
      return await request<MailProfile>(
        `${GMAIL_API_BASE}/users/me/profile`,
        accessToken,
        fetchFn,
        signal,
      );
    },

    async listMessages(accessToken, req, signal) {
      const params = new URLSearchParams();
      if (req.labelIds !== undefined) appendRepeated(params, "labelIds", [...req.labelIds]);
      if (req.maxResults !== undefined) {
        params.set("maxResults", String(Math.min(req.maxResults, GMAIL_MAX_RESULTS_CAP)));
      }
      if (req.pageToken !== undefined) params.set("pageToken", req.pageToken);
      if (req.includeSpamTrash !== undefined) {
        params.set("includeSpamTrash", String(req.includeSpamTrash));
      }
      // No `q`: rejected under gmail.metadata, and unrepresentable in the
      // request type for that reason.
      return await request<ListMessagesResponse>(
        `${GMAIL_API_BASE}/users/me/messages?${params.toString()}`,
        accessToken,
        fetchFn,
        signal,
      );
    },

    async getMessageMetadata(accessToken, req, signal) {
      const params = new URLSearchParams();
      // Always metadata. format=FULL/RAW are rejected under this scope, so the
      // client does not offer the choice.
      params.set("format", "metadata");
      appendRepeated(params, "metadataHeaders", [
        ...(req.metadataHeaders ?? GMAIL_METADATA_HEADERS),
      ]);
      return await request<MailMessageMetadata>(
        `${GMAIL_API_BASE}/users/me/messages/${encodeURIComponent(req.id)}?${params.toString()}`,
        accessToken,
        fetchFn,
        signal,
      );
    },

    async listHistory(accessToken, req, signal) {
      const params = new URLSearchParams();
      params.set("startHistoryId", req.startHistoryId);
      if (req.labelId !== undefined) params.set("labelId", req.labelId);
      if (req.historyTypes !== undefined) {
        appendRepeated(params, "historyTypes", [...req.historyTypes]);
      }
      if (req.maxResults !== undefined) {
        params.set("maxResults", String(Math.min(req.maxResults, GMAIL_MAX_RESULTS_CAP)));
      }
      if (req.pageToken !== undefined) params.set("pageToken", req.pageToken);
      return await request<ListHistoryResponse>(
        `${GMAIL_API_BASE}/users/me/history?${params.toString()}`,
        accessToken,
        fetchFn,
        signal,
      );
    },
  };
}

export type {
  GetMessageMetadataRequest,
  ListHistoryRequest,
  ListHistoryResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MailClient,
  MailMessageMetadata,
  MailProfile,
};
