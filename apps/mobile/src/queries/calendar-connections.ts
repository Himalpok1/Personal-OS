import type {
  CalendarConnectionCalendarUpdate,
  CalendarTarget,
  ConnectCaldavCalendarRequest,
  ConnectGoogleCalendarRequest,
  LinkEventToCalendarRequest,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { EVENT_MUTATION_INVALIDATION_KEYS } from "./events";

const connectionsKey = ["calendar-connections"] as const;
export const calendarTargetsKey = ["calendar-targets"] as const;

const NO_TARGETS: readonly CalendarTarget[] = [];
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

/**
 * Every connection-level mutation also refreshes the calendar-targets list:
 * a calendar toggled on, a connection connected, disconnected or re-synced
 * changes which calendars a NEW event may be written to, and the event
 * screens read that list from `calendarTargetsKey` -- without this a
 * calendar enabled in Settings became a target only after a relaunch.
 */
export const CALENDAR_MUTATION_INVALIDATION_KEYS = [connectionsKey, calendarTargetsKey] as const;

function useInvalidateCalendarConnections() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of CALENDAR_MUTATION_INVALIDATION_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
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
      for (const queryKey of CALENDAR_MUTATION_INVALIDATION_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
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

/**
 * GET /calendar-targets (Checkpoint 9.5): the calendars a NEW local event
 * may be written to -- sync-enabled, on an active connection, writable.
 * Replaces the Phase 4 `useLinkableGoogleCalendars`, which merged the
 * available/persisted calendar lists client-side and offered every
 * sync-enabled Google calendar whether or not it was writable. `targets` is
 * a stable empty array until the query resolves, so the pickers can render
 * nothing without a loading state of their own.
 */
export function calendarTargetsQueryOptions() {
  return {
    queryKey: calendarTargetsKey,
    queryFn: () => api.listCalendarTargets(),
  };
}

export function useCalendarTargets() {
  const query = useQuery(calendarTargetsQueryOptions());
  return { ...query, targets: query.data?.items ?? NO_TARGETS };
}

export function useLinkEventToCalendar() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ eventId, body }: { eventId: string; body: LinkEventToCalendarRequest }) =>
      api.linkEventToCalendar(eventId, body),
    onSuccess: () => {
      for (const queryKey of EVENT_MUTATION_INVALIDATION_KEYS) {
        void queryClient.invalidateQueries({ queryKey });
      }
    },
  });
}
