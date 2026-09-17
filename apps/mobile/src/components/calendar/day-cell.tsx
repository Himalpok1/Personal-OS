import type { EventRangeItem } from "@personal-os/schema";
import { Pressable, View } from "react-native";
import { AppText } from "@/components/ui";

// Presentational only, no data fetching -- entries are pre-bucketed by the
// caller (month-grid.tsx, via grid-math.ts's groupEntriesByDay) and handed
// in as exactly this day's entries. Sized for the Rabbit R1's 480px-wide
// screen down to a 7-column grid (~68px/cell), same "generic small-screen
// styling, no vendor checks" precedent as the rest of apps/mobile (see
// docs/STATUS.md's Phase 3 Checkpoint 3 note on hardware-input isolation).
//
// Checkpoint 10.3: colours come from the design tokens -- the cell sits on
// `surface` (or the `canvas` when it belongs to an adjacent month), today is
// a `primary-container` disc with `on-primary-container` text, and an entry
// pill is a `primary-container` well. There is no calendar-cell primitive in
// components/ui/, so the token classes are written here, the same way the
// primitives write them.
export interface DayCellProps {
  date: Date;
  isCurrentPeriod: boolean;
  isToday: boolean;
  entries: EventRangeItem[];
  onPress: (date: Date) => void;
  onEntryPress: (entry: EventRangeItem) => void;
}

// Above this many entries, switch from title chips to compact dots -- a
// small cell can realistically show 2-3 titles before it needs scroll
// affordance this component deliberately doesn't add (that's a detail-view
// concern, not a grid-cell one).
const MAX_TITLE_ENTRIES = 2;

const CELL_CLASS =
  "min-h-[64px] flex-1 border-b border-r border-outline p-1 dark:border-outline-dark";
const CURRENT_PERIOD_CLASS = "bg-surface dark:bg-surface-dark";
const OTHER_PERIOD_CLASS = "bg-canvas dark:bg-canvas-dark";
const TODAY_DISC_CLASS = "bg-primary-container dark:bg-primary-container-dark";
const TODAY_TEXT_CLASS =
  "font-semibold text-on-primary-container dark:text-on-primary-container-dark";
const ENTRY_PILL_CLASS =
  "rounded bg-primary-container px-1 py-0.5 active:opacity-70 dark:bg-primary-container-dark";
const ENTRY_TEXT_CLASS =
  "text-[10px] leading-[13px] text-on-primary-container dark:text-on-primary-container-dark";

export function DayCell({
  date,
  isCurrentPeriod,
  isToday,
  entries,
  onPress,
  onEntryPress,
}: DayCellProps) {
  const dayNumber = date.getDate();
  const visibleEntries = entries.slice(0, MAX_TITLE_ENTRIES);
  const overflowCount = entries.length - visibleEntries.length;

  return (
    <Pressable
      onPress={() => onPress(date)}
      // No `button` role on the cell itself: each event chip inside it is
      // its own button (with its own label), and a button inside a button is
      // invalid HTML on web (the same rule ListRow's `containsControl`
      // documents). HEAD carried no role here either; the label still reads.
      // ", today" in the label: the tinted circle was the only signal for
      // which day is today, i.e. meaning conveyed by color alone (6.7A, AY6).
      accessibilityLabel={`${date.toDateString()}${isToday ? ", today" : ""}${entries.length > 0 ? `, ${entries.length} event${entries.length === 1 ? "" : "s"}` : ""}`}
      className={`${CELL_CLASS} ${isCurrentPeriod ? CURRENT_PERIOD_CLASS : OTHER_PERIOD_CLASS}`}
    >
      <View
        className={`h-6 w-6 items-center justify-center rounded-full ${
          isToday ? TODAY_DISC_CLASS : ""
        }`}
      >
        <AppText
          variant="caption"
          tone={isToday ? "inherit" : isCurrentPeriod ? "default" : "muted"}
          className={isToday ? TODAY_TEXT_CLASS : ""}
        >
          {dayNumber}
        </AppText>
      </View>

      <View className="mt-1 gap-0.5">
        {visibleEntries.map((entry) => (
          <Pressable
            key={entry.id + (entry.occurs_at ?? entry.starts_at ?? entry.start_date ?? "")}
            onPress={(e) => {
              // Stop the tap from also triggering the cell's onPress
              // (tap-to-create) -- both handlers are on nested Pressables.
              e.stopPropagation();
              onEntryPress(entry);
            }}
            hitSlop={4}
            accessibilityRole="button"
            accessibilityLabel={entry.title}
            className={ENTRY_PILL_CLASS}
          >
            <AppText
              variant="caption"
              tone="inherit"
              numberOfLines={1}
              className={ENTRY_TEXT_CLASS}
            >
              {entry.title}
            </AppText>
          </Pressable>
        ))}
        {overflowCount > 0 ? (
          <AppText variant="caption" tone="muted" className="text-[10px] leading-[13px]">
            +{overflowCount} more
          </AppText>
        ) : null}
      </View>
    </Pressable>
  );
}
