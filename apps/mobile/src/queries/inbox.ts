import type { InboxListParams } from "@personal-os/api-client";
import type { InboxConfirmRequest } from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Every inbox query lives under this prefix so one invalidation reaches the
// list (any params), the per-item detail, and anything else keyed here.
export const inboxKey = ["inbox"] as const;
export const inboxListKey = (params: InboxListParams = {}) => ["inbox", "list", params] as const;
export const inboxItemKey = (id: string) => ["inbox", "item", id] as const;

/**
 * Milliseconds between refetches while a confirm is being committed.
 * `POST /inbox/:id/confirm` is 202: the worker commits asynchronously, so the
 * detail screen polls until `status` leaves needs_confirm/failed. Bounded by
 * INBOX_COMMIT_POLL_MAX so a stuck job cannot keep a screen polling forever.
 */
export const INBOX_COMMIT_POLL_INTERVAL_MS = 2_000;
export const INBOX_COMMIT_POLL_MAX = 15; // 30 s

export function useInbox(params: InboxListParams = {}) {
  return useQuery({
    queryKey: inboxListKey(params),
    queryFn: () => api.listInbox(params),
  });
}

export interface UseInboxItemOptions {
  /** Refetch on this interval; `false` (default) refetches only on the usual triggers. */
  refetchIntervalMs?: number | false;
}

export function useInboxItem(id: string | undefined, options: UseInboxItemOptions = {}) {
  return useQuery({
    queryKey: inboxItemKey(id ?? ""),
    queryFn: () => api.getInboxItem(id!),
    enabled: id !== undefined,
    refetchInterval: options.refetchIntervalMs ?? false,
  });
}

function useInvalidateAfterInboxChange() {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: inboxKey });
    // A confirmed item may commit a new task/note/event, which the relevant
    // list screens should pick up too; Today counts inbox attention.
    void queryClient.invalidateQueries({ queryKey: ["tasks"] });
    void queryClient.invalidateQueries({ queryKey: ["notes"] });
    void queryClient.invalidateQueries({ queryKey: ["events"] });
    void queryClient.invalidateQueries({ queryKey: ["today"] });
  };
}

export function useConfirmInboxItem() {
  const invalidate = useInvalidateAfterInboxChange();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body?: InboxConfirmRequest }) =>
      api.confirmInboxItem(id, body),
    onSuccess: invalidate,
  });
}

/**
 * "Dismiss": `POST /inbox/:id/archive` (Checkpoint 9.3, contract 6). Archiving
 * hides the row from the default list and from Today's attention counts; it
 * never deletes the row and never touches a committed entity, so there is no
 * destructive confirmation gate on it.
 */
export function useArchiveInboxItem() {
  const invalidate = useInvalidateAfterInboxChange();
  return useMutation({
    mutationFn: (id: string) => api.archiveInboxItem(id),
    onSuccess: invalidate,
  });
}
