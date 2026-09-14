import {
  InboxArchiveResponseSchema,
  InboxConfirmRequestSchema,
  InboxItemSchema,
  paginatedResponseSchema,
  type InboxArchiveResponse,
  type InboxConfirmRequest,
  type InboxItem,
  type InboxItemStatus,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

const InboxListResponseSchema = paginatedResponseSchema(InboxItemSchema);
const InboxConfirmResponseSchema = z.object({ inbox_id: z.string().uuid(), status: z.string() });

export interface InboxListParams {
  status?: InboxItemStatus;
  /** Archived captures are hidden unless this is true (Checkpoint 9.3). */
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listInbox(baseUrl: string, params: InboxListParams = {}) {
  return fetchJson(baseUrl, `/inbox${buildQuery(params)}`, InboxListResponseSchema);
}

export async function getInboxItem(baseUrl: string, id: string): Promise<InboxItem> {
  return fetchJson(baseUrl, `/inbox/${id}`, InboxItemSchema);
}

export async function confirmInboxItem(
  baseUrl: string,
  id: string,
  body: InboxConfirmRequest = {},
) {
  const parsed = InboxConfirmRequestSchema.parse(body);
  return fetchJson(baseUrl, `/inbox/${id}/confirm`, InboxConfirmResponseSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

/**
 * Archives a capture (Checkpoint 9.3). Idempotent: a second call returns the
 * `archived_at` the first one stamped. The row is never deleted and the entity
 * the capture committed is never touched. Throws `ApiClientError` with
 * `.code === "not_found"` (404) for an unknown id.
 */
export async function archiveInboxItem(baseUrl: string, id: string): Promise<InboxArchiveResponse> {
  return fetchJson(baseUrl, `/inbox/${id}/archive`, InboxArchiveResponseSchema, {
    method: "POST",
  });
}
