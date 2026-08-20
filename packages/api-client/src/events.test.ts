import type { EventRangeQuery } from "@personal-os/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import {
  archiveEvent,
  createEvent,
  getEvent,
  listEvents,
  listEventsInRange,
  updateEvent,
} from "./events.js";

const eventRow = {
  id: "22222222-2222-4222-8222-222222222222",
  title: "Team standup",
  description: null,
  location: null,
  starts_at: "2026-08-21T14:00:00.000Z",
  ends_at: "2026-08-21T14:30:00.000Z",
  timezone: "America/Chicago",
  all_day: false,
  start_date: null,
  end_date: null,
  rrule: null,
  recurrence_timezone: null,
  recurrence_until: null,
  recurrence_count: null,
  recurrence_exdates: null,
  project_id: null,
  archived_at: null,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

const rangeItem = {
  id: eventRow.id,
  title: eventRow.title,
  description: null,
  location: null,
  all_day: false,
  starts_at: eventRow.starts_at,
  ends_at: eventRow.ends_at,
  start_date: null,
  end_date: null,
  is_recurring_instance: false,
  occurs_at: null,
  occurs_ends_at: null,
  status: null,
};

describe("listEvents", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds the correct request and parses a paginated response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [eventRow], limit: 20, offset: 0, total: 1 }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock;

    const result = await listEvents("http://localhost:3000", {
      project_id: "proj-1",
      include_archived: true,
      limit: 20,
      offset: 0,
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://localhost:3000/events?project_id=proj-1&include_archived=true&limit=20&offset=0",
    );
    expect(init.method).toBeUndefined();
    expect(result.items).toEqual([eventRow]);
    expect(result.total).toBe(1);
  });
});

describe("getEvent", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("requests the single-event endpoint", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(eventRow), { status: 200 }));
    global.fetch = fetchMock;

    const result = await getEvent("http://localhost:3000", eventRow.id);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/events/${eventRow.id}`);
    expect(result).toEqual(eventRow);
  });
});

describe("createEvent", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs the parsed body to /events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(eventRow), { status: 201 }));
    global.fetch = fetchMock;

    await createEvent("http://localhost:3000", {
      title: "Team standup",
      starts_at: "2026-08-21T09:00:00-05:00",
      ends_at: "2026-08-21T09:30:00-05:00",
      timezone: "America/Chicago",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({ title: "Team standup" });
  });

  it("POSTs recurring event fields properly to /events", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(eventRow), { status: 201 }));
    global.fetch = fetchMock;

    await createEvent("http://localhost:3000", {
      title: "Daily Standup",
      starts_at: "2026-08-21T09:00:00-05:00",
      ends_at: "2026-08-21T09:30:00-05:00",
      timezone: "America/Chicago",
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrence_timezone: "America/Chicago",
      recurrence_until: "2026-12-31T23:59:59.999Z",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/events");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Daily Standup",
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrence_timezone: "America/Chicago",
      recurrence_until: "2026-12-31T23:59:59.999Z",
    });
  });
});

describe("updateEvent", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("PATCHes the parsed body to /events/:id", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(eventRow), { status: 200 }));
    global.fetch = fetchMock;

    await updateEvent("http://localhost:3000", eventRow.id, { title: "Renamed standup" });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/events/${eventRow.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Renamed standup" });
  });

  it("PATCHes recurring event fields including rrule and recurrence_count", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(eventRow), { status: 200 }));
    global.fetch = fetchMock;

    await updateEvent("http://localhost:3000", eventRow.id, {
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
      recurrence_timezone: "America/Chicago",
      recurrence_count: 10,
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/events/${eventRow.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      rrule: "FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE",
      recurrence_timezone: "America/Chicago",
      recurrence_count: 10,
    });
  });
});

describe("archiveEvent", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs to /events/:id/archive with no body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...eventRow, archived_at: "2026-08-20T00:00:00.000Z" }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock;

    const result = await archiveEvent("http://localhost:3000", eventRow.id);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/events/${eventRow.id}/archive`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string> | undefined)?.["Content-Type"]).toBeUndefined();
    expect(result.archived_at).toBe("2026-08-20T00:00:00.000Z");
  });
});

describe("listEventsInRange", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds the query string with from/to/include_archived and parses the bare array response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify([rangeItem]), { status: 200 }));
    global.fetch = fetchMock;

    const result = await listEventsInRange("http://localhost:3000", {
      from: "2026-08-01T00:00:00-05:00",
      to: "2026-09-01T00:00:00-05:00",
      include_archived: true,
    });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const parsedUrl = new URL(url.toString());
    expect(parsedUrl.pathname).toBe("/events/range");
    expect(parsedUrl.searchParams.get("from")).toBe("2026-08-01T00:00:00-05:00");
    expect(parsedUrl.searchParams.get("to")).toBe("2026-09-01T00:00:00-05:00");
    expect(parsedUrl.searchParams.get("include_archived")).toBe("true");
    expect(result).toEqual([rangeItem]);
  });

  // EventRangeQuery's inferred type requires include_archived (the schema
  // fills it via z.default, same precedent as OccurrenceListQuery forcing
  // limit/offset) -- a plain JS caller isn't bound by that TS type, so this
  // casts to verify EventRangeQuerySchema.parse's own default still applies
  // at runtime when the field is actually omitted from the request.
  it("defaults include_archived to false when omitted", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify([]), { status: 200 }));
    global.fetch = fetchMock;

    await listEventsInRange("http://localhost:3000", {
      from: "2026-08-01T00:00:00-05:00",
      to: "2026-09-01T00:00:00-05:00",
    } as EventRangeQuery);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    const parsedUrl = new URL(url.toString());
    expect(parsedUrl.searchParams.get("include_archived")).toBe("false");
  });
});

describe("error handling", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("throws ApiClientError with status/code/body on a non-2xx response", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    await expect(getEvent("http://localhost:3000", eventRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiErr = err as ApiClientError;
        expect(apiErr.status).toBe(404);
        expect(apiErr.code).toBe("not_found");
        expect(apiErr.body).toEqual({ error: "not_found" });
        return true;
      },
    );
  });
});
