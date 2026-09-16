import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";

// Canvas LMS connection + content queries (Checkpoint 10.1, ADR-068).
//
// Perimeter-only, exactly like the mail/health/calendar hooks: no device
// bearer token is threaded, because apps/api/src/routes/canvas-connections.ts
// installs no deviceAuthPreHandler. Adding one would invent an auth
// requirement that does not exist and would break these screens in the
// UI-test shell, which mounts no device identity at all.
//
// `useCanvasUpcomingAssignments` is the read side this file originally
// stopped short of: `GET /canvas-assignments/upcoming` (apps/api/src/routes/
// canvas-assignments.ts) was added specifically to unblock it -- read-only,
// scoped to assignments (the only content the Today card asks for), never a
// general course/announcement/event browsing surface.

const connectionsKey = ["canvas-connections"] as const;

export function useCanvasConnections() {
  return useQuery({ queryKey: connectionsKey, queryFn: () => api.listCanvasConnections() });
}

export interface ConnectCanvasInput {
  baseUrl: string;
  personalAccessToken: string;
}

/**
 * The owner's one-time Canvas connection: a Canvas instance base URL plus a
 * Personal Access Token, verified against the real instance before anything
 * is written (apps/api/src/services/canvas-connection.ts). Unlike
 * `useGmailAuthorizeUrl`/the Google Calendar authorize flow there is no
 * authorize URL or redirect to mint first and no single-use state to
 * round-trip -- the credential is typed directly into the Settings form and
 * sent in this one request (ADR-068 §2).
 */
export function useConnectCanvas() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConnectCanvasInput) =>
      api.connectCanvas({
        base_url: input.baseUrl,
        personal_access_token: input.personalAccessToken,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });
}

export function useDisconnectCanvasConnection() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.disconnectCanvasConnection(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });
}

/**
 * Enqueues a manual Canvas sync; never runs it inline.
 *
 * RESOLVES TO AN ACKNOWLEDGEMENT (`{ queued }`), NOT SYNCED DATA -- the same
 * contract `useGenerateMailDigest`/`useSyncCalendarConnectionNow` document.
 * The sync itself runs in the worker, per course, with per-course failure
 * containment (ADR-068 §4/§5); re-read `useCanvasConnections` (for
 * `last_sync_at`/`last_sync_error`) or `useCanvasSyncRuns` to see the result.
 * The invalidation below is therefore a best-effort nudge, not a guarantee
 * that fresh data has landed by the time this mutation resolves.
 */
export function useTriggerCanvasSync() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.triggerCanvasSync(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
      // Broad, prefix-matching invalidation (no specific connection id in the
      // key) -- the same "nudge, not a guarantee" reasoning applies to sync
      // run history as it does to the connection row itself.
      void queryClient.invalidateQueries({ queryKey: ["canvas-sync-runs"] });
    },
  });
}

/**
 * The sync-run audit trail for one connection (ADR-068 §5), newest first.
 *
 * `enabled: false` while `connectionId` is null, mirroring every other
 * id-scoped list query in this package (e.g. `useCanvasSyncRuns` is called
 * per-row from a component that always has a real connection, but the guard
 * keeps this hook safe to call before that id is known too).
 */
export function useCanvasSyncRuns(connectionId: string | null, limit?: number) {
  return useQuery({
    queryKey: ["canvas-sync-runs", connectionId, limit ?? null] as const,
    queryFn: () => api.listCanvasSyncRuns(connectionId as string, limit),
    enabled: connectionId !== null,
  });
}

/**
 * Assignments due within `withinDays` (server default 7), across every
 * active connection's unarchived courses, sorted by `due_at` ascending and
 * denormalized with each assignment's course name -- the one query the
 * Today "upcoming assignments" card needs. Not gated on
 * `useCanvasConnections` being loaded first: an unconfigured/no-connection
 * server simply answers with an empty `items` array, so the card can render
 * off this query alone exactly like `useHealthSummary`'s
 * `!data.configured` case.
 */
export function useCanvasUpcomingAssignments(withinDays?: number) {
  return useQuery({
    queryKey: ["canvas-upcoming-assignments", withinDays ?? null] as const,
    queryFn: () => api.listUpcomingCanvasAssignments(withinDays),
  });
}
