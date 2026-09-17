// Render-level tests for <FocusNowCard /> (Checkpoint 10.4, ADR-072).
//
// Copies academic-today-card.test.tsx's technique exactly, for the same
// reason recorded there: this app has no render library, so the component
// is called directly and the plain React element tree it returns is walked.
// Both source hooks (`useToday`, `useAcademicToday`) are mocked below, and
// `useRouter` resolves to src/__mocks__/expo-router.ts.
//
// What these pin:
//   1. the card's whole posture -- NOTHING while either source is loading,
//      on either error, or once merged there is nothing to show;
//   2. the merged order (score desc);
//   3. a reason chip rendered per row;
//   4. the academic row's same-origin gate (Checkpoint 10.1/10.2's rule),
//      reused unmodified through SourceLink.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignment,
  priorityItem,
  SOURCE_BASE_URL,
} from "@/components/academic/fixtures.test-support";
import { useAcademicToday } from "@/queries/academic";
import { useToday } from "@/queries/today";
import { FocusNowCard } from "./focus-now-card";

vi.mock("@/queries/today", () => ({ useToday: vi.fn() }));
vi.mock("@/queries/academic", () => ({ useAcademicToday: vi.fn() }));

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;

  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;

  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    const rendered = (el.type as (props: unknown) => unknown)(el.props ?? {});
    return deepRender(rendered);
  }

  if (el.props && "children" in el.props) {
    return { ...el, props: { ...el.props, children: deepRender(el.props.children) } };
  }
  return el;
}

function findAll(node: unknown, predicate: (n: any) => boolean, acc: any[] = []): any[] {
  if (!node) return acc;
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, acc);
    return acc;
  }
  if (typeof node !== "object") return acc;
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (predicate(el)) acc.push(el);
  if (el.props?.children !== undefined) {
    const children = Array.isArray(el.props.children) ? el.props.children : [el.props.children];
    for (const child of children) findAll(child, predicate, acc);
  }
  return acc;
}

function getTextContent(node: unknown): string {
  if (node === null || node === undefined) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  const el = node as { props?: { children?: unknown } };
  if (el.props?.children !== undefined) return getTextContent(el.props.children);
  return "";
}

function findPressables(node: unknown): any[] {
  return findAll(node, (n) => n.type === Pressable);
}

function render(): unknown {
  return deepRender(FocusNowCard());
}

const NOW_MS = new Date("2026-09-16T19:00:00Z").getTime(); // 2026-09-16 14:00 CDT

function todayFixture(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    events_today: { items: [] },
    upcoming: { days: [] },
    inbox: { pending_count: 0, needs_confirm_count: 0, failed_count: 0, items: [] },
    projects: { active_count: 0, items: [] },
    reviews: {
      daily: { period_start: "2026-09-16", review_id: null, status: null, last_completed_at: null },
      weekly: {
        period_start: "2026-09-16",
        review_id: null,
        status: null,
        last_completed_at: null,
      },
    },
    brief: null,
    ...overrides,
  };
}

function academicFixture(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    configured: true,
    summary: {
      overdue_total: 0,
      due_today_total: 0,
      due_this_week_total: 0,
      missing_total: 0,
      unread_announcements_total: 0,
    },
    overdue: { items: [], total: 0 },
    due_today: { items: [], total: 0 },
    due_this_week: { items: [], total: 0 },
    announcements: { items: [], total: 0 },
    events: { items: [], total: 0 },
    ...overrides,
  };
}

function taskItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    title: "Task",
    due_at: null,
    remind_at: null,
    timezone: "America/Chicago",
    priority: null,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    occurrence_id: null,
    snoozed_until: null,
    ...overrides,
  };
}

function mockToday(overrides: Record<string, unknown> = {}) {
  vi.mocked(useToday).mockReturnValue({
    isLoading: false,
    isError: false,
    data: todayFixture(),
    dataUpdatedAt: NOW_MS,
    ...overrides,
  } as never);
}

function mockAcademic(overrides: Record<string, unknown> = {}) {
  vi.mocked(useAcademicToday).mockReturnValue({
    isLoading: false,
    isError: false,
    data: academicFixture(),
    ...overrides,
  } as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockToday();
  mockAcademic();
});

