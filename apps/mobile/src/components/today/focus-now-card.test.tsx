// Render-level tests for <FocusNowCard /> (Checkpoint 10.4, ADR-072;
// explanations and quick actions from Checkpoint 10.6, ADR-075/076).
//
// Copies academic-today-card.test.tsx's technique exactly, for the same
// reason recorded there: this app has no render library, so the component
// is called directly and the plain React element tree it returns is walked.
// Both source hooks (`useToday`, `useAcademicToday`) and the task-action
// hook are mocked below, `useRouter` resolves to src/__mocks__/expo-router.ts,
// and the two leaves that need React hooks (the completion glyph, the task
// sheet host) are listed as host types per the leaf-wrapper rule.
//
// What these pin:
//   1. the card's whole posture -- NOTHING while either source is loading,
//      on either error, or once merged there is nothing to show;
//   2. the merged order (score desc);
//   3. a reason chip rendered per row;
//   4. a task row: completion circle + Why button + swipe actions, the row
//      itself navigating; an academic row opening the in-app assignment
//      sheet (never a link -- the Canvas link lives in the sheet);
//   5. the one task-sheet host mounted by the card.

import { Platform, Pressable, Text, View } from "react-native";
import ReanimatedSwipeable from "react-native-gesture-handler/ReanimatedSwipeable";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssignmentSheet,
  resetAssignmentSheetForTests,
} from "@/components/academic/assignment-sheet";
import {
  assignment,
  priorityItem,
  SOURCE_BASE_URL,
} from "@/components/academic/fixtures.test-support";
import { CompletionGlyph } from "@/components/ui";
import { useAcademicToday } from "@/queries/academic";
import { useToday } from "@/queries/today";
import { FocusNowCard } from "./focus-now-card";
import {
  FocusNowTaskSheetHost,
  getFocusNowTaskSheet,
  resetFocusNowTaskSheetForTests,
} from "./focus-now-task-sheet";
import { useTodayTaskActions } from "./use-today-task-actions";

vi.mock("@/queries/today", () => ({ useToday: vi.fn() }));
vi.mock("@/queries/academic", () => ({ useAcademicToday: vi.fn() }));
// The hook module reaches the API client (expo at import), so it is mocked
// whole; the pure decisions it shares with the rows live in
// today-task-actions-state.ts and stay real.
vi.mock("./use-today-task-actions", () => ({ useTodayTaskActions: vi.fn() }));

// The swipeable (the gesture-handler mock) is kept as a host so its
// `renderLeftActions`/`renderRightActions` props stay on the element.
const LEAF_TYPES = new Set<unknown>([CompletionGlyph, FocusNowTaskSheetHost, ReanimatedSwipeable]);
const HOST_TYPES = new Set<unknown>([View, Text, Pressable, ...LEAF_TYPES]);

/** Vitest resolves react-native to the web build, where a swipe never renders; the panels need a device. */
function onAndroid<T>(fn: () => T): T {
  const platform = Platform as unknown as { OS: string };
  const previous = platform.OS;
  platform.OS = "android";
  try {
    return fn();
  } finally {
    platform.OS = previous;
  }
}

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

const complete = vi.fn();
const snooze = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  resetAssignmentSheetForTests();
  resetFocusNowTaskSheetForTests();
  vi.mocked(useTodayTaskActions).mockReturnValue({ complete, snooze, pending: false });
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
    // Checkpoint 10.6 (ADR-076 §2): the row wraps its own completion circle
    // and Why button, so it is `containsControl` -- no button role of its own
    // (no <button> inside a <button> on web); the tap still navigates.
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(typeof row.props.onPress).toBe("function");
  });
});

