import {
  formatRecurrenceSummary,
  type RecurrenceEditorState,
} from "@personal-os/core/recurrence/editor";
import { describe, expect, it, vi } from "vitest";
import { RecurrenceEditor } from "./recurrence-editor";

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

function createDefaultState(overrides?: Partial<RecurrenceEditorState>): RecurrenceEditorState {
  return {
    frequency: "WEEKLY",
    interval: 1,
    weekdays: [],
    monthDay: null,
    endMode: "never",
    untilDate: null,
    count: null,
    anchor: "due_date",
    timezone: "America/Chicago",
    isCustom: false,
    rawRrule: null,
    ...overrides,
  };
}

describe("<RecurrenceEditor />", () => {
  it("renders live human summary correctly for standard weekly state", () => {
    const state = createDefaultState({
      frequency: "WEEKLY",
      interval: 1,
      weekdays: ["MO", "WE", "FR"],
    });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    const summaryNode = findByTestId(tree, "recurrence-summary");
    expect(summaryNode).toBeTruthy();
    expect(getTextContent(summaryNode)).toBe("Weekly on Mon, Wed, Fri");
    expect(getTextContent(summaryNode)).toBe(formatRecurrenceSummary(state));
  });

  it("handles preset switching: does not repeat, daily, weekly, monthly, custom", () => {
    const state = createDefaultState({ frequency: "DAILY" });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    // Switch to Weekly preset
    const weeklyPreset = findByTestId(tree, "preset-weekly");
    expect(weeklyPreset).toBeTruthy();
    weeklyPreset.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "WEEKLY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        isCustom: false,
        rawRrule: null,
      }),
    );

    // Switch to Daily preset
    const dailyPreset = findByTestId(tree, "preset-daily");
    expect(dailyPreset).toBeTruthy();
    dailyPreset.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "DAILY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        isCustom: false,
        rawRrule: null,
      }),
    );

    // Switch to Monthly preset
    const monthlyPreset = findByTestId(tree, "preset-monthly");
    expect(monthlyPreset).toBeTruthy();
    monthlyPreset.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "MONTHLY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        isCustom: false,
        rawRrule: null,
      }),
    );

    // Switch to "Does not repeat" preset
    const nonePreset = findByTestId(tree, "preset-none");
    expect(nonePreset).toBeTruthy();
    nonePreset.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isCustom: false,
        rawRrule: null,
      }),
    );
  });

  it("handles frequency and interval changes", () => {
    const state = createDefaultState({ frequency: "DAILY", interval: 1 });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    // Change frequency to MONTHLY
    const monthlyBtn = findByTestId(tree, "freq-monthly");
    expect(monthlyBtn).toBeTruthy();
    monthlyBtn.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        frequency: "MONTHLY",
        isCustom: false,
      }),
    );

    // Change interval to 3
    const intervalInput = findByTestId(tree, "interval-input");
    expect(intervalInput).toBeTruthy();
    intervalInput.props.onChangeText("3");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        interval: 3,
        isCustom: false,
      }),
    );
  });

  it("handles weekday multi-selection for weekly frequency", () => {
    const state = createDefaultState({
      frequency: "WEEKLY",
      weekdays: ["MO", "WE"],
    });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    // Toggle FR on
    const frChip = findByTestId(tree, "weekday-FR");
    expect(frChip).toBeTruthy();
    frChip.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        weekdays: ["MO", "WE", "FR"],
      }),
    );

    // Toggle MO off
    const moChip = findByTestId(tree, "weekday-MO");
    expect(moChip).toBeTruthy();
    moChip.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        weekdays: ["WE"],
      }),
    );
  });

  it("handles month-day input for monthly frequency", () => {
    const state = createDefaultState({
      frequency: "MONTHLY",
      monthDay: 15,
    });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    const monthDayInput = findByTestId(tree, "month-day-input");
    expect(monthDayInput).toBeTruthy();
    expect(monthDayInput.props.value).toBe("15");

    monthDayInput.props.onChangeText("25");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monthDay: 25,
      }),
    );

    monthDayInput.props.onChangeText("");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        monthDay: null,
      }),
    );
  });

  it("toggles task recurrence anchor and hides weekdays / monthDay / end options in completion-anchor mode", () => {
    const dueState = createDefaultState({
      frequency: "WEEKLY",
      weekdays: ["MO", "TU"],
      anchor: "due_date",
    });
    const onChange = vi.fn();
    const dueTree = RecurrenceEditor({ value: dueState, onChange, isTask: true });

    // Weekdays and End Condition should be visible for due_date
    expect(findByTestId(dueTree, "weekday-MO")).toBeTruthy();
    expect(findByTestId(dueTree, "end-never")).toBeTruthy();

    // Toggle to completion_date anchor
    const completionAnchorBtn = findByTestId(dueTree, "anchor-completion-date");
    expect(completionAnchorBtn).toBeTruthy();
    completionAnchorBtn.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        anchor: "completion_date",
      }),
    );

    // When anchor is completion_date
    const compState = createDefaultState({
      frequency: "WEEKLY",
      weekdays: ["MO", "TU"],
      anchor: "completion_date",
    });
    const compTree = RecurrenceEditor({ value: compState, onChange, isTask: true });

    // Weekdays, MonthDay, and End Condition options should be hidden/omitted
    expect(findByTestId(compTree, "weekday-MO")).toBeNull();
    expect(findByTestId(compTree, "month-day-input")).toBeNull();
    expect(findByTestId(compTree, "end-never")).toBeNull();
    expect(findByTestId(compTree, "end-until")).toBeNull();
    expect(findByTestId(compTree, "end-count")).toBeNull();

    // Summary displays completion-anchored wording
    const summaryNode = findByTestId(compTree, "recurrence-summary");
    expect(getTextContent(summaryNode)).toBe("Repeats weekly after completion");
  });

  it("handles end conditions: never, on date (until), and count (after N times)", () => {
    const state = createDefaultState({
      frequency: "DAILY",
      endMode: "never",
    });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange });

    // Select "On date" (until)
    const untilBtn = findByTestId(tree, "end-until");
    expect(untilBtn).toBeTruthy();
    untilBtn.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endMode: "until",
        untilDate: "",
      }),
    );

    // Select "After N times" (count)
    const countBtn = findByTestId(tree, "end-count");
    expect(countBtn).toBeTruthy();
    countBtn.props.onPress();
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endMode: "count",
        count: 1,
      }),
    );

    // When endMode is until, test until-date-input
    const untilState = createDefaultState({
      frequency: "DAILY",
      endMode: "until",
      untilDate: "2026-12-31",
    });
    const untilTree = RecurrenceEditor({ value: untilState, onChange });
    const untilInput = findByTestId(untilTree, "until-date-input");
    expect(untilInput).toBeTruthy();
    untilInput.props.onChangeText("2026-11-30");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endMode: "until",
        untilDate: "2026-11-30",
      }),
    );

    // When endMode is count, test count-input
    const countState = createDefaultState({
      frequency: "DAILY",
      endMode: "count",
      count: 5,
    });
    const countTree = RecurrenceEditor({ value: countState, onChange });
    const countInput = findByTestId(countTree, "count-input");
    expect(countInput).toBeTruthy();
    countInput.props.onChangeText("10");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        endMode: "count",
        count: 10,
      }),
    );
  });

  it("displays custom rule banner and preserves rawRrule until replace button is clicked", () => {
    const rawRrule = "FREQ=MONTHLY;BYDAY=2MO,4MO;BYSETPOS=1";
    const customState = createDefaultState({
      isCustom: true,
      rawRrule,
    });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: customState, onChange });

    // Warning banner should be present
    const noticeNode = findByTestId(tree, "custom-rule-notice");
    expect(noticeNode).toBeTruthy();
    expect(getTextContent(noticeNode)).toContain(`Custom recurrence rule: ${rawRrule}`);

    // Summary displays custom summary
    const summaryNode = findByTestId(tree, "recurrence-summary");
    expect(getTextContent(summaryNode)).toBe(`Custom (${rawRrule})`);

    // Standard controls should not be rendered while isCustom is true
    expect(findByTestId(tree, "freq-daily")).toBeNull();

    // Click "Replace with standard recurrence"
    const replaceBtn = findByTestId(tree, "replace-custom-rule-button");
    expect(replaceBtn).toBeTruthy();
    replaceBtn.props.onPress();

    // Replaces custom flag and clears rawRrule
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        isCustom: false,
        rawRrule: null,
      }),
    );
  });

  it("respects disabled prop by disabling all interactions", () => {
    const state = createDefaultState({ frequency: "DAILY" });
    const onChange = vi.fn();
    const tree = RecurrenceEditor({ value: state, onChange, disabled: true });

    // Pressing preset button should not call onChange
    const weeklyPreset = findByTestId(tree, "preset-weekly");
    expect(weeklyPreset.props.disabled).toBe(true);
    weeklyPreset.props.onPress();
    expect(onChange).not.toHaveBeenCalled();

    // Pressing frequency button should not call onChange
    const monthlyBtn = findByTestId(tree, "freq-monthly");
    expect(monthlyBtn.props.disabled).toBe(true);
    monthlyBtn.props.onPress();
    expect(onChange).not.toHaveBeenCalled();
  });
});
