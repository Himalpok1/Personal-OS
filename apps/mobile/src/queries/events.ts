import type {
  Event,
  EventCancelOccurrence,
  EventCreate,
  EventDetach,
  EventRangeQuery,
  EventUpdate,
} from "@personal-os/schema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { UI_TEST_MODE } from "@/config/ui-test-mode";
import { api } from "./client";

const UI_TEST_EVENT: Event = {
  id: "00000000-0000-4000-8000-000000000042",
  title: "Rabbit layout verification",
  description: "Temporary local-only form fixture",
  location: "Development",
  starts_at: "2026-08-20T14:00:00.000Z",
  ends_at: "2026-08-20T14:30:00.000Z",
  timezone: "America/Chicago",
  all_day: false,
  start_date: null,
  end_date: null,
  rrule: null,
  recurrence_timezone: null,
  recurrence_until: null,
  recurrence_count: null,
  recurrence_exdates: [],
  parent_event_id: null,
  original_start_at: null,
  project_id: null,
  archived_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
  origin: "local",
  sync: null,
};

const eventKey = (id: string) => ["events", id] as const;
const eventsRangeKey = (query: EventRangeQuery) => ["events", "range", query] as const;

export function useEvent(id: string | undefined) {
  return useQuery({
    queryKey: eventKey(id ?? ""),
    queryFn: () => (UI_TEST_MODE ? Promise.resolve(UI_TEST_EVENT) : api.getEvent(id!)),
    enabled: id !== undefined,
  });
}

// GET /events/range -- the merged one-off + recurring-instance calendar-view
// read contract (see packages/schema/src/events.ts's EventRangeItemSchema
// comment). This hook does no windowing itself; a later screen-assembly
// step (month/week grid) supplies the {from, to} window. Query key nests
// under "events" (not a separate top-level key) so useInvalidateEvents'
// prefix-match invalidation below also covers cached range windows.
export function useEventsInRange(query: EventRangeQuery | undefined) {
  return useQuery({
    queryKey: eventsRangeKey(query ?? { from: "", to: "", include_archived: false }),
    queryFn: () => api.listEventsInRange(query!),
    enabled: query !== undefined,
  });
}

// Every event mutation refreshes the three read models an event appears in
// (Checkpoint 9.5): the events list/detail/range caches under ["events"],
// Today (queries/today.ts) and the Agenda (queries/agenda.ts). Before 9.5
// only ["events"] was invalidated, so a newly created or deleted event did
// not appear on -- or vanish from -- Today until its next refetch.
export const EVENT_MUTATION_INVALIDATION_KEYS = [["events"], ["today"], ["agenda"]] as const;

function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () => {
    for (const queryKey of EVENT_MUTATION_INVALIDATION_KEYS) {
      void queryClient.invalidateQueries({ queryKey });
    }
  };
}

export function useCreateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (body: EventCreate) => api.createEvent(body),
    onSuccess: invalidate,
  });
}

export function useUpdateEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EventUpdate }) => api.updateEvent(id, body),
    onSuccess: invalidate,
  });
}

export function useArchiveEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: (id: string) => api.archiveEvent(id),
    onSuccess: invalidate,
  });
}

export function useDetachEvent() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EventDetach }) => api.detachEvent(id, body),
    onSuccess: invalidate,
  });
}

export function useCancelEventOccurrence() {
  const invalidate = useInvalidateEvents();
  return useMutation({
    mutationFn: ({ id, body }: { id: string; body: EventCancelOccurrence }) =>
      api.cancelEventOccurrence(id, body),
    onSuccess: invalidate,
  });
}
