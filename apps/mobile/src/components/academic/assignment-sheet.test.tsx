// The in-app assignment sheet (Checkpoint 10.6, ADR-076 §3): the store that
// hookless rows write to, and the hookless content the host draws.
//
// The same-origin gate Checkpoint 10.1 verified live moved here from the
// rows (which now open this sheet instead of leaving the app), so the pins
// academic-today-card.test.tsx used to carry are re-stated on the sheet: a
// same-origin assignment gets an "Open in Canvas" link with a handler,
// any other origin (or no url) gets NO row at all, and html_url is never
// printed. Tree-walk idiom, no render library.

import { explainFocusNowCandidate } from "@personal-os/core/focus-now/explain";
import { Pressable, Text, View } from "react-native";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASSIGNMENT_PROPOSE_FAILED,
  AssignmentDetail,
  AssignmentSheetContent,
  closeAssignmentSheet,
  getAssignmentSheet,
  openAssignmentSheet,
  resetAssignmentSheetForTests,
  subscribeAssignmentSheet,
} from "./assignment-sheet";
import { assignment, SOURCE_BASE_URL } from "./fixtures.test-support";

// The host's hooks reach the API client (expo at import); mocked whole --
// the content under test proposes through the prop the host passes.
vi.mock("@/queries/actions", () => ({ useCreateActionRequest: vi.fn() }));
// Checkpoint 10.9 (ADR-082): the approval sheet's host reads the paired
// device identity, whose provider module reaches SecureStore at import; the
// hookless content rendered here never calls it, so the provider is stubbed.
vi.mock("@/device-identity/provider", () => ({ useDeviceIdentity: vi.fn() }));

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

beforeEach(() => {
  resetAssignmentSheetForTests();
});

describe("the store", () => {
  it("starts closed, opens with a record, closes keeping the record for the exit, notifies subscribers", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAssignmentSheet(listener);
    expect(getAssignmentSheet()).toEqual({ visible: false, record: null });
    openAssignmentSheet({ assignment: assignment({ id: "a1" }) });
    expect(getAssignmentSheet().visible).toBe(true);
    expect(getAssignmentSheet().record?.assignment.id).toBe("a1");
    expect(listener).toHaveBeenCalledTimes(1);
    closeAssignmentSheet();
    expect(getAssignmentSheet()).toMatchObject({ visible: false });
    expect(getAssignmentSheet().record?.assignment.id).toBe("a1");
    expect(listener).toHaveBeenCalledTimes(2);
    closeAssignmentSheet();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
    openAssignmentSheet({ assignment: assignment({ id: "a2" }) });
    expect(listener).toHaveBeenCalledTimes(2);
  });
});

describe("AssignmentDetail", () => {
  it("renders course, due, points, a submission chip and the grade when graded -- every value the server's", () => {
    const tree = deepRender(
      <AssignmentDetail
        assignment={assignment({
          submission: { status: "graded", missing: false, late: true, submitted_at: null },
          grade: { status: "graded", score: 93, grade: "A", percentage: 93 },
        })}
      />,
    );
    const text = getTextContent(tree);
    expect(text).toContain("INSY 4315");
    expect(text).toContain("100");
    expect(text).toContain("Late");
    expect(text).toContain("93 / 100 · 93% · A");
    expect(text).not.toContain("http");
  });

  it("omits points and grade when absent, and shows no chip for a plain open row", () => {
    const text = getTextContent(
      deepRender(<AssignmentDetail assignment={assignment({ points_possible: null })} />),
    );
    expect(text).not.toContain("Points");
    expect(text).not.toContain("Grade");
    expect(text).not.toContain("Missing");
  });
});

