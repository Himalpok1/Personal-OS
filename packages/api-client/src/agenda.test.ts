import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { getAgenda } from "./agenda.js";

const taskItem = {
  kind: "task",
  id: "11111111-1111-4111-8111-111111111111",
  title: "Submit report",
  due_at: "2026-08-20T15:00:00.000Z",
  remind_at: null,
  timezone: "America/Chicago",
  priority: null,
  project_id: null,
  project_name: null,
  rrule: null,
  parent_task_id: null,
};

const occurrenceItem = {
  kind: "occurrence",
  id: "22222222-2222-4222-8222-222222222222",
  title: "Water the plants",
  due_at: "2026-08-19T14:00:00.000Z",
  remind_at: null,
  timezone: "America/Chicago",
  priority: null,
  project_id: null,
  project_name: null,
  rrule: "FREQ=DAILY;INTERVAL=3",
  parent_task_id: "33333333-3333-4333-8333-333333333333",
  occurrence_id: "44444444-4444-4444-8444-444444444444",
  occurs_at: "2026-08-19T14:00:00.000Z",
};

const eventItem = {
  kind: "event",
  id: "55555555-5555-4555-8555-555555555555",
  title: "Company holiday",
  starts_at: null,
  ends_at: null,
  all_day: true,
  start_date: "2026-08-21",
  end_date: "2026-08-21",
  location: null,
  project_id: null,
  rrule: null,
  parent_event_id: null,
  occurs_at: null,
};

const agendaResponse = {
  tz: "America/Chicago",
  from: "2026-08-19",
  to: "2026-08-21",
  generated_at: "2026-08-19T09:00:00.000Z",
  effective_now: "2026-08-19T09:00:00.000Z",
  overdue: [taskItem, occurrenceItem],
  days: [
    { date: "2026-08-19", items: [occurrenceItem] },
    { date: "2026-08-20", items: [taskItem] },
    { date: "2026-08-21", items: [eventItem] },
  ],
};

describe("agenda api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds /agenda with tz/from/to query params, omitting project_id when absent", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(agendaResponse), { status: 200 }));
    global.fetch = fetchMock;

    await getAgenda("http://localhost:3000", {
      tz: "America/Chicago",
      from: "2026-08-19",
      to: "2026-08-21",
    });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://localhost:3000/agenda?tz=America%2FChicago&from=2026-08-19&to=2026-08-21",
    );
  });

  it("includes project_id in the query string when supplied", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(agendaResponse), { status: 200 }));
    global.fetch = fetchMock;

    await getAgenda("http://localhost:3000", {
      tz: "America/Chicago",
      from: "2026-08-19",
      to: "2026-08-21",
      project_id: "33333333-3333-4333-8333-333333333333",
    });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://localhost:3000/agenda?tz=America%2FChicago&from=2026-08-19&to=2026-08-21&project_id=33333333-3333-4333-8333-333333333333",
    );
  });

  it("does not send a Content-Type header for a bodyless GET", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(agendaResponse), { status: 200 }));
    global.fetch = fetchMock;

    await getAgenda("http://localhost:3000", {
      tz: "America/Chicago",
      from: "2026-08-19",
      to: "2026-08-21",
    });

    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("parses a successful response through AgendaResponseSchema, including all item kinds", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(agendaResponse), { status: 200 }));

    const res = await getAgenda("http://localhost:3000", {
      tz: "America/Chicago",
      from: "2026-08-19",
      to: "2026-08-21",
    });
    expect(res).toEqual(agendaResponse);
  });

  it("throws ApiClientError on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "validation_failed" }), {
        status: 400,
      }),
    );

    await expect(
      getAgenda("http://localhost:3000", {
        tz: "Mars/Olympus",
        from: "2026-08-19",
        to: "2026-08-21",
      }),
    ).rejects.toSatisfy((err: unknown) => {
      expect(err).toBeInstanceOf(ApiClientError);
      expect((err as ApiClientError).status).toBe(400);
      return true;
    });
  });

  it("rejects a malformed response body at the boundary parse (occurrence missing occurrence_id)", async () => {
    const malformedOccurrence = { ...occurrenceItem } as Record<string, unknown>;
    delete malformedOccurrence["occurrence_id"];
    const malformedResponse = {
      ...agendaResponse,
      overdue: [malformedOccurrence],
    };
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(malformedResponse), { status: 200 }));

    await expect(
      getAgenda("http://localhost:3000", {
        tz: "America/Chicago",
        from: "2026-08-19",
        to: "2026-08-21",
      }),
    ).rejects.toThrow();
  });
});
