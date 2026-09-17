// Render-level tests for <TaskAssignmentPicker /> (Checkpoint 10.5).
//
// Same technique as academic-today-card.test.tsx: this app has no render
// library, so the hook-free component is called directly and the plain
// element tree it returns is walked.

import { Pressable, Text, View } from "react-native";
import { describe, expect, it, vi } from "vitest";
import { TaskAssignmentPicker } from "./task-assignment-picker";
import { assignment, course } from "./fixtures.test-support";

const HOST_TYPES = new Set<unknown>([View, Text, Pressable]);

function deepRender(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(deepRender);
  if (node === null || typeof node !== "object") return node;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (!("type" in el)) return node;
  if (typeof el.type === "function" && !HOST_TYPES.has(el.type)) {
    return deepRender((el.type as (props: unknown) => unknown)(el.props ?? {}));
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

function findByTestId(node: unknown, testID: string): any {
  return findAll(node, (n) => n.props?.testID === testID)[0] ?? null;
}

const COURSE_A = course({ id: "course-a", code: "INSY 4315", name: "Advanced Web Development" });
const COURSE_B = course({ id: "course-b", code: null, name: "Intro to Databases" });

function baseProps(overrides: Partial<Parameters<typeof TaskAssignmentPicker>[0]> = {}) {
  return {
    expanded: false,
    onToggleExpanded: vi.fn(),
    isLinked: false,
    linkedTitle: null,
    linkedCourseLabel: null,
    courses: [COURSE_A, COURSE_B],
    selectedCourseId: null,
    onSelectCourse: vi.fn(),
    courseAssignments: null,
    courseAssignmentsFetchedAt: Date.parse("2026-09-17T12:00:00Z"),
    onSelectAssignment: vi.fn(),
    onClear: vi.fn(),
    ...overrides,
  };
}

function render(overrides: Partial<Parameters<typeof TaskAssignmentPicker>[0]> = {}): unknown {
  return deepRender(TaskAssignmentPicker(baseProps(overrides)));
}

describe("the collapsed field", () => {
  it("shows 'None' when unlinked", () => {
    const tree = render();
    expect(getTextContent(findByTestId(tree, "task-assignment-field"))).toContain("None");
  });

  it("shows the resolved title and course label once linked and resolved", () => {
    const tree = render({
      isLinked: true,
      linkedTitle: "Project milestone 2",
      linkedCourseLabel: "INSY 4315",
    });
    const text = getTextContent(findByTestId(tree, "task-assignment-field"));
    expect(text).toContain("Project milestone 2");
    expect(text).toContain("INSY 4315");
  });

  it("falls back to a generic label when linked but this session has no resolved title", () => {
    const tree = render({ isLinked: true, linkedTitle: null, linkedCourseLabel: null });
    expect(getTextContent(findByTestId(tree, "task-assignment-field"))).toContain(
      "Linked assignment",
    );
  });

  it("toggles the panel on tap", () => {
    const onToggleExpanded = vi.fn();
    const tree = render({ onToggleExpanded });
    findByTestId(tree, "task-assignment-field").props.onPress();
    expect(onToggleExpanded).toHaveBeenCalledTimes(1);
  });

  it("hides the picker panel entirely while collapsed", () => {
    expect(findByTestId(render({ expanded: false }), "task-assignment-picker-panel")).toBeNull();
    expect(findByTestId(render({ expanded: true }), "task-assignment-picker-panel")).not.toBeNull();
  });
});

describe("clearing the link", () => {
  it("offers 'None', selected exactly when unlinked, and calls onClear", () => {
    const onClear = vi.fn();
    const linked = render({ expanded: true, isLinked: true, onClear });
    const none = findByTestId(linked, "task-assignment-none");
    expect(none.props.accessibilityState.selected).toBe(false);
    none.props.onPress();
    expect(onClear).toHaveBeenCalledTimes(1);

    const unlinked = render({ expanded: true, isLinked: false });
    expect(findByTestId(unlinked, "task-assignment-none").props.accessibilityState.selected).toBe(
      true,
    );
  });
});

describe("the course step", () => {
  it("lists every course as a chip, by code or by name with no code", () => {
    const text = getTextContent(render({ expanded: true }));
    expect(text).toContain("INSY 4315");
    expect(text).toContain("Intro to Databases");
  });

  it("selecting a course calls onSelectCourse; selecting it again clears the selection", () => {
    const onSelectCourse = vi.fn();
    const tree = render({ expanded: true, onSelectCourse });
    const chips = findAll(tree, (n) => n.type === Pressable);
    const courseAChip = chips.find((c) => getTextContent(c).includes("INSY 4315"));
    courseAChip.props.onPress();
    expect(onSelectCourse).toHaveBeenCalledWith("course-a");

    onSelectCourse.mockClear();
    const reselect = render({ expanded: true, onSelectCourse, selectedCourseId: "course-a" });
    const again = findAll(reselect, (n) => n.type === Pressable).find((c) =>
      getTextContent(c).includes("INSY 4315"),
    );
    again.props.onPress();
    expect(onSelectCourse).toHaveBeenCalledWith(null);
  });

  it("shows no assignment groups until a course is selected", () => {
    const text = getTextContent(render({ expanded: true }));
    expect(text).not.toContain("Overdue");
    expect(text).not.toContain("Upcoming");
  });
});

describe("the assignment step", () => {
  it("groups assignments into Overdue / Upcoming / No due date / Submitted & graded, in that order", () => {
    const now = Date.parse("2026-09-20T12:00:00Z");
    const items = [
      assignment({
        id: "overdue-1",
        title: "Late one",
        due_at: "2026-09-19T12:00:00Z",
        open: true,
      }),
      assignment({
        id: "upcoming-1",
        title: "Soon one",
        due_at: "2026-09-25T12:00:00Z",
        open: true,
      }),
      assignment({ id: "undated-1", title: "No date one", due_at: null, open: true }),
      assignment({
        id: "closed-1",
        title: "Done one",
        open: false,
        submission: {
          status: "graded",
          missing: false,
          late: false,
          submitted_at: "2026-09-18T00:00:00Z",
        },
      }),
    ];
    const tree = render({
      expanded: true,
      selectedCourseId: "course-a",
      courseAssignments: items,
      courseAssignmentsFetchedAt: now,
    });
    const text = getTextContent(tree);
    const overdueAt = text.indexOf("Overdue");
    const upcomingAt = text.indexOf("Upcoming");
    const undatedAt = text.indexOf("No due date");
    const closedAt = text.indexOf("Submitted & graded");
    expect(overdueAt).toBeGreaterThan(-1);
    expect(upcomingAt).toBeGreaterThan(overdueAt);
    expect(undatedAt).toBeGreaterThan(upcomingAt);
    expect(closedAt).toBeGreaterThan(undatedAt);
    expect(text).toContain("Late one");
    expect(text).toContain("Soon one");
    expect(text).toContain("No date one");
    expect(text).toContain("Done one");
  });

  it("tapping an assignment row calls onSelectAssignment with the full row", () => {
    const onSelectAssignment = vi.fn();
    const item = assignment({ id: "pick-me", title: "Pick me" });
    const tree = render({
      expanded: true,
      selectedCourseId: "course-a",
      courseAssignments: [item],
      onSelectAssignment,
    });
    const row = findAll(tree, (n) => n.type === Pressable).find((p) =>
      getTextContent(p).includes("Pick me"),
    );
    row.props.onPress();
    expect(onSelectAssignment).toHaveBeenCalledWith(item);
  });

  it("shows a Missing badge on a missing submission", () => {
    const item = assignment({
      submission: { status: "unsubmitted", missing: true, late: false, submitted_at: null },
    });
    const text = getTextContent(
      render({ expanded: true, selectedCourseId: "course-a", courseAssignments: [item] }),
    );
    expect(text).toContain("Missing");
  });

  it("says nothing has synced when the selected course has zero assignments", () => {
    const text = getTextContent(
      render({ expanded: true, selectedCourseId: "course-a", courseAssignments: [] }),
    );
    expect(text).toContain("No assignments have synced for this course.");
  });
});

describe("disabled", () => {
  it("marks the field row and every chip disabled", () => {
    const tree = render({ expanded: true, disabled: true });
    const field = findByTestId(tree, "task-assignment-field");
    expect(field.props.disabled).toBe(true);
    const none = findByTestId(tree, "task-assignment-none");
    expect(none.props.disabled).toBe(true);
  });
});
