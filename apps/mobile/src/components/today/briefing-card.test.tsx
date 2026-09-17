// Render-level tests for <BriefingCard /> (Checkpoint 10.6, ADR-075 §4 /
// ADR-076 §4; memory from Checkpoint 10.7, ADR-077 §5). Tree-walk idiom; the
// three query hooks and the two memory hooks are mocked.
//
// What these pin: nothing while today is loading or errored; the headline
// and the section overlines; a source chip on every line; a "Focus now"
// line opening the assignment sheet (academic) or navigating (task); a
// failed academic/health source contributing nothing; the children (the
// screen's Ask chip) rendered inside the block; memory in the settle set
// (loading ⇒ nothing yet; errored ⇒ absent), the working-hours line with its
// "Memory" pill and no press target, and nothing when the switch is off.

import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  getAssignmentSheet,
  resetAssignmentSheetForTests,
} from "@/components/academic/assignment-sheet";
import {
  academicToday,
  assignment,
  priorityItem,
} from "@/components/academic/fixtures.test-support";
import { useAcademicToday } from "@/queries/academic";
import { useHealthSummary } from "@/queries/health";
import { useMemoriesForIntelligence, useMemorySettings } from "@/queries/memory";
import { useToday } from "@/queries/today";
import { BriefingCard } from "./briefing-card";

vi.mock("@/queries/today", () => ({ useToday: vi.fn() }));
vi.mock("@/queries/academic", () => ({ useAcademicToday: vi.fn() }));
vi.mock("@/queries/health", () => ({ useHealthSummary: vi.fn() }));
vi.mock("@/queries/memory", () => ({
  useMemoriesForIntelligence: vi.fn(),
  useMemorySettings: vi.fn(),
}));

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

const NOW_MS = new Date("2026-09-16T19:00:00Z").getTime();

function todayFixture(overrides: Record<string, unknown> = {}) {
  return {
    generated_at: "2026-09-16T19:00:00.000Z",
    effective_now: "2026-09-16T19:00:00.000Z",
    tz: "America/Chicago",
    local_date: "2026-09-16",
    summary: {
      overdue_total: 1,
      due_today_total: 0,
      inbox_attention_total: 0,
      active_project_count: 0,
    },
    overdue: {
      items: [
        {
          id: "o1",
          title: "Overdue task",
          due_at: "2026-09-15T00:00:00Z",
          remind_at: null,
          timezone: "America/Chicago",
          priority: null,
          project_id: null,
          project_name: null,
          rrule: null,
          parent_task_id: null,
          occurrence_id: null,
          snoozed_until: null,
        },
      ],
      total: 1,
    },
    due_today: { items: [], total: 0 },
    events_today: {
      items: [
        {
          id: "e1",
          title: "Standup",
          starts_at: "2026-09-16T21:00:00Z",
          ends_at: "2026-09-16T21:30:00Z",
          all_day: false,
          start_date: null,
          end_date: null,
          location: null,
          project_id: null,
          rrule: null,
          parent_event_id: null,
          occurs_at: null,
        },
      ],
    },
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
    data: academicToday({
      priorities: {
        items: [priorityItem({ assignment: assignment({ id: "a1", title: "Milestone" }) })],
        total: 1,
      },
    }),
    ...overrides,
  } as never);
}

// Health SETTLED with an error by default: the card waits for both optional
// sources to settle (data or error) before its first render (10.6 review,
// finding 5), and a failed source contributes nothing -- the shape the
// original "health not loaded" fixture meant.
function mockHealth(overrides: Record<string, unknown> = {}) {
  vi.mocked(useHealthSummary).mockReturnValue({
    isLoading: false,
    isError: true,
    data: undefined,
    ...overrides,
  } as never);
}

function workingHoursMemory() {
  return {
    id: "aaaaaaaa-0000-4000-8000-000000000001",
    kind: "preference",
    statement: "Working hours 9-17",
    note: null,
    source: "user",
    suggestion_id: null,
    project_id: null,
    canvas_course_id: null,
    created_at: "2026-09-16T00:00:00.000Z",
    updated_at: "2026-09-16T00:00:00.000Z",
    project: null,
    course: null,
  };
}

/** Memory SETTLED and empty by default, so every 10.6 pin holds with no memory at all. */
function mockMemories(overrides: Record<string, unknown> = {}) {
  vi.mocked(useMemoriesForIntelligence).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { items: [], limit: 200, offset: 0, total: 0 },
    ...overrides,
  } as never);
}

function mockMemorySettings(overrides: Record<string, unknown> = {}) {
  vi.mocked(useMemorySettings).mockReturnValue({
    isLoading: false,
    isError: false,
    data: { enabled: true, memory_count: 0 },
    ...overrides,
  } as never);
}

function render(children?: unknown): unknown {
  return deepRender(BriefingCard({ children: children as never }));
}

beforeEach(() => {
  vi.clearAllMocks();
  resetAssignmentSheetForTests();
  mockToday();
  mockAcademic();
  mockHealth();
  mockMemories();
  mockMemorySettings();
});

