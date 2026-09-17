// The Calendar tab's period label (Checkpoint 10.6).
//
// The tab's chrome is ONE row -- previous / label / next, the Month · Week ·
// Agenda control, and the new-event button -- so the grid gets the height a
// second row used to take. At the Rabbit R1's 480px the row only closes if
// the label is short, so the label has a compact form: the month is
// abbreviated ("Sep 2026") and the week keeps both ends but drops the year
// ("Sep 14–20", "Sep 28–Oct 4"). A wider window gets the full forms the
// tab has always shown. Pure, so both forms are pinned by a test; the
// "Jump to today" accessibility label on the pressable is unchanged.
import { format } from "date-fns";
import { getWeekDays } from "./week-grid-layout";

export type CalendarChromeMode = "month" | "week";

/** Below this width the compact forms are used. 480 + a margin, not the exact device width. */
export const CALENDAR_CHROME_COMPACT_MAX_WIDTH = 560;

export function calendarChromeLabel(
  mode: CalendarChromeMode,
  anchor: Date,
  compact: boolean,
): string {
  if (mode === "month") return format(anchor, compact ? "MMM yyyy" : "MMMM yyyy");

  const days = getWeekDays(anchor);
  const first = days[0]!;
  const last = days[days.length - 1]!;
  if (!compact) return `${format(first, "MMM d")} - ${format(last, "MMM d, yyyy")}`;

  const sameMonth =
    first.getMonth() === last.getMonth() && first.getFullYear() === last.getFullYear();
  return sameMonth
    ? `${format(first, "MMM d")}–${format(last, "d")}`
    : `${format(first, "MMM d")}–${format(last, "MMM d")}`;
}
