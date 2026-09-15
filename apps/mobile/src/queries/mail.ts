import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Mail connection + digest queries (Checkpoint 7.6).
//
// Perimeter-only, exactly like the calendar and health hooks: no device bearer
// token is threaded, because `mail-connections.ts` and `mail-digests.ts` install
// no `deviceAuthPreHandler`. Adding one would invent an auth requirement that
// does not exist and would break these screens in the UI-test shell, which
// mounts no device identity at all.

const connectionsKey = ["mail-connections"] as const;
const digestKey = ["mail-digest", "current"] as const;

export function useMailConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: () => api.listMailConnections() });
}

/**
 * Mints a FRESH authorize URL for each attempt.
 *
 * A mutation rather than a query, and that is the whole point: the response
 * carries `state_expires_at`, the OAuth state is single-use, and expiry is
 * checked BEFORE the code is spent. Checkpoint 7.2's first live attempt failed
 * `400 invalid_state` because consent took longer than the state's lifetime --
 * and the rejected attempt still burned its state. A cached URL reproduces that
 * failure by construction, so there is deliberately no cache here.
 */
export function useGmailAuthorizeUrl() {
  return useMutation({
    mutationFn: (redirectUri: string) => api.getGmailAuthorizeUrl(redirectUri),
  });
}

export function useDisconnectMailConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disconnectMailConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      // The digest's empty state depends on whether a mailbox is active, so
      // disconnecting the last one changes what that card should say.
      void queryClient.invalidateQueries({ queryKey: ["mail-digest"] });
    },
  });
}

export function useCurrentMailDigest() {
  return useQuery({ queryKey: digestKey, queryFn: () => api.getCurrentMailDigest() });
}

/**
 * Asks the server to generate a digest now.
 *
 * RESOLVES TO AN ACKNOWLEDGEMENT, NOT A DIGEST: generation runs in the worker,
 * so success means the job was accepted. The invalidation below is therefore a
 * best-effort nudge rather than a guarantee that a new digest is there -- the
 * refetch it triggers will usually still show the previous one, and the card
 * must not present that as failure.
 *
 * There is deliberately no polling loop. The Checkpoint 5.6 defect is the
 * reason: a globally-mounted component polling on a timer starved the JS thread
 * on the Rabbit R1 until the UI froze. A digest is a once-a-day artifact, and
 * the global `staleTime` plus the focus refetch bridged from AppState will pick
 * it up without a dedicated timer.
 */
export function useGenerateMailDigest() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.generateMailDigest(),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["mail-digest"] });
    },
  });
}
