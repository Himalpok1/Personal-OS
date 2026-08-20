import type {
  CalendarConnectionCalendar,
  CalendarConnectionCalendarUpdate,
  ConnectGoogleCalendarRequest,
  LinkEventToGoogleCalendarRequest,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeAvailableCalendars } from "@/calendar-connections/merge-available-calendars";
import { api } from "./client";

// None of these routes are device-token-gated (see
// packages/api-client/src/calendar-connections.ts / events.ts's
// linkEventToGoogleCalendar -- both call fetchJson with no Authorization
// header), so this file follows queries/events.ts's plain-call convention,
// not queries/devices.ts's token-gated one.

const connectionsKey = ["calendar-connections"] as const;
const availableCalendarsKey = (connectionId: string) =>
  ["calendar-connections", connectionId, "available-calendars"] as const;

// There is deliberately no GET endpoint for persisted
// calendar_connection_calendars rows -- only PATCH
// /calendar-connections/:id/calendars returns them (see
// apps/api/src/routes/calendar-connections.ts). This query is therefore
// cache-only: it never issues a network request itself, and
// useUpdateCalendarConnectionCalendars seeds it directly via setQueryData
// whenever a toggle succeeds, as long as callers PATCH the full desired set
// each time (not just the one changed item) so the response is a complete
// snapshot. On a fresh screen mount, before any toggle has happened this
// session, this returns [] -- every available calendar reads as "not yet
// known to be syncing" until the user interacts or a sync-now response
// repopulates it. This is a real gap in the server contract, not a
// simplification; see the Checkpoint 4.5 B4 report for the full note.
const persistedCalendarsKey = (connectionId: string) =>
  ["calendar-connections", connectionId, "calendars"] as const;

export function usePersistedCalendarConnectionCalendars(connectionId: string | undefined) {
  return useQuery({
    queryKey: persistedCalendarsKey(connectionId ?? ""),
    queryFn: () => Promise.resolve([] as CalendarConnectionCalendar[]),
    enabled: connectionId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
  });
}

export function useCalendarConnections() {
  return useQuery({
    queryKey: connectionsKey,
    queryFn: () => api.listCalendarConnections(),
  });
}

export function useAvailableGoogleCalendars(connectionId: string | undefined) {
  return useQuery({
    queryKey: availableCalendarsKey(connectionId ?? ""),
    queryFn: () => api.listAvailableGoogleCalendars(connectionId!),
    enabled: connectionId !== undefined,
  });
}

function useInvalidateCalendarConnections() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: connectionsKey });
}

export function useConnectGoogleCalendar() {
  const invalidate = useInvalidateCalendarConnections();
  return useMutation({
    mutationFn: (body: ConnectGoogleCalendarRequest) => api.connectGoogleCalendar(body),
    onSuccess: invalidate,
  });
}

export function useUpdateCalendarConnectionCalendars() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      connectionId,
      body,
    }: {
      connectionId: string;
      body: CalendarConnectionCalendarUpdate[];
    }) => api.updateCalendarConnectionCalendars(connectionId, body),
    onSuccess: (data, variables) => {
      // Seed the cache-only persisted-calendars query with this response --
      // see persistedCalendarsKey's comment above. Callers must PATCH the
      // full desired set (not just the changed item) for this to be a
      // complete snapshot rather than a partial one.
      queryClient.setQueryData(persistedCalendarsKey(variables.connectionId), data);
      void queryClient.invalidateQueries({ queryKey: connectionsKey });
    },
  });
}

export function useSyncCalendarConnectionNow() {
  const invalidate = useInvalidateCalendarConnections();
  return useMutation({
    mutationFn: (connectionId: string) => api.syncCalendarConnectionNow(connectionId),
    onSuccess: invalidate,
  });
}

export function useDisconnectCalendarConnection() {
  const invalidate = useInvalidateCalendarConnections();
  return useMutation({
    mutationFn: (connectionId: string) => api.disconnectCalendarConnection(connectionId),
    onSuccess: invalidate,
  });
}

// The event create/edit screens' outbound-linking picker (Locked Decision
// 9). Scoped to a single active Google connection -- this is a single-user
// app, and there is no product requirement yet for picking among multiple
// simultaneously-connected Google accounts. Only returns calendars this
// session has confirmed are sync_enabled (see persistedCalendarsKey's
// comment above); a calendar toggled on in an earlier app session that
// hasn't been touched again this session won't appear here until the
// Settings screen re-confirms it via a toggle or a sync-now response. That
// is the same real gap, not a separate one.
export function useLinkableGoogleCalendars() {
  const { data: connectionsData } = useCalendarConnections();
  const activeConnection = (connectionsData?.items ?? []).find(
    (connection) => connection.provider === "google" && connection.status === "active",
  );
  const { data: available } = useAvailableGoogleCalendars(activeConnection?.id);
  const { data: persisted } = usePersistedCalendarConnectionCalendars(activeConnection?.id);

  const calendars = mergeAvailableCalendars(available ?? [], persisted ?? []).filter(
    (calendar) => calendar.sync_enabled,
  );

  return { connectionId: activeConnection?.id, calendars };
}

// Invalidates "events" too, since a successful link changes an event's
// outbound-sync state, which the events.ts query hooks own -- matches how
// useDetachEvent/useCancelEventOccurrence in queries/events.ts already
// invalidate that same top-level key on any event-mutating action.
export function useLinkEventToGoogleCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      body,
    }: {
      eventId: string;
      body: LinkEventToGoogleCalendarRequest;
    }) => api.linkEventToGoogleCalendar(eventId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