describe("renders nothing", () => {
  it("while today is loading", () => {
    mockToday({ isLoading: true, data: undefined });
    expect(BriefingCard({})).toBeNull();
  });

  it("on a today error", () => {
    mockToday({ isError: true, data: undefined });
    expect(BriefingCard({})).toBeNull();
  });

  it("while an optional source is still loading, so the gradient block never grows mid-view (10.6 review, finding 5)", () => {
    mockAcademic({ isLoading: true, isError: false, data: undefined });
    expect(BriefingCard({})).toBeNull();
    mockAcademic();
    mockHealth({ isLoading: true, isError: false, data: undefined });
    expect(BriefingCard({})).toBeNull();
  });

  it("while a memory query is still loading -- memory joins the settle set (ADR-077 §5)", () => {
    mockMemories({ isLoading: true, isError: false, data: undefined });
    expect(BriefingCard({})).toBeNull();
    mockMemories();
    mockMemorySettings({ isLoading: true, isError: false, data: undefined });
    expect(BriefingCard({})).toBeNull();
  });
});

describe("the briefing", () => {
  it("leads with the headline and the section overlines, every line carrying a source chip", () => {
    const tree = render();
    const text = getTextContent(tree);
    expect(text).toContain("Briefing");
    expect(text).toContain("1 overdue, 1 event.");
    expect(text).toContain("Schedule");
    expect(text).toContain("1 event today");
    expect(text).toContain("Focus now");
    expect(text).toContain("Overdue task — Past its due time");
    expect(text).toContain("Milestone — Due within 24 hours");
    // Source chips: the calendar line, the task line, the Canvas line.
    expect(text).toContain("Calendar");
    expect(text).toContain("Task");
    expect(text).toContain("Canvas assignment");
    // No health section: the summary has not loaded.
    expect(text).not.toContain("Health");
  });

  it("opens the assignment sheet from a Canvas focus line, with the row's explanation", () => {
    const tree = render();
    const line = findAll(tree, (n) => n.type === Pressable).find((p) =>
      String(p.props.accessibilityLabel).startsWith("Milestone — "),
    );
    expect(line).toBeDefined();
    expect(line.props.accessibilityRole).toBe("button");
    line.props.onPress();
    const sheet = getAssignmentSheet();
    expect(sheet.visible).toBe(true);
    expect(sheet.record?.assignment.id).toBe("a1");
    expect(sheet.record?.explanation?.equation).toBe("300 Canvas priority = 300");
  });

  it("makes a task focus line a button and a count line inert", () => {
    const tree = render();
    const pressables = findAll(tree, (n) => n.type === Pressable);
    expect(
      pressables.some((p) => String(p.props.accessibilityLabel).startsWith("Overdue task — ")),
    ).toBe(true);
    expect(
      pressables.some((p) => String(p.props.accessibilityLabel).startsWith("1 event today")),
    ).toBe(false);
  });

  it("drops the academic contribution when that source errored, and adds nothing for an unconfigured one", () => {
    mockAcademic({ isError: true, data: undefined });
    expect(getTextContent(render())).not.toContain("Milestone");
    mockAcademic({ data: academicToday({ configured: false }) });
    expect(getTextContent(render())).not.toContain("Academics");
  });

  it("renders its children -- the screen's Ask chip -- inside the block", () => {
    const tree = render(<View testID="today-ask-chip" />);
    expect(findAll(tree, (n) => n.props?.testID === "today-ask-chip")).toHaveLength(1);
  });
});

describe("memory (Checkpoint 10.7, ADR-077 §5/§7)", () => {
  const MEMORY_LIST = { items: [workingHoursMemory()], limit: 200, offset: 0, total: 1 };

  it("adds the working-hours line with a Memory pill, inert (no ref, no press target), and bounds the free time", () => {
    mockMemories({ data: MEMORY_LIST });
    const tree = render();
    const text = getTextContent(tree);
    expect(text).toContain("Working hours 09:00–17:00 — from your preferences");
    expect(text).toContain("Memory");
    // The line is a plain View, never a Pressable: briefingLineTarget is null without a ref.
    const pressables = findAll(tree, (n) => n.type === Pressable);
    expect(
      pressables.some((p) => String(p.props.accessibilityLabel).startsWith("Working hours")),
    ).toBe(false);
    const inert = findAll(tree, (n) =>
      String(n.props?.accessibilityLabel ?? "").startsWith("Working hours 09:00–17:00"),
    );
    expect(inert).toHaveLength(1);
    expect(inert[0].props.accessibilityLabel).toBe(
      "Working hours 09:00–17:00 — from your preferences. Source: Memory",
    );
    // Free time is bounded by the stated 17:00, not the 22:00 default: the
    // fixture's standup is 16:00–16:30 CDT, so the afternoon block ends at
    // 16:00 and the 30-minute tail to 17:00 is below freeBlocks' 60-minute
    // floor (with the default bound it would read "16:30–22:00").
    expect(text).toContain("Free 14:00–16:00 (2h 00m)");
    expect(text).not.toContain("–22:00");
  });

  it("renders the 10.6 briefing when the switch is off, even with a working-hours memory", () => {
    mockMemories({ data: MEMORY_LIST });
    mockMemorySettings({ data: { enabled: false, memory_count: 1 } });
    const text = getTextContent(render());
    expect(text).not.toContain("Working hours");
    expect(text).not.toContain("Memory");
    expect(text).toContain("–22:00");
  });

  it("treats memory as absent when either memory query errored, and still renders", () => {
    mockMemories({ isError: true, data: undefined });
    let text = getTextContent(render());
    expect(text).toContain("Briefing");
    expect(text).not.toContain("Working hours");
    mockMemories({ data: MEMORY_LIST });
    mockMemorySettings({ isError: true, data: undefined });
    text = getTextContent(render());
    expect(text).toContain("Briefing");
    expect(text).not.toContain("Working hours");
  });
});
