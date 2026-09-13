import type {
  CalendarConnectionCalendarUpdate,
  ConnectCaldavCalendarRequest,
  ConnectGoogleCalendarRequest,
  LinkEventToCalendarRequest,
  LinkEventToGoogleCalendarRequest,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { mergeAvailableCalendars } from "@/calendar-connections/merge-available-calendars";
import { api } from "./client";

const connectionsKey = ["calendar-connections"] as const;
const availableCalendarsKey = (connectionId: string) =>
  ["calendar-connections", connectionId, "available-calendars"] as const;

const persistedCalendarsKey = (connectionId: string) =>
  ["calendar-connections", connectionId, "calendars"] as const;

/**
 * Exported as a plain function (same convention as `askCloudMutationOptions`
 * in `./ask.ts`) so the queryFn is unit-testable without a render harness --
 * this app has none, and `useQuery` itself needs a live `QueryClientProvider`
 * tree to run at all.
 *
 * Before Checkpoint 9.1 this hook's queryFn was `() => Promise.resolve([])`
 * unconditionally -- it never called the backend at all. The only place this
 * query's cache was ever populated with real data was
 * `useUpdateCalendarConnectionCalendars`'s `onSuccess`, via `setQueryData`.
 * So on a cold launch (or any time before a toggle had been made THIS
 * session), every persisted calendar looked unpersisted, and
 * `mergeAvailableCalendars` defaults `sync_enabled` to `false` for anything
 * with no matching persisted row -- rendering every calendar's sync toggle
 * as OFF regardless of the database. `staleTime`/`gcTime: Infinity` are kept:
 * react-query still performs the first fetch when there is no cached data
 * yet (exactly the cold-launch case here), and the mutation's `setQueryData`
 * already keeps the cache current after every toggle.
 */
export function persistedCalendarConnectionCalendarsQueryOptions(connectionId: string | undefined) {
  return {
    queryKey: persistedCalendarsKey(connectionId ?? ""),
    queryFn: () => api.listCalendarConnectionCalendars(connectionId!),
    enabled: connectionId !== undefined,
    staleTime: Infinity,
    gcTime: Infinity,
  };
}

export function usePersistedCalendarConnectionCalendars(connectionId: string | undefined) {
  return useQuery(persistedCalendarConnectionCalendarsQueryOptions(connectionId));
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

export function useAvailableCalendars(connectionId: string | undefined) {
  return useQuery({
    queryKey: availableCalendarsKey(connectionId ?? ""),
    queryFn: () => api.listAvailableCalendars(connectionId!),
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

export function useConnectCaldavCalendar() {
  const invalidate = useInvalidateCalendarConnections();
  return useMutation({
    mutationFn: (body: ConnectCaldavCalendarRequest) => api.connectCaldavCalendar(body),
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

export function useLinkableGoogleCalendars() {
  const { data: connectionsData } = useCalendarConnections();
  const activeConnection = (connectionsData?.items ?? []).find(
    (connection) => connection.provider === "google" && connection.status === "active",
  );
  const { data: available } = useAvailableGoogleCalendars(activeConnection?.id);
  const { data: persisted } = usePersistedCalendarConnectionCalendars(activeConnection?.id);

  const calendars = mergeAvailableCalendars(available ?? [], persisted ?? []).filter(
    (calendar) => calendar.sync_enabled && calendar.google_calendar_id,
  );

  return { connectionId: activeConnection?.id, calendars };
}

export function useLinkableCalendars() {
  const { data: connectionsData } = useCalendarConnections();
  const activeConnections = (connectionsData?.items ?? []).filter(
    (connection) => connection.status === "active",
  );

  // Return connections list and a helper
  return { activeConnections };
}

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

export function useLinkEventToCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      eventId,
      body,
    }: {
      eventId: string;
      body: LinkEventToCalendarRequest;
    }) => api.linkEventToCalendar(eventId, body),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["events"] });
    },
  });
}
