import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import {
  completeProject,
  getProjectContext,
  getProjectDetail,
  getProjectSummaries,
  pauseProject,
  reopenProject,
  resumeProject,
  unarchiveProject,
} from "./projects.js";

const projectRow = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Kitchen remodel",
  status: "active" as const,
  goal: "Finish before winter",
  color: "#4f46e5",
  target_date: "2026-12-01",
  completed_at: null,
  archived_at: null,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-21T09:00:00.000Z",
};

const nextAction = {
  task_id: "22222222-2222-4222-8222-222222222222",
  title: "Order cabinets",
  due_at: "2026-08-25T15:00:00.000Z",
  priority: 1,
};

const counts = { open: 3, done: 2, overdue: 1 };

const summaryItem = {
  ...projectRow,
  next_action: nextAction,
  stalled: true,
  last_activity_at: "2026-08-21T09:00:00.000Z",
  counts,
};

const summariesResponse = { items: [summaryItem] };

const detailResponse = {
  project: projectRow,
  computed: {
    next_action: nextAction,
    stalled: false,
    last_activity_at: null,
    counts,
  },
  tasks: {
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        title: "Order cabinets",
        status: "active" as const,
        due_at: "2026-08-25T15:00:00.000Z",
        priority: 1,
        rrule: null,
        completed_at: null,
      },
    ],
    total: 1,
  },
  notes: {
    items: [
      {
        id: "33333333-3333-4333-8333-333333333333",
        title: "Contractor quotes",
        created_at: "2026-08-18T10:00:00.000Z",
        updated_at: "2026-08-18T10:00:00.000Z",
      },
    ],
    total: 1,
  },
  events: {
    items: [
      {
        id: "44444444-4444-4444-8444-444444444444",
        title: "Cabinet delivery",
        starts_at: "2026-08-26T14:00:00.000Z",
        ends_at: "2026-08-26T15:00:00.000Z",
        all_day: false,
        start_date: null,
        end_date: null,
        location: null,
        rrule: null,
      },
    ],
    total: 1,
  },
};

describe("projects summaries/detail api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("fetches /projects/summaries with include_archived=true", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(summariesResponse), { status: 200 }));
    global.fetch = fetchMock;

    const res = await getProjectSummaries("http://localhost:3000", true);
    expect(res).toEqual(summariesResponse);
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/projects/summaries?include_archived=true");
  });

  it("omits the include_archived param when not requested", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(summariesResponse), { status: 200 }));
    global.fetch = fetchMock;

    await getProjectSummaries("http://localhost:3000");

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/projects/summaries");
  });

  it("parses a successful response through ProjectSummaryListResponseSchema", async () => {
    // A summary row missing its computed fields must fail the schema parse.
    const incomplete = { items: [{ ...projectRow }] };
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(incomplete), { status: 200 }));

    await expect(getProjectSummaries("http://localhost:3000", true)).rejects.toBeTruthy();
  });

  it("gets project detail from /projects/:id/detail", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(detailResponse), { status: 200 }));
    global.fetch = fetchMock;

    const res = await getProjectDetail("http://localhost:3000", projectRow.id);
    expect(res).toEqual(detailResponse);
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/projects/${projectRow.id}/detail`);
  });

  it("throws ApiClientError with 404 for an unknown project detail", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "not_found" }), {
        status: 404,
      }),
    );

    await expect(getProjectDetail("http://localhost:3000", projectRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(404);
        return true;
      },
    );
  });
});

// Checkpoint 10.5 (ADR-074).
describe("project context api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const contextResponse = {
    project: projectRow,
    tasks: {
      items: [{ ...detailResponse.tasks.items[0], canvas_assignment_id: null }],
      total: 1,
    },
    events: detailResponse.events,
    related_captures: {
      items: [
        {
          id: "55555555-5555-4555-8555-555555555555",
          raw_text: "call the insurance guy",
          source: "web",
          status: "confirmed",
          captured_at: "2026-08-17T09:00:00.000Z",
          entity_type: "task",
          entity_id: detailResponse.tasks.items[0]!.id,
        },
      ],
      total: 1,
    },
    recent_activity: {
      items: [
        {
          type: "task_completed",
          description: 'Completed task "Order cabinets"',
          at: "2026-08-20T09:00:00.000Z",
        },
      ],
      total: 1,
    },
  };

  it("gets project context from /projects/:id/context", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(contextResponse), { status: 200 }));
    global.fetch = fetchMock;

    const res = await getProjectContext("http://localhost:3000", projectRow.id);
    expect(res).toEqual(contextResponse);
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/projects/${projectRow.id}/context`);
  });

  it("throws ApiClientError with 404 for an unknown project", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    await expect(getProjectContext("http://localhost:3000", projectRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(404);
        return true;
      },
    );
  });
});

describe("project lifecycle api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it.each([
    ["pause", pauseProject],
    ["resume", resumeProject],
    ["complete", completeProject],
    ["reopen", reopenProject],
    ["unarchive", unarchiveProject],
  ] as const)("POSTs /projects/:id/%s as a bodyless request", async (action, fn) => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(projectRow), { status: 200 }));
    global.fetch = fetchMock;

    const res = await fn("http://localhost:3000", projectRow.id);
    expect(res).toEqual(projectRow);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/projects/${projectRow.id}/${action}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    // Regression guard (Content-Type lesson): no body means no Content-Type.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("surfaces a 409 invalid transition as ApiClientError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_status_transition", status: "completed" }), {
        status: 409,
      }),
    );

    await expect(pauseProject("http://localhost:3000", projectRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiError = err as ApiClientError;
        expect(apiError.status).toBe(409);
        expect(apiError.code).toBe("invalid_status_transition");
        return true;
      },
    );
  });
});
