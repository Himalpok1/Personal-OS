import {
  InboxConfirmRequestSchema,
  InboxItemSchema,
  paginatedResponseSchema,
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
