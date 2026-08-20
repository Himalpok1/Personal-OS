import type { EventListParams } from "@personal-os/api-client";
import type { Event, EventCreate, EventRangeQuery, EventUpdate } from "@personal-os/schema";
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
  project_id: null,
  archived_at: null,
  created_at: "2026-08-20T00:00:00.000Z",
  updated_at: "2026-08-20T00:00:00.000Z",
};

const eventsKey = (params: EventListParams = {}) => ["events", params] as const;
const eventKey = (id: string) => ["events", id] as const;
const eventsRangeKey = (query: EventRangeQuery) => ["events", "range", query] as const;

export function useEvents(params: EventListParams = {}) {
  return useQuery({
    queryKey: eventsKey(params),
    queryFn: () => api.listEvents(params),
  });
}

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

function useInvalidateEvents() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: ["events"] });
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
