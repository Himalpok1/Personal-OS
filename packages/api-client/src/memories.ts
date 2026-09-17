import {
  MemoryDeleteAllResponseSchema,
  MemoryItemSchema,
  MemoryListResponseSchema,
  MemorySettingsSchema,
  MemorySuggestionDecideResponseSchema,
  MemorySuggestionsResponseSchema,
  type MemoryCreate,
  type MemoryDeleteAllResponse,
  type MemoryItem,
  type MemoryListQuery,
  type MemoryListResponse,
  type MemorySettings,
  type MemorySettingsUpdate,
  type MemorySuggestion,
  type MemorySuggestionDecideRequest,
  type MemorySuggestionDecideResponse,
  type MemorySuggestionsResponse,
  type MemoryUpdate,
} from "@personal-os/schema";
import { z } from "zod";
import { buildQuery, fetchJson } from "./client.js";

// Checkpoint 10.7 (ADR-077) -- the Personal Memory & Preference Layer.
//
// Every write here is the OWNER's explicit act: create, edit, delete, decide
// on a shown suggestion, flip the switch. No method exists that lets a client
// set `source` or `suggestion_id`; provenance is server-assigned. Memory is
// read by the client-side Focus Now / briefing composition only -- there is
// no route that sends it to a model, and Guard 6 in apps/api pins that.

export type {
  MemoryCreate,
  MemoryDeleteAllResponse,
  MemoryItem,
  MemoryListQuery,
  MemoryListResponse,
  MemorySettings,
  MemorySettingsUpdate,
  MemorySuggestion,
  MemorySuggestionDecideRequest,
  MemorySuggestionDecideResponse,
  MemorySuggestionsResponse,
  MemoryUpdate,
};

export type MemoryListParams = Partial<MemoryListQuery>;

export async function getMemorySettings(baseUrl: string): Promise<MemorySettings> {
  return await fetchJson(baseUrl, "/memory-settings", MemorySettingsSchema);
}

export async function updateMemorySettings(
  baseUrl: string,
  body: MemorySettingsUpdate,
): Promise<MemorySettings> {
  return await fetchJson(baseUrl, "/memory-settings", MemorySettingsSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function listMemories(
  baseUrl: string,
  params: MemoryListParams = {},
): Promise<MemoryListResponse> {
  return await fetchJson(baseUrl, `/memories${buildQuery(params)}`, MemoryListResponseSchema);
}

export async function getMemory(baseUrl: string, id: string): Promise<MemoryItem> {
  return await fetchJson(baseUrl, `/memories/${encodeURIComponent(id)}`, MemoryItemSchema);
}

export async function createMemory(baseUrl: string, body: MemoryCreate): Promise<MemoryItem> {
  return await fetchJson(baseUrl, "/memories", MemoryItemSchema, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateMemory(
  baseUrl: string,
  id: string,
  body: MemoryUpdate,
): Promise<MemoryItem> {
  return await fetchJson(baseUrl, `/memories/${encodeURIComponent(id)}`, MemoryItemSchema, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

/** A real row delete (204). Unrecoverable by design -- see ADR-077 §2. */
export async function deleteMemory(baseUrl: string, id: string): Promise<void> {
  await fetchJson(baseUrl, `/memories/${encodeURIComponent(id)}`, z.undefined(), {
    method: "DELETE",
  });
}

/** Deletes every memory. The literal `confirm: true` body is the confirmation. */
export async function deleteAllMemories(baseUrl: string): Promise<MemoryDeleteAllResponse> {
  return await fetchJson(baseUrl, "/memories/delete-all", MemoryDeleteAllResponseSchema, {
    method: "POST",
    body: JSON.stringify({ confirm: true }),
  });
}

/**
 * Pending suggestions, computed at request time from rows the owner already
 * sees (ADR-077 §4). Empty when the memory switch is off.
 */
export async function listMemorySuggestions(baseUrl: string): Promise<MemorySuggestionsResponse> {
  return await fetchJson(baseUrl, "/memory-suggestions", MemorySuggestionsResponseSchema);
}

export async function decideMemorySuggestion(
  baseUrl: string,
  key: string,
  body: MemorySuggestionDecideRequest,
): Promise<MemorySuggestionDecideResponse> {
  return await fetchJson(
    baseUrl,
    `/memory-suggestions/${encodeURIComponent(key)}/decide`,
    MemorySuggestionDecideResponseSchema,
    { method: "POST", body: JSON.stringify(body) },
  );
}
