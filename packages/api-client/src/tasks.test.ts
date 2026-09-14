import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "./client.js";
import { createTask, getTask, listTasks, reopenTask, updateTask } from "./tasks.js";

const taskRow = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Submit report",
  body: null,
  status: "active" as const,
  due_at: "2026-08-21T15:00:00.000Z",
  remind_at: null,
  timezone: "America/Chicago",
  priority: 1,
  project_id: null,
  completed_at: null,
  rrule: null,
  recurrence_anchor: null,
  recurrence_timezone: null,
  recurrence_until: null,
  recurrence_count: null,
  recurrence_exdates: null,
  archived_at: null,
  created_at: "2026-08-16T00:00:00.000Z",
  updated_at: "2026-08-16T00:00:00.000Z",
};

describe("tasks api client", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("lists tasks with query params", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ items: [taskRow], limit: 20, offset: 0, total: 1 }), {
        status: 200,
      }),
    );
    global.fetch = fetchMock;

    const res = await listTasks("http://localhost:3000", { status: ["active", "inbox"] });
    expect(res.items).toEqual([taskRow]);
    const [url] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/tasks?status=active%2Cinbox");
  });

  it("gets single task", async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(taskRow), { status: 200 }));
    const res = await getTask("http://localhost:3000", taskRow.id);
    expect(res).toEqual(taskRow);
  });

  it("creates recurring task with recurrence fields", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(taskRow), { status: 201 }));
    global.fetch = fetchMock;

    await createTask("http://localhost:3000", {
      title: "Daily Standup Task",
      timezone: "America/Chicago",
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrence_anchor: "due_date",
      recurrence_timezone: "America/Chicago",
      recurrence_count: 5,
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://localhost:3000/tasks");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toMatchObject({
      title: "Daily Standup Task",
      rrule: "FREQ=DAILY;INTERVAL=1",
      recurrence_anchor: "due_date",
      recurrence_timezone: "America/Chicago",
      recurrence_count: 5,
    });
  });

  it("updates task with completion-anchored recurrence", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(taskRow), { status: 200 }));
    global.fetch = fetchMock;

    await updateTask("http://localhost:3000", taskRow.id, {
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrence_anchor: "completion_date",
      recurrence_timezone: "America/Chicago",
    });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/tasks/${taskRow.id}`);
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body as string)).toEqual({
      rrule: "FREQ=WEEKLY;INTERVAL=1",
      recurrence_anchor: "completion_date",
      recurrence_timezone: "America/Chicago",
    });
  });

  // Checkpoint 9.3: done|dropped -> active.
  it("POSTs /tasks/:id/reopen as a bodyless request", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify(taskRow), { status: 200 }));
    global.fetch = fetchMock;

    const res = await reopenTask("http://localhost:3000", taskRow.id);
    expect(res).toEqual(taskRow);

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`http://localhost:3000/tasks/${taskRow.id}/reopen`);
    expect(init.method).toBe("POST");
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("surfaces a 409 task_not_reopenable as ApiClientError carrying the current status", async () => {
    global.fetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "task_not_reopenable", status: "active" }), {
        status: 409,
      }),
    );
    await expect(reopenTask("http://localhost:3000", taskRow.id)).rejects.toMatchObject({
      status: 409,
      body: { error: "task_not_reopenable", status: "active" },
    });
    await expect(reopenTask("http://localhost:3000", taskRow.id)).rejects.toBeInstanceOf(
      ApiClientError,
    );
  });
});
