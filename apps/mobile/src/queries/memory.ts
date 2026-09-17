import type { MemoryListParams } from "@personal-os/api-client";
import type {
  MemoryCreate,
  MemorySuggestion,
  MemorySuggestionDecideRequest,
  MemoryUpdate,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Personal Memory & Preference Layer hooks (Checkpoint 10.7, ADR-077).
//
// Perimeter-only, like the tasks/notes/projects hooks: the memory routes
// install no device auth (ADR-077 §8), so no bearer token is threaded here.
//
// Every write is the OWNER's explicit act -- create, edit, delete, decide on
// a shown suggestion, flip the switch -- and every one invalidates BOTH the
// memory domain and `["today"]`: Focus Now and the briefing are composed on
// the client from `/today` plus the memories `useMemoriesForIntelligence`
// lists (ADR-077 §5), so a saved or deleted memory must re-derive them the
// same way a task write does. Nothing here reaches a model: memory has no
// route into `/ask`, `/focus` or `/briefs`, and the source guard in
// src/__tests__/memory-privacy-line.test.ts pins that no Ask surface imports
// this module.

export const memoryKeys = {
  /** Prefix every memory query shares, so one invalidate covers the domain. */
  all: ["memory"] as const,
  settings: () => [...memoryKeys.all, "settings"] as const,
  list: (params: MemoryListParams) => [...memoryKeys.all, "list", params] as const,
  detail: (id: string | null) => [...memoryKeys.all, "detail", id] as const,
  suggestions: () => [...memoryKeys.all, "suggestions"] as const,
};

// A malformed memory id in a route param (a stale deep link) must never reach
// the API -- the same guard queries/projects.ts's coerceProjectIdParam applies.
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function coerceMemoryIdParam(value: unknown): string | null {
  return typeof value === "string" && UUID_PATTERN.test(value) ? value : null;
}

/**
 * The list the client-side composers read (ADR-077 §5). One page at the
 * schema's maximum (200): a single-user memory layer that is "minimal" by
 * principle will not exceed it, and the composers need the whole set, not a
 * window. Round 2's Focus Now / briefing composition consumes this hook.
 */
export const MEMORIES_FOR_INTELLIGENCE_LIMIT = 200;
const INTELLIGENCE_PARAMS: MemoryListParams = { limit: MEMORIES_FOR_INTELLIGENCE_LIMIT };

/** `GET /memory-settings` -- the global switch and the honest count. */
export function useMemorySettings() {
  return useQuery({
    queryKey: memoryKeys.settings(),
    queryFn: () => api.getMemorySettings(),
  });
}

/** `GET /memories` -- the Memory Center's list (every kind by default). */
export function useMemories(params: MemoryListParams = {}) {
  return useQuery({
    queryKey: memoryKeys.list(params),
    queryFn: () => api.listMemories(params),
  });
}

/** Every memory, for the deterministic client-side composition. */
export function useMemoriesForIntelligence() {
  return useMemories(INTELLIGENCE_PARAMS);
}

/** `GET /memories/:id`. `enabled: false` while the id is null or malformed. */
export function useMemory(id: string | null) {
  return useQuery({
    queryKey: memoryKeys.detail(id),
    queryFn: () => api.getMemory(id as string),
    enabled: id !== null,
  });
}

/**
 * `GET /memory-suggestions` -- the pending suggestions, computed at request
 * time from rows the owner already sees (ADR-077 §4). Empty when the switch
 * is off. Only the Memory Center reads it as a query; the explicit moment on
 * the project screen fetches once through `fetchMemorySuggestionForProject`.
 */
export function useMemorySuggestions() {
  return useQuery({
    queryKey: memoryKeys.suggestions(),
    queryFn: () => api.listMemorySuggestions(),
  });
}

function useInvalidateMemory() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: memoryKeys.all });
    // Focus Now and the briefing are composed from /today + memories.
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useUpdateMemorySettings() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (enabled: boolean) => api.updateMemorySettings({ enabled }),
    onSuccess: invalidate,
  });
}

export function useCreateMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (body: MemoryCreate) => api.createMemory(body),
    onSuccess: invalidate,
  });
}

export function useUpdateMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: MemoryUpdate }) => api.updateMemory(id, body),
    onSuccess: invalidate,
  });
}

/** A real row delete (ADR-077 §2) -- the caller confirms first. */
export function useDeleteMemory() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: (id: string) => api.deleteMemory(id),
    onSuccess: invalidate,
  });
}

/** Deletes every memory (ADR-077 §2) -- the caller confirms first. */
export function useDeleteAllMemories() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: () => api.deleteAllMemories(),
    onSuccess: invalidate,
  });
}

export function useDecideMemorySuggestion() {
  const invalidate = useInvalidateMemory();
  return useMutation({
    mutationFn: ({ key, body }: { key: string; body: MemorySuggestionDecideRequest }) =>
      api.decideMemorySuggestion(key, body),
    onSuccess: invalidate,
  });
}

/**
 * The explicit moment (ADR-077 §4): after the owner saves a project goal, ask
 * the server ONCE whether it has a `project_goal` suggestion for THAT project
 * and return it, or null. Always a fresh fetch (the goal just changed), and
 * never a throw -- a failed suggestions call must not surface on a screen
 * that just saved a goal successfully. Behaviour-derived triggers do not
 * exist; this is the one place outside the Memory Center that asks.
 */
export async function fetchMemorySuggestionForProject(
  queryClient: QueryClient,
  projectId: string,
): Promise<MemorySuggestion | null> {
  try {
    const response = await queryClient.fetchQuery({
      queryKey: memoryKeys.suggestions(),
      queryFn: () => api.listMemorySuggestions(),
      staleTime: 0,
    });
    return response.items.find((item) => item.project?.id === projectId) ?? null;
  } catch {
    return null;
  }
}
