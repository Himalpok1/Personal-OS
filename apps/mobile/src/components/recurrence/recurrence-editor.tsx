import {
  formatRecurrenceSummary,
  SUPPORTED_FREQUENCIES,
  SUPPORTED_WEEKDAYS,
  type RecurrenceEditorState,
  type RecurrenceEndMode,
  type RecurrenceFrequency,
  type RecurrenceWeekday,
} from "@personal-os/core/recurrence/editor";
import { Pressable, Text, TextInput, View } from "react-native";

export interface RecurrenceEditorProps {
  value: RecurrenceEditorState;
  onChange: (state: RecurrenceEditorState) => void;
  isTask?: boolean;
  disabled?: boolean;
}

const WEEKDAY_LABELS: Record<RecurrenceWeekday, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun",
};

const FREQUENCY_LABELS: Record<RecurrenceFrequency, string> = {
  DAILY: "Daily",
  WEEKLY: "Weekly",
  MONTHLY: "Monthly",
  YEARLY: "Yearly",
};

const INTERVAL_UNITS: Record<RecurrenceFrequency, { singular: string; plural: string }> = {
  DAILY: { singular: "day", plural: "days" },
  WEEKLY: { singular: "week", plural: "weeks" },
  MONTHLY: { singular: "month", plural: "months" },
  YEARLY: { singular: "year", plural: "years" },
};

export type PresetType = "none" | "daily" | "weekly" | "monthly" | "custom";

export function determineActivePreset(state: RecurrenceEditorState): PresetType {
  if (state.enabled === false) {
    return "none";
  }
  if (state.isCustom) {
    return "custom";
  }
  if (!state.frequency && !state.rawRrule) {
    return "none";
  }
  if (state.anchor === "completion_date") {
    return "custom";
  }
  if (state.interval === 1 && state.endMode === "never") {
    if (state.frequency === "DAILY") {
      return "daily";
    }
    if (state.frequency === "WEEKLY" && state.weekdays.length === 0) {
      return "weekly";
    }
    if (state.frequency === "MONTHLY" && state.monthDay === null) {
      return "monthly";
    }
  }
  return "custom";
}

