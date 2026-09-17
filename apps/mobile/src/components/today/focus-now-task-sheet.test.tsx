// The Focus Now task sheet (Checkpoint 10.6, ADR-075 §1 / ADR-076 §3): the
// store the rows write to, and the hookless content the host draws --
// explanation, quick actions, snooze targets, the inline failure line, and
// the linked assignment (with its gated Canvas row) on a merged row.
// Tree-walk idiom; the host (a React hook) is not rendered here.

import type { TodayTaskItem } from "@personal-os/schema";
import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  assignment,
  priorityItem,
  SOURCE_BASE_URL,
} from "@/components/academic/fixtures.test-support";
import type { FocusNowTaskRow } from "./focus-now-card-state";
import {
  FocusNowTaskSheetContent,
  closeFocusNowTaskSheet,
  getFocusNowTaskSheet,
  openFocusNowTaskSheet,
  resetFocusNowTaskSheetForTests,
  setFocusNowTaskSheetError,
} from "./focus-now-task-sheet";

// The host's hook module reaches the API client (expo at import); mocked
// whole -- the content under test never calls it.
vi.mock("./use-today-task-actions", () => ({ useTodayTaskActions: vi.fn() }));

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

function pressables(node: unknown): any[] {
  return findAll(node, (n) => n.type === Pressable);
}

function task(overrides: Partial<TodayTaskItem> = {}): TodayTaskItem {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Finish milestone",
    due_at: "2026-09-16T23:00:00Z",
    remind_at: null,
    timezone: "America/Chicago",
    priority: 1,
    project_id: null,
    project_name: null,
    rrule: null,
    parent_task_id: null,
    occurrence_id: null,
    snoozed_until: null,
    ...overrides,
  };
}

function row(overrides: Partial<FocusNowTaskRow> = {}): FocusNowTaskRow {
  const item = overrides.task ?? task();
  return {
    id: item.id,
    kind: "task",
    title: item.title,
    dueAt: item.due_at === null ? null : new Date(item.due_at),
    baseScore: 325,
    contextPoints: 0,
    score: 325,
    reasons: ["due_within_24h", "top_priority"],
    linkedAssignmentId: null,
    task: item,
    linkedPriorityItem: null,
    memoryMatch: null,
    ...overrides,
  };
}

function renderContent(props: Partial<Parameters<typeof FocusNowTaskSheetContent>[0]> = {}) {
  return deepRender(
    <FocusNowTaskSheetContent
      row={row()}
      error={null}
      pending={false}
      onOpenTask={() => {}}
      onComplete={() => {}}
      onSnooze={() => {}}
      {...props}
    />,
  );
}

beforeEach(() => {
  resetFocusNowTaskSheetForTests();
});

describe("the store", () => {
  it("opens with a row and no error, takes an error, closes keeping the row", () => {
    expect(getFocusNowTaskSheet()).toEqual({ visible: false, row: null, error: null });
    openFocusNowTaskSheet(row());
    expect(getFocusNowTaskSheet()).toMatchObject({ visible: true, error: null });
    setFocusNowTaskSheetError("Couldn't complete.");
    expect(getFocusNowTaskSheet().error).toBe("Couldn't complete.");
    closeFocusNowTaskSheet();
    expect(getFocusNowTaskSheet().visible).toBe(false);
    expect(getFocusNowTaskSheet().row?.id).toBe(task().id);
    openFocusNowTaskSheet(row(), "Failed from a swipe");
    expect(getFocusNowTaskSheet()).toMatchObject({ visible: true, error: "Failed from a swipe" });
  });
});

