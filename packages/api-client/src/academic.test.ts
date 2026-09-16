import { afterEach, describe, expect, it, vi } from "vitest";
import { getAcademicCourse, getAcademicToday, listAcademicCourses } from "./academic.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = f;
  return f;
}

const CANVAS = "https://uta.instructure.com";

const COURSE_SUMMARY = {
  id: "22222222-2222-4222-8222-222222222222",
  source: "canvas",
  external_id: "98765",
  connection_id: "11111111-1111-4111-8111-111111111111",
  name: "Advanced Web Development",
  code: "INSY-4315",
  term: { name: "Fall 2026", starts_at: null, ends_at: null },
  status: "active",
  html_url: `${CANVAS}/courses/98765`,
  source_base_url: CANVAS,
  archived_at: null,
  created_at: "2026-09-16T12:00:00Z",
  updated_at: "2026-09-16T12:00:00Z",
  open_assignment_count: 1,
  overdue_assignment_count: 0,
  next_due_at: "2026-09-22T04:59:00Z",
};

const ASSIGNMENT = {
  id: "33333333-3333-4333-8333-333333333333",
  source: "canvas",
  external_id: "555111",
  course_id: COURSE_SUMMARY.id,
  course_name: COURSE_SUMMARY.name,
  course_code: COURSE_SUMMARY.code,
  title: "Homework 3",
  due_at: "2026-09-22T04:59:00Z",
  points_possible: 100,
  submission: { status: "unsubmitted", missing: false, late: false, submitted_at: null },
  grade: { status: "not_graded", score: null, grade: null, percentage: null },
  open: true,
  published: true,
  html_url: `${CANVAS}/courses/98765/assignments/555111`,
  source_base_url: CANVAS,
  archived_at: null,
};

const EMPTY = { items: [], total: 0 };

const TODAY = {
  generated_at: "2026-09-16T13:00:00Z",
  effective_now: "2026-09-16T13:00:00Z",
  tz: "America/Chicago",
  local_date: "2026-09-16",
  configured: true,
  summary: {
    overdue_total: 0,
    due_today_total: 0,
    due_this_week_total: 1,
    missing_total: 0,
    unread_announcements_total: 0,
  },
  overdue: EMPTY,
  due_today: EMPTY,
  due_this_week: { items: [ASSIGNMENT], total: 1 },
  announcements: EMPTY,
  events: EMPTY,
};

describe("getAcademicToday", () => {
  it("GETs /academic/today with the tz and parses the response", async () => {
    const f = stub(TODAY);
    const result = await getAcademicToday(BASE, "America/Chicago");
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/academic/today?tz=America%2FChicago`);
    expect(result.due_this_week.items[0]?.title).toBe("Homework 3");
  });

  it("rejects a response whose section total is smaller than its items", async () => {
    stub({ ...TODAY, due_this_week: { items: [ASSIGNMENT], total: 0 } });
    await expect(getAcademicToday(BASE, "America/Chicago")).rejects.toThrow();
  });
});

describe("listAcademicCourses", () => {
  it("omits include_archived by default and sends it when asked", async () => {
    const f = stub({ configured: true, items: [COURSE_SUMMARY] });
    const result = await listAcademicCourses(BASE);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/academic/courses`);
    expect(result.items[0]?.code).toBe("INSY-4315");

    const g = stub({ configured: true, items: [] });
    await listAcademicCourses(BASE, { includeArchived: true });
    expect(String(g.mock.calls[0]![0])).toBe(`${BASE}/academic/courses?include_archived=true`);
  });
});

describe("getAcademicCourse", () => {
  it("GETs /academic/courses/:id with the id encoded", async () => {
    const f = stub({
      course: COURSE_SUMMARY,
      assignments: [ASSIGNMENT],
      announcements: [],
      events: [],
    });
    const result = await getAcademicCourse(BASE, COURSE_SUMMARY.id);
    expect(String(f.mock.calls[0]![0])).toBe(`${BASE}/academic/courses/${COURSE_SUMMARY.id}`);
    expect(result.assignments).toHaveLength(1);
  });

  it("surfaces a 404 as a rejection", async () => {
    stub({ error: "not_found" }, 404);
    await expect(getAcademicCourse(BASE, COURSE_SUMMARY.id)).rejects.toThrow();
  });
});
