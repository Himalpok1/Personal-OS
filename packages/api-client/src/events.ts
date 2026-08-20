import {
  EventCancelOccurrenceSchema,
  EventCreateSchema,
  EventDetachSchema,
  EventRangeQuerySchema,
  EventRangeResponseSchema,
  EventSchema,
  EventUpdateSchema,
  paginatedResponseSchema,
  type Event,
  type EventCancelOccurrence,
  type EventCreate,
  type EventDetach,
  type EventRangeItem,
  type EventRangeQuery,
  type EventRangeResponse,
  type EventUpdate,
} from "@personal-os/schema";
import { buildQuery, fetchJson } from "./client.js";

export type {
  Event,
  EventCancelOccurrence,
  EventCreate,
  EventDetach,
  EventRangeItem,
  EventRangeQuery,
  EventRangeResponse,
  EventUpdate,
};

const EventListResponseSchema = paginatedResponseSchema(EventSchema);

// Client-side params, not the server's EventListQuerySchema directly --
// same reasoning as TaskListParams in tasks.ts, though here the shapes
// happen to coincide since events has no array-valued filter to
// re-serialize.
export interface EventListParams {
  project_id?: string;
  include_archived?: boolean;
  limit?: number;
  offset?: number;
}

export async function listEvents(baseUrl: string, params: EventListParams = {}) {
  return fetchJson(baseUrl, `/events${buildQuery(params)}`, EventListResponseSchema);
}

export async function getEvent(baseUrl: string, id: string): Promise<Event> {
  return fetchJson(baseUrl, `/events/${id}`, EventSchema);
}

export async function createEvent(baseUrl: string, body: EventCreate): Promise<Event> {
  const parsed = EventCreateSchema.parse(body);
  return fetchJson(baseUrl, "/events", EventSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function updateEvent(baseUrl: string, id: string, body: EventUpdate): Promise<Event> {
  const parsed = EventUpdateSchema.parse(body);
  return fetchJson(baseUrl, `/events/${id}`, EventSchema, {
    method: "PATCH",
    body: JSON.stringify(parsed),
  });
}

export async function archiveEvent(baseUrl: string, id: string): Promise<Event> {
  return fetchJson(baseUrl, `/events/${id}/archive`, EventSchema, { method: "POST" });
}

// GET /events/range -- the calendar-view read contract. Response is a bare
// JSON array (EventRangeResponseSchema), not the paginated {items,...}
// envelope every other list endpoint in this package uses, so it's parsed
// through its own schema rather than paginatedResponseSchema.
export async function listEventsInRange(baseUrl: string, query: EventRangeQuery) {
  const parsed = EventRangeQuerySchema.parse(query);
  return fetchJson(baseUrl, `/events/range${buildQuery(parsed)}`, EventRangeResponseSchema);
}

export async function detachEvent(baseUrl: string, id: string, body: EventDetach): Promise<Event> {
  const parsed = EventDetachSchema.parse(body);
  return fetchJson(baseUrl, `/events/${id}/detach`, EventSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}

export async function cancelEventOccurrence(
  baseUrl: string,
  id: string,
  body: EventCancelOccurrence,
): Promise<Event> {
  const parsed = EventCancelOccurrenceSchema.parse(body);
  return fetchJson(baseUrl, `/events/${id}/cancel-occurrence`, EventSchema, {
    method: "POST",
    body: JSON.stringify(parsed),
  });
}
