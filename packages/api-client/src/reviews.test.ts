import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import {
  completeReview,
  createReview,
  getDailyReviewContext,
  getLatestReview,
  getReview,
  getWeeklyReviewContext,
  listReviews,
  skipReview,
  updateReview,
} from "./reviews.js";

const reviewRow = {
  id: "11111111-1111-4111-8111-111111111111",
  kind: "daily",
  period_start: "2026-08-21",
  timezone: "America/Chicago",
  status: "in_progress",
  content: {
    version: 1,
    kind: "daily",
    checklist: { inbox: true, priorities: false },
    selected_priorities: [{ kind: "task", id: "22222222-2222-4222-8222-222222222222" }],
  },
  summary: null,
  created_at: "2026-08-21T09:00:00.000Z",
  updated_at: "2026-08-21T09:00:00.000Z",
  completed_at: null,
};

const listResponse = { items: [reviewRow], limit: 10, offset: 5, total: 1 };

const taskItem = {
  id: "22222222-2222-4222-8222-222222222222",
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

const contextProject = {
  id: "33333333-3333-4333-8333-333333333333",
  name: "Kitchen remodel",
  color: "#4f46e5",
  status: "active" as const,
  target_date: null,
  next_action: {
    task_id: "22222222-2222-4222-8222-222222222222",
    title: "Order cabinets",
    due_at: "2026-08-25T15:00:00.000Z",
    priority: 1,
  },
  stalled: false,
};

const dailyContext = {
  generated_at: "2026-08-21T09:00:00.000Z",
  effective_now: "2026-08-21T09:00:00.000Z",
  tz: "Pacific/Auckland",
  period_start: "2026-08-21",
  inbox_attention: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
  overdue: { items: [taskItem], total: 1 },
  due_today: { items: [], total: 0 },
  events_today: { items: [] },
  active_projects: { items: [contextProject], total: 1 },
  stalled_projects: { items: [], total: 0 },
  projects_without_next_action: { items: [], total: 0 },
  recently_completed: { items: [], total: 0 },
};

const weeklyContext = {
  generated_at: "2026-08-21T09:00:00.000Z",
  effective_now: "2026-08-21T09:00:00.000Z",
  tz: "Pacific/Auckland",
  period_start: "2026-08-17",
  inbox_attention: { pending_count: 2, needs_confirm_count: 0, failed_count: 0, items: [] },
  overdue: { items: [], total: 0 },
  active_projects: { items: [contextProject], total: 1 },
  paused_projects: { items: [], total: 0 },
  stalled_projects: { items: [], total: 0 },
  projects_without_next_action: { items: [], total: 0 },
  upcoming_7d: { days: [{ date: "2026-08-22", tasks: [], events: [], total: 0 }] },
  recently_completed: {
    items: [
      {
        kind: "task" as const,
        id: "44444444-4444-4444-8444-444444444444",
        title: "Water plants",
        completed_at: "2026-08-20T18:00:00.000Z",
      },
    ],
    total: 1,
  },
};

function mockFetchWith(body: unknown, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  global.fetch = fetchMock;
  return fetchMock;
}

describe("reviews api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("POSTs /reviews with the parsed create body and parses the row", async () => {
    const input = { kind: "daily" as const, period_start: "2026-08-21", tz: "America/Chicago" };
    const fetchMock = mockFetchWith(reviewRow);

    const res = await createReview("http://localhost:3000", input);
    expect(res).toEqual(reviewRow);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/reviews");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual(input);
    expect((init.headers as Record<string, string>)["Content-Type"]).toBe("application/json");
  });

  it("serializes listReviews query params in wire order", async () => {
    const fetchMock = mockFetchWith(listResponse);

    const res = await listReviews("http://localhost:3000", { kind: "daily", limit: 10, offset: 5 });
    expect(res).toEqual(listResponse);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    // Key order follows ReviewListQuerySchema's field order (limit/offset
    // first from PaginationQuerySchema, then the extended kind).
    expect(url.toString()).toBe("http://localhost:3000/reviews?limit=10&offset=5&kind=daily");
  });

  it("applies ReviewListQuerySchema defaults into the list URL", async () => {
    const fetchMock = mockFetchWith({ items: [], limit: 50, offset: 0, total: 0 });

    await listReviews("http://localhost:3000", { limit: 50, offset: 0 });

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/reviews?limit=50&offset=0");
  });

  it("rejects a list envelope missing its total (schema parse at boundary)", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ items: [reviewRow] }), { status: 200 }));

    await expect(
      listReviews("http://localhost:3000", { limit: 50, offset: 0 }),
    ).rejects.toBeTruthy();
  });

  it("fetches /reviews/latest with an encoded kind param and parses the row", async () => {
    const fetchMock = mockFetchWith(reviewRow);

    const res = await getLatestReview("http://localhost:3000", "weekly");
    expect(res).toEqual(reviewRow);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/reviews/latest?kind=weekly");
  });

  it("throws ApiClientError 404 when no latest review exists", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    await expect(getLatestReview("http://localhost:3000", "daily")).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(404);
        expect((err as ApiClientError).code).toBe("not_found");
        return true;
      },
    );
  });

  it("GETs /reviews/:id and parses the row", async () => {
    const fetchMock = mockFetchWith(reviewRow);

    const res = await getReview("http://localhost:3000", reviewRow.id);
    expect(res).toEqual(reviewRow);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/reviews/${reviewRow.id}`);
  });

  it("throws ApiClientError 404 for an unknown review id", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "not_found" }), { status: 404 }));

    await expect(getReview("http://localhost:3000", reviewRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(404);
        return true;
      },
    );
  });

  it("PATCHes /reviews/:id with the parsed update body", async () => {
    const patch = {
      content: {
        version: 1 as const,
        kind: "daily" as const,
        checklist: { inbox: true },
        selected_priorities: [],
      },
    };
    const completed = { ...reviewRow, summary: "Wrapped up", status: "completed" };
    const fetchMock = mockFetchWith(completed);

    const res = await updateReview("http://localhost:3000", reviewRow.id, {
      ...patch,
      summary: "Wrapped up",
    });
    expect(res).toEqual(completed);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/reviews/${reviewRow.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      content: patch.content,
      summary: "Wrapped up",
    });
  });

  it.each([
    ["complete", completeReview],
    ["skip", skipReview],
  ] as const)("POSTs /reviews/:id/%s as a bodyless request", async (action, fn) => {
    const fetchMock = mockFetchWith({
      ...reviewRow,
      status: action === "complete" ? "completed" : "skipped",
    });

    await fn("http://localhost:3000", reviewRow.id);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/reviews/${reviewRow.id}/${action}`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    // Regression guard (Content-Type lesson): no body means no Content-Type.
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("surfaces a 409 complete-on-skipped transition as ApiClientError", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_status_transition", status: "skipped" }), {
        status: 409,
      }),
    );

    await expect(completeReview("http://localhost:3000", reviewRow.id)).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        const apiError = err as ApiClientError;
        expect(apiError.status).toBe(409);
        expect(apiError.code).toBe("invalid_status_transition");
        return true;
      },
    );
  });

  it("builds /reviews/context/daily with an encoded tz query param", async () => {
    const fetchMock = mockFetchWith(dailyContext);

    const res = await getDailyReviewContext("http://localhost:3000", "Pacific/Auckland");
    expect(res).toEqual(dailyContext);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://localhost:3000/reviews/context/daily?tz=Pacific%2FAuckland",
    );
  });

  it("builds /reviews/context/weekly with an encoded tz query param", async () => {
    const fetchMock = mockFetchWith(weeklyContext);

    const res = await getWeeklyReviewContext("http://localhost:3000", "Pacific/Auckland");
    expect(res).toEqual(weeklyContext);

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(
      "http://localhost:3000/reviews/context/weekly?tz=Pacific%2FAuckland",
    );
  });

  it("rejects a malformed daily context payload (schema parse at boundary)", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ...dailyContext, overdue: { items: [taskItem], total: 0 } }), {
        status: 200,
      }),
    );

    // Section total smaller than emitted items must fail boundedItemsSectionSchema.
    await expect(getDailyReviewContext("http://localhost:3000", "UTC")).rejects.toBeTruthy();
  });
});