describe("a task row's quick actions (ADR-076 §2/§4)", () => {
  function overdueTask(overrides: Record<string, unknown> = {}) {
    mockToday({
      data: todayFixture({
        overdue: {
          items: [
            taskItem({
              id: "o1",
              title: "Overdue task",
              due_at: "2026-09-15T00:00:00Z",
              ...overrides,
            }),
          ],
          total: 1,
        },
      }),
    });
  }

  it("carries a completion circle that runs the shared completion action", () => {
    overdueTask();
    const circle = findPressables(render()).find(
      (p) => p.props.accessibilityLabel === "Complete Overdue task",
    );
    expect(circle).toBeDefined();
    expect(circle.props.accessibilityRole).toBe("button");
    circle.props.onPress({ stopPropagation: () => {} });
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete.mock.calls[0]![0]).toMatchObject({ id: "o1" });
  });

  it("opens the task sheet from the Why button and from a long press, never a navigation", () => {
    overdueTask();
    const tree = render();
    const why = findPressables(tree).find((p) => p.props.testID === "focus-now-why-o1");
    expect(why).toBeDefined();
    expect(why.props.accessibilityLabel).toBe("Why is Overdue task here?");
    why.props.onPress();
    expect(getFocusNowTaskSheet()).toMatchObject({
      visible: true,
      error: null,
      row: { id: "o1", kind: "task" },
    });
    resetFocusNowTaskSheetForTests();
    const row = findPressables(tree).find(
      (p) =>
        String(p.props.accessibilityLabel).startsWith("Overdue task, ") &&
        typeof p.props.onLongPress === "function",
    );
    expect(row).toBeDefined();
    // The row navigates on tap and is not a button itself (it contains two).
    expect(row.props.accessibilityRole).toBeUndefined();
    expect(typeof row.props.onPress).toBe("function");
    row.props.onLongPress();
    expect(getFocusNowTaskSheet().visible).toBe(true);
  });

  it("offers Done on a right swipe and Snooze on a left swipe for a snoozable row", () => {
    onAndroid(() => {
      overdueTask();
      const swipeable = findAll(render(), (n) => n.type === ReanimatedSwipeable);
      expect(swipeable).toHaveLength(1);
      const [node] = swipeable;
      expect(typeof node.props.renderLeftActions).toBe("function");
      const rightPanel = deepRender(node.props.renderRightActions(0, 0, { close: () => {} }));
      const done = findPressables(rightPanel).find((p) => p.props.accessibilityLabel === "Done");
      expect(done).toBeDefined();
      done.props.onPress();
      expect(complete).toHaveBeenCalledTimes(1);
      const leftPanel = deepRender(node.props.renderLeftActions(0, 0, { close: () => {} }));
      const snoozeAction = findPressables(leftPanel).find(
        (p) => p.props.accessibilityLabel === "Snooze",
      );
      expect(snoozeAction).toBeDefined();
      snoozeAction.props.onPress();
      expect(getFocusNowTaskSheet().visible).toBe(true);
    });
  });

  it("offers no Snooze swipe on a recurring parent row (no occurrence, an rrule)", () => {
    onAndroid(() => {
      overdueTask({ rrule: "FREQ=DAILY", occurrence_id: null, parent_task_id: null });
      const [node] = findAll(render(), (n) => n.type === ReanimatedSwipeable);
      expect(node.props.renderLeftActions).toBeUndefined();
      expect(typeof node.props.renderRightActions).toBe("function");
    });
  });

  it("on web renders the row alone -- every swipe action stays reachable from the row's own controls", () => {
    overdueTask();
    const tree = render();
    expect(findAll(tree, (n) => n.type === ReanimatedSwipeable)).toHaveLength(0);
    expect(
      findPressables(tree).some((p) => p.props.accessibilityLabel === "Complete Overdue task"),
    ).toBe(true);
    expect(findPressables(tree).some((p) => p.props.testID === "focus-now-why-o1")).toBe(true);
  });

  it("re-opens the sheet with the failure line when the circle's completion fails", () => {
    overdueTask();
    const circle = findPressables(render()).find(
      (p) => p.props.accessibilityLabel === "Complete Overdue task",
    );
    circle.props.onPress({ stopPropagation: () => {} });
    const callbacks = complete.mock.calls[0]![1];
    callbacks.onError("Couldn't complete.");
    expect(getFocusNowTaskSheet()).toMatchObject({ visible: true, error: "Couldn't complete." });
  });

  it("mounts the task sheet host exactly once", () => {
    overdueTask();
    const hosts = findAll(render(), (n) => n.type === FocusNowTaskSheetHost);
    expect(hosts).toHaveLength(1);
  });
});

describe("an academic row (ADR-076 §3)", () => {
  it("is a button that opens the in-app assignment sheet with its explanation -- not a link", () => {
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
    expect(row.props.accessibilityRole).toBe("button");
    row.props.onPress();
    const sheet = getAssignmentSheet();
    expect(sheet.visible).toBe(true);
    expect(sheet.record?.assignment.id).toBe("a1");
    expect(sheet.record?.explanation?.explanations.map((e) => e.reason)).toEqual([
      "due_within_24h",
      "no_submission",
    ]);
  });

  it("never renders html_url as text and carries no link role on the card at all", () => {
    mockAcademic({
      data: academicFixture({
        priorities: {
          items: [
            priorityItem({
              assignment: assignment({ id: "a1", html_url: "https://evil.example.com/x" }),
            }),
          ],
          total: 1,
        },
      }),
    });
    const tree = render();
    expect(getTextContent(tree)).not.toContain("http");
    expect(findPressables(tree).some((p) => p.props.accessibilityRole === "link")).toBe(false);
  });
});