describe("renders nothing", () => {
  it("while today is loading", () => {
    mockToday({ isLoading: true, data: undefined });
    expect(FocusNowCard()).toBeNull();
  });

  it("on a today error", () => {
    mockToday({ isError: true, data: undefined });
    expect(FocusNowCard()).toBeNull();
  });

  it("while academic is loading", () => {
    mockAcademic({ isLoading: true, data: undefined });
    expect(FocusNowCard()).toBeNull();
  });

  it("on an academic error", () => {
    mockAcademic({ isError: true, data: undefined });
    expect(FocusNowCard()).toBeNull();
  });

  it("when neither source has any candidate", () => {
    expect(FocusNowCard()).toBeNull();
  });
});

describe("the merged list", () => {
  it("renders overdue above due-today above a lower-scored academic item, each with a reason chip", () => {
    mockToday({
      data: todayFixture({
        overdue: {
          items: [taskItem({ id: "o1", title: "Overdue task", due_at: "2026-09-15T00:00:00Z" })],
          total: 1,
        },
        due_today: {
          items: [taskItem({ id: "d1", title: "Due today task", due_at: "2026-09-16T20:00:00Z" })],
          total: 1,
        },
      }),
    });
    mockAcademic({
      data: academicFixture({
        priorities: {
          items: [
            priorityItem({
              assignment: assignment({ id: "a1", title: "Later assignment" }),
              urgency: "medium",
              score: 200,
              reasons: ["due_this_week"],
            }),
          ],
          total: 1,
        },
      }),
    });
    const tree = render();
    const text = getTextContent(tree);
    expect(text).toContain("Focus Now");
    const overdueAt = text.indexOf("Overdue task");
    const dueTodayAt = text.indexOf("Due today task");
    const academicAt = text.indexOf("Later assignment");
    expect(overdueAt).toBeGreaterThan(-1);
    expect(dueTodayAt).toBeGreaterThan(overdueAt);
    expect(academicAt).toBeGreaterThan(dueTodayAt);
    expect(text).toContain("Overdue");
    expect(text).toContain("Due <24h");
    expect(text).toContain("This week");
  });

  it("renders a task row as a pressable that carries the task's own accessibility label", () => {
    mockToday({
      data: todayFixture({
        overdue: {
          items: [taskItem({ id: "o1", title: "Overdue task", due_at: "2026-09-15T00:00:00Z" })],
          total: 1,
        },
      }),
    });
    const tree = render();
    const row = findPressables(tree).find((p) =>
      String(p.props.accessibilityLabel).startsWith("Overdue task"),
    );
    expect(row).toBeDefined();
    expect(row.props.accessibilityRole).toBe("button");
    expect(typeof row.props.onPress).toBe("function");
  });
});

describe("the academic row's same-origin gate (reused from source-link.tsx)", () => {
  it("is a link with a handler on the connection's own origin", () => {
    mockAcademic({
      data: academicFixture({
        priorities: {
          items: [
            priorityItem({
              assignment: assignment({
                id: "a1",
                title: "Same-origin assignment",
                html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1`,
              }),
            }),
          ],
          total: 1,
        },
      }),
    });
    const tree = render();
    const row = findPressables(tree).find((p) =>
      String(p.props.accessibilityLabel).startsWith("Same-origin assignment"),
    );
    expect(row).toBeDefined();
    expect(row.props.accessibilityRole).toBe("link");
    expect(typeof row.props.onPress).toBe("function");
  });

  it("is inert -- no role, no handler -- on any other origin", () => {
    mockAcademic({
      data: academicFixture({
        priorities: {
          items: [
            priorityItem({
              assignment: assignment({
                id: "a1",
                title: "Cross-origin assignment",
                html_url: "https://evil.example.com/x",
              }),
            }),
          ],
          total: 1,
        },
      }),
    });
    const tree = render();
    const row = findPressables(tree).find((p) =>
      String(p.props.accessibilityLabel).startsWith("Cross-origin assignment"),
    );
    expect(row).toBeDefined();
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(row.props.onPress).toBeUndefined();
  });
});
