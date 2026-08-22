import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { getToday } from "./today.js";

const todayResponse = {
  generated_at: "2026-08-21T09:00:00.000Z",
  effective_now: "2026-08-21T09:00:00.000Z",
  tz: "Pacific/Auckland",
  local_date: "2026-08-21",
  summary: {
    overdue_total: 1,
    due_today_total: 1,
    inbox_attention_total: 1,
    active_project_count: 1,
  },
  overdue: {
    items: [
      {
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
      },
    ],
    total: 1,
  },
  due_today: { items: [], total: 0 },
  events_today: { items: [] },
  upcoming: { days: [] },
  inbox: {
    pending_count: 0,
    needs_confirm_count: 1,
    failed_count: 0,
    items: [
      {
        id: "22222222-2222-4222-8222-222222222222",
        raw_text: "call the dentist",
        status: "needs_confirm",
        captured_at: "2026-08-21T08:00:00.000Z",
        entity_type: "task",
      },
    ],
  },
  projects: { active_count: 0, items: [] },
  reviews: {
    daily: { period_start: "2026-08-21", review_id: null, status: null, last_completed_at: null },
    weekly: { period_start: "2026-08-21", review_id: null, status: null, last_completed_at: null },
  },
  brief: null,
};

describe("today api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("builds /today with an encoded tz query param", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(todayResponse), { status: 200 }));
    global.fetch = fetchMock;

    await getToday("http://localhost:3000", "Pacific/Auckland");

    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/today?tz=Pacific%2FAuckland");
  });

  it("parses a successful response through TodayResponseSchema", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(todayResponse), { status: 200 }));

    const res = await getToday("http://localhost:3000", "Pacific/Auckland");
    expect(res).toEqual(todayResponse);
  });

  it("throws ApiClientError on a non-2xx response", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "validation_failed" }), {
        status: 400,
      }),
    );

    await expect(getToday("http://localhost:3000", "Mars/Olympus")).rejects.toSatisfy(
      (err: unknown) => {
        expect(err).toBeInstanceOf(ApiClientError);
        expect((err as ApiClientError).status).toBe(400);
        return true;
      },
    );
  });
});