export function RecurrenceEditor({
  value,
  onChange,
  isTask = false,
  disabled = false,
}: RecurrenceEditorProps) {
  const activePreset = determineActivePreset(value);
  const isEnabled = activePreset !== "none";

  const handleSelectPreset = (preset: PresetType) => {
    if (disabled) return;

    if (preset === "none") {
      onChange({
        ...value,
        enabled: false,
        frequency: "" as unknown as RecurrenceFrequency,
        isCustom: false,
        rawRrule: null,
      });
      return;
    }

    if (preset === "daily") {
      onChange({
        ...value,
        enabled: true,
        frequency: "DAILY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        count: null,
        untilDate: null,
        isCustom: false,
        rawRrule: null,
      });
    } else if (preset === "weekly") {
      onChange({
        ...value,
        enabled: true,
        frequency: "WEEKLY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        count: null,
        untilDate: null,
        isCustom: false,
        rawRrule: null,
      });
    } else if (preset === "monthly") {
      onChange({
        ...value,
        enabled: true,
        frequency: "MONTHLY",
        interval: 1,
        weekdays: [],
        monthDay: null,
        endMode: "never",
        count: null,
        untilDate: null,
        isCustom: false,
        rawRrule: null,
      });
    } else if (preset === "custom") {
      onChange({
        ...value,
        enabled: true,
        frequency: value.frequency || "WEEKLY",
        isCustom: false,
        rawRrule: null,
      });
    }
  };

  const handleFrequencyChange = (frequency: RecurrenceFrequency) => {
    if (disabled) return;
    onChange({
      ...value,
      enabled: true,
      frequency,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleIntervalChange = (text: string) => {
    if (disabled) return;
    const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
    const interval = Number.isNaN(num) || num < 1 ? 1 : num;
    onChange({
      ...value,
      enabled: true,
      interval,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleWeekdayToggle = (day: RecurrenceWeekday) => {
    if (disabled) return;
    const exists = value.weekdays.includes(day);
    const newWeekdays = exists
      ? value.weekdays.filter((d) => d !== day)
      : [...value.weekdays, day].sort(
          (a, b) => SUPPORTED_WEEKDAYS.indexOf(a) - SUPPORTED_WEEKDAYS.indexOf(b),
        );
    onChange({
      ...value,
      enabled: true,
      weekdays: newWeekdays,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleMonthDayChange = (text: string) => {
    if (disabled) return;
    const cleaned = text.replace(/[^0-9]/g, "");
    if (!cleaned) {
      onChange({
        ...value,
        enabled: true,
        monthDay: null,
        isCustom: false,
        rawRrule: null,
      });
      return;
    }
    const day = parseInt(cleaned, 10);
    if (day >= 1 && day <= 31) {
      onChange({
        ...value,
        enabled: true,
        monthDay: day,
        isCustom: false,
        rawRrule: null,
      });
    }
  };

  const handleAnchorChange = (anchor: "due_date" | "completion_date") => {
    if (disabled) return;
    onChange({
      ...value,
      enabled: true,
      anchor,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleEndModeChange = (endMode: RecurrenceEndMode) => {
    if (disabled) return;
    onChange({
      ...value,
      enabled: true,
      endMode,
      untilDate: endMode === "until" ? (value.untilDate ?? "") : null,
      count: endMode === "count" ? (value.count ?? 1) : null,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleUntilDateChange = (text: string) => {
    if (disabled) return;
    onChange({
      ...value,
      enabled: true,
      endMode: "until",
      untilDate: text.trim(),
      count: null,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleCountChange = (text: string) => {
    if (disabled) return;
    const num = parseInt(text.replace(/[^0-9]/g, ""), 10);
    onChange({
      ...value,
      enabled: true,
      endMode: "count",
      count: Number.isNaN(num) || num < 1 ? 1 : num,
      untilDate: null,
      isCustom: false,
      rawRrule: null,
    });
  };

  const handleReplaceCustomRule = () => {
    if (disabled) return;
    onChange({
      ...value,
      enabled: true,
      frequency: value.frequency || "WEEKLY",
      isCustom: false,
      rawRrule: null,
    });
  };

  const isCompletionAnchored = isTask && value.anchor === "completion_date";
  const intervalUnit =
    (value.frequency && INTERVAL_UNITS[value.frequency]?.[value.interval === 1 ? "singular" : "plural"]) ??
    "days";

  const liveSummary = formatRecurrenceSummary(value);

  return (
    <View
      testID="recurrence-editor"
      className={`gap-4 rounded-xl border border-neutral-200 bg-neutral-50 p-4 dark:border-neutral-800 dark:bg-neutral-900 ${
        disabled ? "opacity-50" : ""
      }`}
    >
      {/* Live Summary Card */}
      <View
        testID="recurrence-summary-card"
        className="rounded-lg border border-neutral-200 bg-white p-3 dark:border-neutral-700 dark:bg-black"
      >
        <Text className="text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Recurrence Summary
        </Text>
        <Text
          testID="recurrence-summary"
          className="mt-1 text-base font-medium text-black dark:text-white"
        >
          {liveSummary}
        </Text>
      </View>

      {/* Preset Chips */}
      <View>
        <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
          Presets
        </Text>
        <View className="flex-row flex-wrap gap-2">
          <Pressable
            testID="preset-none"
            disabled={disabled}
            onPress={() => handleSelectPreset("none")}
            className={`rounded-full px-3 py-1.5 ${
              activePreset === "none"
                ? "bg-blue-600"
                : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activePreset === "none" ? "text-white" : "text-black dark:text-white"
              }`}
            >
              Does not repeat
            </Text>
          </Pressable>

          <Pressable
            testID="preset-daily"
            disabled={disabled}
            onPress={() => handleSelectPreset("daily")}
            className={`rounded-full px-3 py-1.5 ${
              activePreset === "daily"
                ? "bg-blue-600"
                : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activePreset === "daily" ? "text-white" : "text-black dark:text-white"
              }`}
            >
              Daily
            </Text>
          </Pressable>

          <Pressable
            testID="preset-weekly"
            disabled={disabled}
            onPress={() => handleSelectPreset("weekly")}
            className={`rounded-full px-3 py-1.5 ${
              activePreset === "weekly"
                ? "bg-blue-600"
                : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activePreset === "weekly" ? "text-white" : "text-black dark:text-white"
              }`}
            >
              Weekly
            </Text>
          </Pressable>

          <Pressable
            testID="preset-monthly"
            disabled={disabled}
            onPress={() => handleSelectPreset("monthly")}
            className={`rounded-full px-3 py-1.5 ${
              activePreset === "monthly"
                ? "bg-blue-600"
                : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activePreset === "monthly" ? "text-white" : "text-black dark:text-white"
              }`}
            >
              Monthly
            </Text>
          </Pressable>

          <Pressable
            testID="preset-custom"
            disabled={disabled}
            onPress={() => handleSelectPreset("custom")}
            className={`rounded-full px-3 py-1.5 ${
              activePreset === "custom"
                ? "bg-blue-600"
                : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
            }`}
          >
            <Text
              className={`text-sm font-medium ${
                activePreset === "custom" ? "text-white" : "text-black dark:text-white"
              }`}
            >
              Custom
            </Text>
          </Pressable>
        </View>
      </View>

      {/* Custom Warning Card */}
      {value.isCustom ? (
        <View
          testID="custom-rule-notice"
          className="gap-2 rounded-lg border border-amber-300 bg-amber-50 p-3 dark:border-amber-700 dark:bg-amber-950"
        >
          <Text className="text-sm font-medium text-amber-900 dark:text-amber-200">
            Custom recurrence rule: {value.rawRrule ?? "Custom rule"}
          </Text>
          <Text className="text-xs text-amber-700 dark:text-amber-300">
            This recurrence pattern contains custom rules not fully editable via standard controls.
          </Text>
          <Pressable
            testID="replace-custom-rule-button"
            disabled={disabled}
            onPress={handleReplaceCustomRule}
            className="mt-1 self-start rounded-md bg-amber-600 px-3 py-1.5 active:bg-amber-700"
          >
            <Text className="text-xs font-semibold text-white">
              Replace with standard recurrence
            </Text>
          </Pressable>
        </View>
      ) : null}

      {/* Standard Recurrence Controls (shown when recurrence is enabled and not custom) */}
      {isEnabled && !value.isCustom ? (
        <View className="gap-4">
          {/* Task Anchor Toggle (if isTask === true) */}
          {isTask ? (
            <View>
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Task Recurrence Anchor
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  testID="anchor-due-date"
                  disabled={disabled}
                  onPress={() => handleAnchorChange("due_date")}
                  className={`flex-1 items-center rounded-lg p-2.5 ${
                    value.anchor === "due_date"
                      ? "bg-blue-600"
                      : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      value.anchor === "due_date" ? "text-white" : "text-black dark:text-white"
                    }`}
                  >
                    On due date
                  </Text>
                </Pressable>

                <Pressable
                  testID="anchor-completion-date"
                  disabled={disabled}
                  onPress={() => handleAnchorChange("completion_date")}
                  className={`flex-1 items-center rounded-lg p-2.5 ${
                    value.anchor === "completion_date"
                      ? "bg-blue-600"
                      : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      value.anchor === "completion_date"
                        ? "text-white"
                        : "text-black dark:text-white"
                    }`}
                  >
                    After completion
                  </Text>
                </Pressable>
              </View>
              {isCompletionAnchored ? (
                <Text className="mt-1.5 text-xs text-neutral-500 dark:text-neutral-400">
                  Repeats after task is completed. Completion-anchored tasks are open-ended and do not have weekday, month-day, or end conditions.
                </Text>
              ) : null}
            </View>
          ) : null}

          {/* Frequency Selector */}
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Frequency
            </Text>
            <View className="flex-row gap-2">
              {SUPPORTED_FREQUENCIES.map((freq) => {
                const isSelected = value.frequency === freq;
                return (
                  <Pressable
                    key={freq}
                    testID={`freq-${freq.toLowerCase()}`}
                    disabled={disabled}
                    onPress={() => handleFrequencyChange(freq)}
                    className={`flex-1 items-center rounded-lg p-2.5 ${
                      isSelected
                        ? "bg-blue-600"
                        : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        isSelected ? "text-white" : "text-black dark:text-white"
                      }`}
                    >
                      {FREQUENCY_LABELS[freq]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>

          {/* Interval Input */}
          <View>
            <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
              Repeat Every
            </Text>
            <View className="flex-row items-center gap-3">
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">Every</Text>
              <TextInput
                testID="interval-input"
                editable={!disabled}
                keyboardType="number-pad"
                value={String(value.interval || 1)}
                onChangeText={handleIntervalChange}
                className="w-16 rounded-lg border border-neutral-300 bg-white p-2 text-center text-sm font-semibold text-black dark:border-neutral-700 dark:bg-black dark:text-white"
              />
              <Text className="text-sm font-medium text-black dark:text-white">
                {intervalUnit}
              </Text>
            </View>
          </View>

          {/* Weekday Selection (Weekly & Due-Date Anchored) */}
          {!isCompletionAnchored && value.frequency === "WEEKLY" ? (
            <View>
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Repeat on
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {SUPPORTED_WEEKDAYS.map((day) => {
                  const isSelected = value.weekdays.includes(day);
                  return (
                    <Pressable
                      key={day}
                      testID={`weekday-${day}`}
                      disabled={disabled}
                      onPress={() => handleWeekdayToggle(day)}
                      className={`h-9 w-9 items-center justify-center rounded-full ${
                        isSelected
                          ? "bg-blue-600"
                          : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                      }`}
                    >
                      <Text
                        className={`text-xs font-semibold ${
                          isSelected ? "text-white" : "text-black dark:text-white"
                        }`}
                      >
                        {WEEKDAY_LABELS[day]}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ) : null}

          {/* Month Day Input (Monthly & Due-Date Anchored) */}
          {!isCompletionAnchored && value.frequency === "MONTHLY" ? (
            <View>
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Day of Month
              </Text>
              <View className="flex-row items-center gap-3">
                <Text className="text-sm text-neutral-600 dark:text-neutral-300">On day</Text>
                <TextInput
                  testID="month-day-input"
                  editable={!disabled}
                  keyboardType="number-pad"
                  placeholder="1-31"
                  placeholderTextColor="#888"
                  value={value.monthDay != null ? String(value.monthDay) : ""}
                  onChangeText={handleMonthDayChange}
                  className="w-20 rounded-lg border border-neutral-300 bg-white p-2 text-center text-sm font-semibold text-black dark:border-neutral-700 dark:bg-black dark:text-white"
                />
                <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                  (Leave empty for default monthly)
                </Text>
              </View>
            </View>
          ) : null}

          {/* End Condition Selector (Due-Date Anchored only) */}
          {!isCompletionAnchored ? (
            <View>
              <Text className="mb-2 text-xs font-semibold uppercase tracking-wider text-neutral-500 dark:text-neutral-400">
                Ends
              </Text>
              <View className="flex-row gap-2">
                <Pressable
                  testID="end-never"
                  disabled={disabled}
                  onPress={() => handleEndModeChange("never")}
                  className={`flex-1 items-center rounded-lg p-2.5 ${
                    value.endMode === "never"
                      ? "bg-blue-600"
                      : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      value.endMode === "never" ? "text-white" : "text-black dark:text-white"
                    }`}
                  >
                    Never
                  </Text>
                </Pressable>

                <Pressable
                  testID="end-until"
                  disabled={disabled}
                  onPress={() => handleEndModeChange("until")}
                  className={`flex-1 items-center rounded-lg p-2.5 ${
                    value.endMode === "until"
                      ? "bg-blue-600"
                      : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      value.endMode === "until" ? "text-white" : "text-black dark:text-white"
                    }`}
                  >
                    On date
                  </Text>
                </Pressable>

                <Pressable
                  testID="end-count"
                  disabled={disabled}
                  onPress={() => handleEndModeChange("count")}
                  className={`flex-1 items-center rounded-lg p-2.5 ${
                    value.endMode === "count"
                      ? "bg-blue-600"
                      : "bg-white border border-neutral-300 dark:border-neutral-700 dark:bg-neutral-800"
                  }`}
                >
                  <Text
                    className={`text-sm font-medium ${
                      value.endMode === "count" ? "text-white" : "text-black dark:text-white"
                    }`}
                  >
                    After
                  </Text>
                </Pressable>
              </View>

              {/* End Details */}
              {value.endMode === "until" ? (
                <View className="mt-3 flex-row items-center gap-3">
                  <Text className="text-sm text-neutral-600 dark:text-neutral-300">Until date:</Text>
                  <TextInput
                    testID="until-date-input"
                    editable={!disabled}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#888"
                    value={value.untilDate ?? ""}
                    onChangeText={handleUntilDateChange}
                    className="flex-1 rounded-lg border border-neutral-300 bg-white p-2 text-sm text-black dark:border-neutral-700 dark:bg-black dark:text-white"
                  />
                </View>
              ) : null}

              {value.endMode === "count" ? (
                <View className="mt-3 flex-row items-center gap-3">
                  <Text className="text-sm text-neutral-600 dark:text-neutral-300">End after:</Text>
                  <TextInput
                    testID="count-input"
                    editable={!disabled}
                    keyboardType="number-pad"
                    placeholder="Occurrences"
                    placeholderTextColor="#888"
                    value={value.count != null ? String(value.count) : "1"}
                    onChangeText={handleCountChange}
                    className="w-20 rounded-lg border border-neutral-300 bg-white p-2 text-center text-sm font-semibold text-black dark:border-neutral-700 dark:bg-black dark:text-white"
                  />
                  <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                    {value.count === 1 ? "occurrence" : "occurrences"}
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
