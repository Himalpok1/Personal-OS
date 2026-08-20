import type { EventRangeItem } from "@personal-os/schema";
import { Text, View } from "react-native";
import { DayCell } from "./day-cell";
import { dayKey, getMonthGridDays, groupEntriesByDay } from "./grid-math";

// Builds the full 4-6 row day grid (always complete weeks, leading/trailing
// days from adjacent months included) and buckets `entries` per day via
// grid-math.ts's pure groupEntriesByDay. This component does NOT fetch data
// -- `entries` is expected to already be scoped to the visible range by the
// caller (a screen file, out of this checkpoint's scope). No third-party
// calendar library, per docs/ARCHITECTURE.md's locked "Charts and dense
// tables are the weak spot ... pick cross-platform-capable libraries" /
// "no CSS grid on RN Web" guidance -- built with plain View + NativeWind
// flexbox instead.
export interface MonthGridProps {
  month: Date;
  entries: EventRangeItem[];
  onDayPress: (date: Date) => void;
  onEntryPress: (entry: EventRangeItem) => void;
}

const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function isSameCalendarDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function MonthGrid({ month, entries, onDayPress, onEntryPress }: MonthGridProps) {
  const days = getMonthGridDays(month);
  const rangeStart = days[0]!;
  const rangeEnd = days[days.length - 1]!;
  const buckets = groupEntriesByDay(entries, rangeStart, rangeEnd);
  const today = new Date();

  const rows: Date[][] = [];
  for (let i = 0; i < days.length; i += 7) {
    rows.push(days.slice(i, i + 7));
  }

  return (
    <View className="flex-1">
      <View className="flex-row border-b border-neutral-200 dark:border-neutral-800">
        {WEEKDAY_LABELS.map((label) => (
          <View key={label} className="flex-1 items-center py-1">
            <Text className="text-[10px] font-medium text-neutral-500 dark:text-neutral-400">
              {label}
            </Text>
          </View>
        ))}
      </View>
      {rows.map((week, rowIndex) => (
        <View key={rowIndex} className="flex-row">
          {week.map((date) => {
            const key = dayKey(date);
            return (
              <DayCell
                key={key}
                date={date}
                isCurrentPeriod={date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear()}
                isToday={isSameCalendarDay(date, today)}
                entries={buckets.get(key) ?? []}
                onPress={onDayPress}
                onEntryPress={onEntryPress}
              />
            );
          })}
        </View>
      ))}
    </View>
  );
}
