// Checkpoint 9.7 -- wall-clock formatting for the Today context (ADR-066).
//
// Every time the model sees is `YYYY-MM-DD HH:mm` in the REQUEST zone, so the
// model never converts a zone and an instant never enters the prompt. Built
// on packages/core's Intl-backed `toWallClockComponents` rather than any Date
// getter, so the host's own zone plays no part and DST is whatever the zone
// says it is for that instant (an instant inside a fall-back repeat hour
// formats to the wall clock the zone displays for it; there is no
// ambiguity in that direction).
import { toWallClockComponents } from "@personal-os/core/timezone";

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** `YYYY-MM-DD HH:mm` for `instant` as displayed in `tz`. */
export function formatWallClock(instant: Date | string, tz: string): string {
  const date = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(date.getTime())) throw new Error("formatWallClock: invalid instant");
  const c = toWallClockComponents(date, tz);
  return `${String(c.year).padStart(4, "0")}-${pad2(c.month)}-${pad2(c.day)} ${pad2(c.hour)}:${pad2(c.minute)}`;
}

/** `HH:mm` only -- for a citation `detail`, where the date is implied by the section. */
export function formatWallTime(instant: Date | string, tz: string): string {
  return formatWallClock(instant, tz).slice(11);
}

/** `MM-DD` only -- for a citation `detail` on a completed item. */
export function formatWallMonthDay(instant: Date | string, tz: string): string {
  return formatWallClock(instant, tz).slice(5, 10);
}