describe("FocusNowTaskSheetContent", () => {
  it("explains every reason with its source and the equation", () => {
    const text = getTextContent(renderContent());
    expect(text).toContain("Why it's here");
    expect(text).toContain("Due <24h");
    expect(text).toContain("Due within 24 hours");
    expect(text).toContain("P1");
    expect(text).toContain("Marked P1");
    expect(text).toContain("300 due <24h + 25 P1 = 325");
  });

  it("names the matched memory on a memory reason -- You said: … -- with a Memory source chip (ADR-077 §5)", () => {
    const text = getTextContent(
      renderContent({
        row: row({
          reasons: ["due_within_24h", "top_priority", "matches_preference"],
          contextPoints: 15,
          score: 340,
          memoryMatch: {
            matchesPreference: {
              id: "m1",
              kind: "preference",
              statement: "I work best in the evening",
              projectId: "44444444-4444-4444-8444-444444444444",
              canvasCourseId: null,
            },
            supportsGoal: null,
          },
        }),
      }),
    );
    expect(text).toContain("Matches your preference");
    expect(text).toContain("You said: I work best in the evening");
    expect(text).toContain("Memory");
    expect(text).toContain("300 due <24h + 25 P1 + 15 preference = 340");
  });

  it("offers Open task, Mark done and the three snooze targets, each wired to its callback", () => {
    const onOpenTask = vi.fn();
    const onComplete = vi.fn();
    const onSnooze = vi.fn();
    const tree = renderContent({ onOpenTask, onComplete, onSnooze });
    const byTestId = (id: string) => pressables(tree).find((p) => p.props.testID === id);
    byTestId("focus-now-sheet-open-task").props.onPress();
    expect(onOpenTask).toHaveBeenCalledTimes(1);
    byTestId("focus-now-sheet-complete").props.onPress();
    expect(onComplete).toHaveBeenCalledTimes(1);
    byTestId("focus-now-sheet-snooze-inOneHour").props.onPress();
    byTestId("focus-now-sheet-snooze-tomorrowMorning").props.onPress();
    byTestId("focus-now-sheet-snooze-nextWeekMorning").props.onPress();
    expect(onSnooze.mock.calls.map((c) => c[0])).toEqual([
      "inOneHour",
      "tomorrowMorning",
      "nextWeekMorning",
    ]);
    const text = getTextContent(tree);
    expect(text).toContain("In 1 hour");
    expect(text).toContain("Tomorrow 9am");
    expect(text).toContain("Next week");
  });

  it("offers no snooze on a recurring parent row (an rrule, no occurrence)", () => {
    const tree = renderContent({
      row: row({ task: task({ rrule: "FREQ=DAILY", occurrence_id: null }) }),
    });
    expect(
      pressables(tree).some((p) => String(p.props.testID).startsWith("focus-now-sheet-snooze")),
    ).toBe(false);
    expect(getTextContent(tree)).not.toContain("Snooze");
  });

  it("disables Mark done and the snooze rows while an action is pending", () => {
    const tree = renderContent({ pending: true });
    const done = pressables(tree).find((p) => p.props.testID === "focus-now-sheet-complete");
    expect(done.props.disabled).toBe(true);
    const snoozeRows = pressables(tree).filter((p) =>
      String(p.props.testID).startsWith("focus-now-sheet-snooze"),
    );
    expect(snoozeRows).toHaveLength(3);
    expect(snoozeRows.every((p) => p.props.disabled === true)).toBe(true);
  });

  it("shows a failure line inline, in the danger tone, never as a toast", () => {
    const tree = renderContent({ error: "Couldn't complete." });
    const text = getTextContent(tree);
    expect(text).toContain("Couldn't complete.");
    const line = findAll(
      tree,
      (n) => n.props?.accessibilityLabel === "Finish milestone: Couldn't complete.",
    );
    expect(line).toHaveLength(1);
  });

  it("on a merged row shows the linked assignment's facts and a gated Open in Canvas row", () => {
    const linked = priorityItem({
      assignment: assignment({
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        title: "Project milestone 2",
        html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001`,
      }),
    });
    const tree = renderContent({
      row: row({
        linkedAssignmentId: linked.assignment.id,
        linkedPriorityItem: linked,
        reasons: ["due_within_24h", "top_priority", "linked_assignment"],
        contextPoints: 25,
        score: 350,
      }),
    });
    const text = getTextContent(tree);
    expect(text).toContain("Linked assignment");
    expect(text).toContain("Project milestone 2");
    expect(text).toContain("INSY 4315");
    expect(text).toContain("You linked a task to this assignment");
    expect(text).toContain("Open in Canvas");
    expect(text).not.toContain("http");
    const link = pressables(tree).find((p) => p.props.accessibilityRole === "link");
    expect(link).toBeDefined();
    expect(typeof link.props.onPress).toBe("function");
  });

  it("on a merged row whose assignment is cross-origin offers no Canvas row at all", () => {
    const linked = priorityItem({
      assignment: assignment({ html_url: "https://evil.example.com/x" }),
    });
    const tree = renderContent({
      row: row({ linkedAssignmentId: linked.assignment.id, linkedPriorityItem: linked }),
    });
    expect(pressables(tree).some((p) => p.props.accessibilityRole === "link")).toBe(false);
    expect(getTextContent(tree)).not.toContain("Open in Canvas");
  });
});
