import {
  parseRRuleStringToEditorState,
  serializeEditorStateToRRule,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { describe, expect, it, vi } from "vitest";
import { RecurrenceEditor } from "./recurrence-editor";
import { TaskRepeatFieldView, type TaskRepeatFieldViewProps } from "./task-repeat-field";
import { REPEAT_NO_DUE_DATE_HINT, selectPreset, setInterval } from "./task-repeat-state";

// Tree-walk helpers, as in recurrence-editor.test.tsx and
// __tests__/events-screen.test.tsx: the view is called as a function and its
// element tree inspected, with no render harness.
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

function getTextContent(node: any): string {
  if (!node) return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(getTextContent).join("");
  if (node.props?.children) return getTextContent(node.props.children);
  return "";
}

// <RecurrenceEditor> is a component element in the view's tree, opaque to the
// walk until expanded; it has no hooks of its own beyond the mocked
// useColorScheme, so calling it is safe here.
function expandEditor(tree: any): any {
  const slot = findByTestId(tree, "repeat-advanced-editor");
  if (!slot) return null;
  const children = Array.isArray(slot.props.children)
    ? slot.props.children
    : [slot.props.children];
  const element = children.find((child: any) => child && child.type === RecurrenceEditor);
  return element ? { element, tree: RecurrenceEditor(element.props) } : null;
}

const TZ = "America/Chicago";
const MONDAY_DUE = "2026-09-14T14:00:00.000Z";

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

function render(overrides: Partial<TaskRepeatFieldViewProps> = {}) {
  const onChange = vi.fn();
  const props: TaskRepeatFieldViewProps = {
    value: NEVER,
    onChange,
    dueAt: MONDAY_DUE,
    timezone: TZ,
    intervalText: "2",
    onIntervalTextChange: vi.fn(),
    onIntervalBlur: vi.fn(),
    advancedOpen: false,
    onToggleAdvanced: vi.fn(),
    ...overrides,
  };
  return { tree: TaskRepeatFieldView(props), props, onChange };
}

const PRESETS = ["never", "daily", "weekdays", "weekly", "monthly", "every_n_days"] as const;

describe("<TaskRepeatFieldView />", () => {
  it("renders the six preset chips as 44px selectable buttons, with Never selected by default", () => {
    const { tree } = render();
    for (const preset of PRESETS) {
      const chip = findByTestId(tree, `repeat-preset-${preset}`);
      expect(chip, preset).toBeTruthy();
      expect(chip.props.accessibilityRole).toBe("button");
      expect(chip.props.hitSlop).toBe(8);
      expect(chip.props.className).toContain("min-h-[44px]");
      expect(chip.props.className).toContain("rounded-full");
      expect(chip.props.accessibilityState.selected).toBe(preset === "never");
    }
    expect(findByTestId(tree, "repeat-preset-never").props.className).toContain("bg-primary");
    expect(findByTestId(tree, "repeat-preset-daily").props.className).not.toContain("bg-primary");
    // Nothing to summarise, no interval box, no anchor toggle, no hint.
    expect(findByTestId(tree, "repeat-summary")).toBeNull();
    expect(findByTestId(tree, "repeat-interval-input")).toBeNull();
    expect(findByTestId(tree, "repeat-after-completion")).toBeNull();
    expect(findByTestId(tree, "repeat-due-hint")).toBeNull();
  });

  it("emits the preset's state on tap, derived from the due date", () => {
    const { tree, onChange } = render();
    findByTestId(tree, "repeat-preset-weekly").props.onPress();
    expect(onChange).toHaveBeenCalledTimes(1);
    const emitted = onChange.mock.calls[0]![0] as RecurrenceEditorState;
    expect(serializeEditorStateToRRule(emitted).rrule).toBe("FREQ=WEEKLY;BYDAY=MO");

    findByTestId(tree, "repeat-preset-never").props.onPress();
    const cleared = onChange.mock.calls[1]![0] as RecurrenceEditorState;
    expect(serializeEditorStateToRRule(cleared).rrule).toBeNull();
  });

  it("marks the active preset and shows the summary line", () => {
    const value = selectPreset(NEVER, "weekly", { dueAt: MONDAY_DUE, timezone: TZ });
    const { tree } = render({ value });
    expect(findByTestId(tree, "repeat-preset-weekly").props.accessibilityState.selected).toBe(true);
    expect(findByTestId(tree, "repeat-preset-never").props.accessibilityState.selected).toBe(false);
    expect(getTextContent(findByTestId(tree, "repeat-summary"))).toBe("Weekly on Mon");
  });

  it("shows the number-pad interval box only for Every N days", () => {
    const value = setInterval(NEVER, 3, { dueAt: MONDAY_DUE, timezone: TZ });
    const { tree, props } = render({ value, intervalText: "3" });
    const input = findByTestId(tree, "repeat-interval-input");
    expect(input).toBeTruthy();
    expect(input.props.keyboardType).toBe("number-pad");
    expect(input.props.value).toBe("3");
    input.props.onChangeText("4");
    expect(props.onIntervalTextChange).toHaveBeenCalledWith("4");
    input.props.onBlur();
    expect(props.onIntervalBlur).toHaveBeenCalled();
    expect(getTextContent(findByTestId(tree, "repeat-summary"))).toBe("Every 3 days");

    const daily = selectPreset(NEVER, "daily", { dueAt: MONDAY_DUE, timezone: TZ });
    expect(findByTestId(render({ value: daily }).tree, "repeat-interval-input")).toBeNull();
  });

  it("offers the completion toggle for daily/weekly/monthly/every-N but never for Weekdays", () => {
    for (const preset of ["daily", "weekly", "monthly", "every_n_days"] as const) {
      const value = selectPreset(NEVER, preset, { dueAt: MONDAY_DUE, timezone: TZ });
      const { tree, onChange } = render({ value });
      const toggle = findByTestId(tree, "repeat-after-completion");
      expect(toggle, preset).toBeTruthy();
      expect(toggle.props.accessibilityState.selected).toBe(false);
      toggle.props.onPress();
      const emitted = onChange.mock.calls[0]![0] as RecurrenceEditorState;
      expect(serializeEditorStateToRRule(emitted).recurrence_anchor).toBe("completion_date");
    }
    const weekdays = selectPreset(NEVER, "weekdays", { dueAt: MONDAY_DUE, timezone: TZ });
    expect(findByTestId(render({ value: weekdays }).tree, "repeat-after-completion")).toBeNull();
  });

  it("renders the toggle selected, and the suffix in the summary, once anchored on completion", () => {
    const value = parseRRuleStringToEditorState("FREQ=DAILY;INTERVAL=3", {
      recurrenceTimezone: TZ,
      recurrenceAnchor: "completion_date",
    });
    const { tree } = render({ value, intervalText: "3" });
    expect(findByTestId(tree, "repeat-after-completion").props.accessibilityState.selected).toBe(
      true,
    );
    expect(getTextContent(findByTestId(tree, "repeat-summary"))).toBe(
      "Every 3 days after I complete it",
    );
  });

  it("shows the amber hint when a repeat is chosen without a due date", () => {
    const value = selectPreset(NEVER, "daily", { dueAt: null, timezone: TZ });
    const { tree } = render({ value, dueAt: null });
    const hint = findByTestId(tree, "repeat-due-hint");
    expect(hint).toBeTruthy();
    expect(hint.props.className).toContain("bg-warning-container");
    expect(getTextContent(hint)).toBe(REPEAT_NO_DUE_DATE_HINT);

    expect(findByTestId(render({ value, dueAt: MONDAY_DUE }).tree, "repeat-due-hint")).toBeNull();
    expect(findByTestId(render({ value: NEVER, dueAt: null }).tree, "repeat-due-hint")).toBeNull();
  });

  describe("custom rule", () => {
    const custom = parseRRuleStringToEditorState("FREQ=WEEKLY;BYDAY=MO,WE,FR", {
      recurrenceTimezone: TZ,
    });

    it("replaces the chips with the amber notice, summary, Edit advanced… and Remove repeat", () => {
      const { tree } = render({ value: custom });
      const notice = findByTestId(tree, "repeat-custom-notice");
      expect(notice).toBeTruthy();
      expect(notice.props.className).toContain("bg-warning-container");
      expect(getTextContent(notice)).toContain("Custom repeat rule");
      expect(getTextContent(findByTestId(tree, "repeat-summary"))).toBe("Weekly on Mon, Wed, Fri");
      expect(findByTestId(tree, "repeat-preset-daily")).toBeNull();
      expect(findByTestId(tree, "repeat-after-completion")).toBeNull();
      expect(getTextContent(findByTestId(tree, "repeat-edit-advanced"))).toBe("Edit advanced…");
      expect(findByTestId(tree, "repeat-remove")).toBeTruthy();
      // Closed until asked for.
      expect(findByTestId(tree, "repeat-advanced-editor")).toBeNull();
      expect(expandEditor(tree)).toBeNull();
    });

    it("mounts the existing RecurrenceEditor inline when advanced is open, with the rule intact", () => {
      const { tree, props } = render({ value: custom, advancedOpen: true });
      const editor = expandEditor(tree);
      expect(editor).toBeTruthy();
      // The same state object, the same onChange, task mode -- nothing is
      // copied or rebuilt on the way in.
      expect(editor.element.props.value).toBe(custom);
      expect(editor.element.props.onChange).toBe(props.onChange);
      expect(editor.element.props.isTask).toBe(true);
      expect(findByTestId(editor.tree, "recurrence-editor")).toBeTruthy();
      expect(getTextContent(findByTestId(editor.tree, "recurrence-summary"))).toBe(
        "Weekly on Mon, Wed, Fri",
      );
      expect(getTextContent(findByTestId(tree, "repeat-edit-advanced"))).toBe("Hide advanced");
      findByTestId(tree, "repeat-edit-advanced").props.onPress();
      expect(props.onToggleAdvanced).toHaveBeenCalledTimes(1);
      // Nothing was emitted just by opening it.
      expect(props.onChange).not.toHaveBeenCalled();
    });

    it("preserves a parser-flagged rawRrule byte-for-byte until explicitly replaced", () => {
      const raw = parseRRuleStringToEditorState("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1", {
        recurrenceTimezone: TZ,
      });
      expect(raw.isCustom).toBe(true);
      const { tree, props } = render({ value: raw, advancedOpen: true });
      const editor = expandEditor(tree);
      expect(editor.element.props.value.rawRrule).toBe("FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1");
      expect(getTextContent(findByTestId(editor.tree, "custom-rule-notice"))).toContain(
        "FREQ=YEARLY;BYMONTH=3;BYMONTHDAY=1",
      );
      // The inner editor's own "Replace with standard recurrence" is the
      // only chip that discards the raw rule -- and it is the owner's tap.
      findByTestId(editor.tree, "replace-custom-rule-button").props.onPress();
      expect(props.onChange).toHaveBeenCalledWith(
        expect.objectContaining({ isCustom: false, rawRrule: null }),
      );
    });

    it("Remove repeat emits a disabled state", () => {
      const { tree, onChange } = render({ value: custom });
      findByTestId(tree, "repeat-remove").props.onPress();
      const emitted = onChange.mock.calls[0]![0] as RecurrenceEditorState;
      expect(serializeEditorStateToRRule(emitted).rrule).toBeNull();
    });

    it("still shows the due-date hint for a custom rule without a due date", () => {
      expect(findByTestId(render({ value: custom, dueAt: null }).tree, "repeat-due-hint")).toBeTruthy();
    });
  });

  it("disables every chip when disabled", () => {
    const value = selectPreset(NEVER, "daily", { dueAt: MONDAY_DUE, timezone: TZ });
    const { tree } = render({ value, disabled: true });
    for (const preset of PRESETS) {
      expect(findByTestId(tree, `repeat-preset-${preset}`).props.disabled).toBe(true);
    }
    expect(findByTestId(tree, "repeat-after-completion").props.disabled).toBe(true);
  });
});
