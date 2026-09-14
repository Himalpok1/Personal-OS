import type { RecurrenceEditorState } from "@personal-os/core/recurrence/editor";
import { describe, expect, it, vi } from "vitest";
import { EventRepeatField } from "./event-repeat-field";
import { RecurrenceEditor } from "./recurrence-editor";
import {
  TaskRepeatField,
  TaskRepeatFieldView,
  type TaskRepeatFieldViewProps,
} from "./task-repeat-field";

// Tree-walk helpers, as in task-repeat-field.test.tsx.
function findByTestId(node: any, testID: string): any {
  if (!node || typeof node !== "object") return null;
  if (node.props?.testID === testID) return node;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByTestId(child, testID);
      if (found) return found;
    }
  }
  if (node.props?.children) {
    const children = Array.isArray(node.props.children)
      ? node.props.children
      : [node.props.children];
    for (const child of children) {
      const found = findByTestId(child, testID);
      if (found) return found;
    }
  }
  return null;
}

const TZ = "America/Chicago";

const NEVER: RecurrenceEditorState = {
  enabled: false,
  frequency: "DAILY",
  interval: 1,
  weekdays: [],
  monthDay: null,
  endMode: "never",
  untilDate: null,
  count: null,
  anchor: "due_date",
  timezone: TZ,
  isCustom: false,
  rawRrule: null,
};
const DAILY: RecurrenceEditorState = { ...NEVER, enabled: true };
const CUSTOM: RecurrenceEditorState = {
  ...NEVER,
  enabled: true,
  isCustom: true,
  rawRrule: "FREQ=YEARLY",
};

function renderEventView(overrides: Partial<TaskRepeatFieldViewProps> = {}) {
  const props: TaskRepeatFieldViewProps = {
    kind: "event",
    value: NEVER,
    onChange: vi.fn(),
    dueAt: null,
    timezone: TZ,
    intervalText: "2",
    onIntervalTextChange: vi.fn(),
    onIntervalBlur: vi.fn(),
    advancedOpen: false,
    onToggleAdvanced: vi.fn(),
    ...overrides,
  };
  return TaskRepeatFieldView(props);
}

describe("the event Repeat field (TaskRepeatFieldView in event mode)", () => {
  it("offers the six preset chips and never the completion toggle", () => {
    const tree = renderEventView({ value: DAILY, dueAt: "2026-09-14T14:00:00.000Z" });
    for (const preset of ["never", "daily", "weekdays", "weekly", "monthly", "every_n_days"]) {
      expect(findByTestId(tree, `repeat-preset-${preset}`), preset).toBeTruthy();
    }
    // In task mode this state shows the toggle; an event is never completed.
    expect(findByTestId(tree, "repeat-after-completion")).toBeNull();
    expect(
      findByTestId(renderEventView({ kind: "task", value: DAILY }), "repeat-after-completion"),
    ).toBeTruthy();
  });

  it("never shows the no-due-date hint -- an event's start is not optional", () => {
    expect(
      findByTestId(renderEventView({ value: DAILY, dueAt: null }), "repeat-due-hint"),
    ).toBeNull();
    expect(
      findByTestId(renderEventView({ kind: "task", value: DAILY, dueAt: null }), "repeat-due-hint"),
    ).toBeTruthy();
  });

  it("mounts the advanced editor for a custom rule with isTask=false, so no anchor toggle appears", () => {
    const tree = renderEventView({ value: CUSTOM, advancedOpen: true });
    const slot = findByTestId(tree, "repeat-advanced-editor");
    expect(slot).toBeTruthy();
    const children = Array.isArray(slot.props.children)
      ? slot.props.children
      : [slot.props.children];
    const editor = children.find((child: any) => child && child.type === RecurrenceEditor);
    expect(editor).toBeTruthy();
    expect(editor.props.isTask).toBe(false);
    expect(editor.props.value).toBe(CUSTOM);
  });

  it("EventRepeatField wraps TaskRepeatField in event mode with the start as the derivation date", () => {
    const onChange = vi.fn();
    const element = EventRepeatField({
      value: NEVER,
      onChange,
      start: { allDay: true, startDate: "2026-09-14", startsAt: null },
      timezone: TZ,
    });
    expect(element.type).toBe(TaskRepeatField);
    expect(element.props.kind).toBe("event");
    expect(element.props.onChange).toBe(onChange);
    // Local noon of the 14th in Chicago -- never UTC midnight (the 13th).
    expect(element.props.dueAt).toBe("2026-09-14T17:00:00.000Z");
  });
});
