import { GmailApiError } from "./gmail-client.js";
import type {
  GetMessageMetadataRequest,
  ListHistoryRequest,
  ListHistoryResponse,
  ListMessagesRequest,
  ListMessagesResponse,
  MailClient,
  MailMessageMetadata,
  MailProfile,
} from "./mail-client.js";

// In-memory MailClient for tests. No network, ever.
//
// SCRIPTED RATHER THAN STATEFUL: each method drains a FIFO queue of prepared
// responses, so a test states exactly what the provider returns on call 1, call
// 2, and so on.
//
// DRAINING AN EMPTY QUEUE FAILS THE CALL. That is the whole point of the
// convention and is why it is copied forward from google-calendar-client.fake.ts
// and google-health-client.fake.ts: a fake that returns an empty page for an
// unexpected call produces a GREEN test for code that made a call nobody
// intended. A loud failure is the difference between "we tested the loop" and
// "the loop silently ran twice and we never knew".
//
// It REJECTS rather than throwing synchronously -- see `settle` below.

type Scripted<T> = T | GmailApiError;

export interface FakeCall {
  method: "getProfile" | "listMessages" | "getMessageMetadata" | "listHistory";
  accessToken: string;
  labelIds?: readonly string[];
  pageToken?: string;
  maxResults?: number;
  includeSpamTrash?: boolean;
  messageId?: string;
  metadataHeaders?: readonly string[];
  startHistoryId?: string;
  labelId?: string;
  historyTypes?: readonly string[];
}

export interface FakeMailClient extends MailClient {
  /** Every call made, in order, with the arguments it was given. */
  readonly calls: FakeCall[];
  queueProfile(response: Scripted<MailProfile>): void;
  queueListMessages(response: Scripted<ListMessagesResponse>): void;
  queueMessageMetadata(response: Scripted<MailMessageMetadata>): void;
  queueListHistory(response: Scripted<ListHistoryResponse>): void;
  /** Calls recorded for one method, in order. */
  callsFor(method: FakeCall["method"]): FakeCall[];
  /** Queue lengths, so a test can assert every scripted response was consumed. */
  pending(): Record<FakeCall["method"], number>;
}

function drain<T>(queue: Scripted<T>[], method: string): T {
  const next = queue.shift();
  if (next === undefined) {
    throw new Error(
      `FakeMailClient: unexpected call to ${method}() -- no response queued. ` +
        `Queue an expected response, or fix the code under test if this call was not intended.`,
    );
  }
  // A queued error is thrown rather than returned, so a test can script a 429,
  // a 401 or a history-expiry 404 exactly where it wants one.
  if (next instanceof GmailApiError) throw next;
  return next;
}

/**
 * Runs `fn` and returns a settled promise, so a drained-empty queue or a
 * scripted error REJECTS rather than throwing synchronously.
 *
 * This matters: the methods are Promise-returning but not `async`, so a bare
 * `throw` inside one escapes before the promise exists. Callers written against
 * the real client would then see an exception where they expected a rejection
 * -- and a test using `.rejects` would fail for the wrong reason. Found by
 * this package's own fake tests rather than by review.
 */
function settle<T>(fn: () => T): Promise<T> {
  try {
    return Promise.resolve(fn());
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

export function createFakeMailClient(): FakeMailClient {
  const calls: FakeCall[] = [];
  const profiles: Scripted<MailProfile>[] = [];
  const messageLists: Scripted<ListMessagesResponse>[] = [];
  const metadatas: Scripted<MailMessageMetadata>[] = [];
  const histories: Scripted<ListHistoryResponse>[] = [];

  return {
    calls,
    queueProfile: (r) => void profiles.push(r),
    queueListMessages: (r) => void messageLists.push(r),
    queueMessageMetadata: (r) => void metadatas.push(r),
    queueListHistory: (r) => void histories.push(r),
    callsFor: (method) => calls.filter((c) => c.method === method),
    pending: () => ({
      getProfile: profiles.length,
      listMessages: messageLists.length,
      getMessageMetadata: metadatas.length,
      listHistory: histories.length,
    }),

    getProfile(accessToken: string): Promise<MailProfile> {
      calls.push({ method: "getProfile", accessToken });
      return settle(() => drain(profiles, "getProfile"));
    },

    listMessages(accessToken: string, request: ListMessagesRequest): Promise<ListMessagesResponse> {
      calls.push({
        method: "listMessages",
        accessToken,
        ...(request.labelIds !== undefined ? { labelIds: request.labelIds } : {}),
        ...(request.pageToken !== undefined ? { pageToken: request.pageToken } : {}),
        ...(request.maxResults !== undefined ? { maxResults: request.maxResults } : {}),
        ...(request.includeSpamTrash !== undefined
          ? { includeSpamTrash: request.includeSpamTrash }
          : {}),
      });
      return settle(() => drain(messageLists, "listMessages"));
    },

    getMessageMetadata(
      accessToken: string,
      request: GetMessageMetadataRequest,
    ): Promise<MailMessageMetadata> {
      calls.push({
        method: "getMessageMetadata",
        accessToken,
        messageId: request.id,
        ...(request.metadataHeaders !== undefined
          ? { metadataHeaders: request.metadataHeaders }
          : {}),
      });
      return settle(() => drain(metadatas, "getMessageMetadata"));
    },

    listHistory(accessToken: string, request: ListHistoryRequest): Promise<ListHistoryResponse> {
      calls.push({
        method: "listHistory",
        accessToken,
        startHistoryId: request.startHistoryId,
        ...(request.labelId !== undefined ? { labelId: request.labelId } : {}),
        ...(request.historyTypes !== undefined ? { historyTypes: request.historyTypes } : {}),
        ...(request.maxResults !== undefined ? { maxResults: request.maxResults } : {}),
        ...(request.pageToken !== undefined ? { pageToken: request.pageToken } : {}),
      });
      return settle(() => drain(histories, "listHistory"));
    },
  };
}

/** Convenience: a metadata message carrying the four allowlisted headers. */
export function fakeMessage(opts: {
  id: string;
  threadId?: string;
  from?: string;
  subject?: string;
  date?: string;
  internalDate?: string;
  labelIds?: string[];
  sizeEstimate?: number;
}): MailMessageMetadata {
  const headers = [
    ...(opts.from !== undefined ? [{ name: "From", value: opts.from }] : []),
    ...(opts.subject !== undefined ? [{ name: "Subject", value: opts.subject }] : []),
    ...(opts.date !== undefined ? [{ name: "Date", value: opts.date }] : []),
  ];
  return {
    id: opts.id,
    threadId: opts.threadId ?? opts.id,
    ...(opts.labelIds !== undefined ? { labelIds: opts.labelIds } : {}),
    ...(opts.internalDate !== undefined ? { internalDate: opts.internalDate } : {}),
    ...(opts.sizeEstimate !== undefined ? { sizeEstimate: opts.sizeEstimate } : {}),
    payload: { headers },
  };
}