describe("AssignmentSheetContent -- the same-origin gate, moved from the rows", () => {
  it("offers Open in Canvas as a link with a handler on the connection's own origin", () => {
    const tree = deepRender(
      <AssignmentSheetContent
        record={{
          assignment: assignment({ html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001` }),
        }}
      />,
    );
    const link = pressables(tree).find((p) => p.props.accessibilityRole === "link");
    expect(link).toBeDefined();
    expect(link.props.disabled).toBe(false);
    expect(typeof link.props.onPress).toBe("function");
    expect(getTextContent(tree)).toContain("Open in Canvas");
  });

  it("offers NO Canvas row on any other origin, and none with no url", () => {
    for (const html_url of ["https://evil.example.com/x", null]) {
      const tree = deepRender(
        <AssignmentSheetContent record={{ assignment: assignment({ html_url }) }} />,
      );
      expect(pressables(tree)).toEqual([]);
      expect(getTextContent(tree)).not.toContain("Open in Canvas");
    }
  });

  it("never renders html_url as text, openable or not", () => {
    for (const html_url of [
      `${SOURCE_BASE_URL}/courses/1/assignments/1001`,
      "https://evil.example.com/x",
    ]) {
      const text = getTextContent(
        deepRender(<AssignmentSheetContent record={{ assignment: assignment({ html_url }) }} />),
      );
      expect(text).not.toContain("instructure.com");
      expect(text).not.toContain("evil.example.com");
      expect(text).not.toContain("http");
    }
  });

  it("renders the Focus Now explanation with a source chip per reason and the equation when given one", () => {
    const explanation = explainFocusNowCandidate({
      id: "a1",
      kind: "academic_assignment",
      title: "x",
      dueAt: null,
      baseScore: 450,
      contextPoints: 25,
      score: 475,
      reasons: ["overdue", "marked_missing", "course_attention_high"],
      linkedAssignmentId: null,
    });
    const text = getTextContent(
      deepRender(<AssignmentSheetContent record={{ assignment: assignment(), explanation }} />),
    );
    expect(text).toContain("Why it's here");
    expect(text).toContain("Overdue");
    expect(text).toContain("Past its due time");
    expect(text).toContain("Course needs attention");
    expect(text).toContain("Canvas assignment");
    expect(text).toContain("Course");
    expect(text).toContain("450 Canvas priority + 25 course attention = 475");
  });

  it("renders no explanation block without one", () => {
    const text = getTextContent(
      deepRender(<AssignmentSheetContent record={{ assignment: assignment() }} />),
    );
    expect(text).not.toContain("Why it's here");
  });
});

describe("AssignmentSheetContent -- the two proposals (Checkpoint 10.8, ADR-078 §6)", () => {
  const propose = () => ({ onPropose: vi.fn(), pending: false, error: null });

  it("renders no proposal rows unless the host supplies a proposer", () => {
    const text = getTextContent(
      deepRender(<AssignmentSheetContent record={{ assignment: assignment() }} />),
    );
    expect(text).not.toContain("Plan study block");
    expect(text).not.toContain("Add a task for this");
  });

  it("draws Plan study block and Add a task ABOVE Open in Canvas, each a button", () => {
    const tree = deepRender(
      <AssignmentSheetContent
        record={{
          assignment: assignment({ html_url: `${SOURCE_BASE_URL}/courses/1/assignments/1001` }),
        }}
        propose={propose()}
      />,
    );
    const text = getTextContent(tree);
    expect(text.indexOf("Plan study block")).toBeLessThan(text.indexOf("Add a task for this"));
    expect(text.indexOf("Add a task for this")).toBeLessThan(text.indexOf("Open in Canvas"));
    const rows = pressables(tree);
    expect(rows.map((row) => row.props.accessibilityRole)).toEqual(["button", "button", "link"]);
  });

  it("Plan study block proposes a create_calendar_event from Focus Now; Add a task proposes a linked create_task from Academics", () => {
    const proposer = propose();
    const tree = deepRender(
      <AssignmentSheetContent record={{ assignment: assignment() }} propose={proposer} />,
    );
    findAll(tree, (n) => n.props?.testID === "assignment-plan-study-block")[0].props.onPress();
    expect(proposer.onPropose).toHaveBeenCalledTimes(1);
    const study = proposer.onPropose.mock.calls[0]![0];
    expect(study).toMatchObject({
      action_id: "create_calendar_event",
      source: "focus_now",
      source_ref: "canvas_assignment",
      input: { title: "Study: Project milestone 2" },
    });
    expect(study.input.calendar).toBeUndefined();
    expect(study.reason).toMatch(/^Due .* · from your Focus Now list$/);

    findAll(tree, (n) => n.props?.testID === "assignment-add-task")[0].props.onPress();
    const task = proposer.onPropose.mock.calls[1]![0];
    expect(task).toMatchObject({
      action_id: "create_task",
      source: "academic",
      source_ref: "canvas_assignment",
      reason: "Track this assignment as a task",
      input: {
        title: "Project milestone 2",
        due_at: "2026-09-23T04:59:00Z",
        canvas_assignment_id: assignment().id,
      },
    });
  });

  it("disables both rows while a proposal is in flight and shows a failed proposal as an inert danger row", () => {
    const tree = deepRender(
      <AssignmentSheetContent
        record={{ assignment: assignment() }}
        propose={{ onPropose: vi.fn(), pending: true, error: ASSIGNMENT_PROPOSE_FAILED }}
      />,
    );
    for (const testID of ["assignment-plan-study-block", "assignment-add-task"]) {
      expect(findAll(tree, (n) => n.props?.testID === testID)[0].props.disabled).toBe(true);
    }
    const error = findAll(tree, (n) => n.props?.testID === "assignment-propose-error")[0];
    expect(getTextContent(error)).toContain("Couldn't propose that");
    expect(error.props.onPress).toBeUndefined();
  });
});
