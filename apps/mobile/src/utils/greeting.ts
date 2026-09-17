// The Today header's words (Checkpoint 10.3). Pure and React-free, so the
// greeting and the "N things need attention" line are tested as data and
// (tabs)/index.tsx only lays them out.
//
// The hour is an INPUT, never read here: react-hooks/purity forbids a clock
// read in render, so the screen derives it from its query's `dataUpdatedAt`
// (the instant Today was fetched -- the closest thing the client has to the
// server's own `effective_now`) through `hourFromInstant`, and the greeting
// moves forward on every refetch rather than on every render.

export type GreetingPeriod = "morning" | "afternoon" | "evening" | "night";

/**
 * Morning 5–11, afternoon 12–16, evening 17–21, night 22–4. An hour outside
 * 0–23 is wrapped rather than rejected (25 → 1) so a caller can pass an
 * offset hour; a non-finite hour has no period.
 */
export function greetingPeriod(hour: number): GreetingPeriod | null {
  if (!Number.isFinite(hour)) return null;
  const h = ((Math.trunc(hour) % 24) + 24) % 24;
  if (h >= 5 && h <= 11) return "morning";
  if (h >= 12 && h <= 16) return "afternoon";
  if (h >= 17 && h <= 21) return "evening";
  return "night";
}

const GREETING: Record<GreetingPeriod, string> = {
  morning: "Good morning",
  afternoon: "Good afternoon",
  evening: "Good evening",
  night: "Good night",
};

/** "Good morning" / "Good afternoon" / "Good evening" / "Good night"; "Hello" when the hour is unreadable. */
export function greetingForHour(hour: number): string {
  const period = greetingPeriod(hour);
  return period === null ? "Hello" : GREETING[period];
}

/**
 * The device-local hour of an epoch-millisecond instant (a query's
 * `dataUpdatedAt`). `new Date(ms)` is a pure function of its argument, unlike
 * `new Date()`; a non-finite or non-positive instant (React Query reports 0
 * before the first fetch) yields NaN so the greeting falls back to "Hello"
 * rather than to 1970's hour.
 */
export function hourFromInstant(ms: number): number {
  if (!Number.isFinite(ms) || ms <= 0) return Number.NaN;
  return new Date(ms).getHours();
}

export interface AttentionSummary {
  overdue_total: number;
  due_today_total: number;
  inbox_attention_total: number;
}

/** Overdue + due today + inbox items needing attention -- the three counts a person can act on. */
export function attentionCount(summary: AttentionSummary): number {
  return summary.overdue_total + summary.due_today_total + summary.inbox_attention_total;
}

/**
 * "3 things need attention today" / "1 thing needs attention today" /
 * "All clear for today". Counts only, never a recomputation: every input is
 * the server's own `summary` total.
 */
export function importantThingsLine(summary: AttentionSummary): string {
  const count = attentionCount(summary);
  if (count <= 0) return "All clear for today";
  return count === 1 ? "1 thing needs attention today" : `${count} things need attention today`;
}
