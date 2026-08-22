import { isValidTimezone, toWallClockComponents } from "./timezone.js";

// Review periods are identified by the frozen pair (kind, period_start) where
// period_start is a LOCAL calendar date string (YYYY-MM-DD) in the capture's
// timezone -- never a UTC timestamp -- so the identity is stable across DST
// transitions and identical wall-clock days always collide into one period.

const PERIOD_START = /^(\d{4})-(\d{2})-(\d{2})$/;

function assertValidTimezone(timezone: string): void {
  if (!isValidTimezone(timezone)) {
    throw new Error(`invalid IANA timezone "${timezone}"`);
  }
}

function formatPeriodStart(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

interface LocalDate {
  year: number;
  month: number;
  day: number;
}

function parsePeriodStart(periodStart: string): LocalDate {
  const match = PERIOD_START.exec(periodStart);
  if (!match) {
    throw new Error(`invalid period_start "${periodStart}", expected YYYY-MM-DD`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  // Round-trip rejects semantic nonsense the regex alone accepts
  // (e.g. "2026-02-30", "2026-13-01"): Date.UTC overflows instead of throwing.
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    throw new Error(`invalid period_start "${periodStart}", not a real calendar date`);
  }
  return { year, month, day };
}

function shiftPeriodStart(periodStart: string, days: number): string {
  const { year, month, day } = parsePeriodStart(periodStart);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return formatPeriodStart(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

function localDateOf(timezone: string, at?: Date): LocalDate {
  const { year, month, day } = toWallClockComponents(at ?? new Date(), timezone);
  return { year, month, day };
}

// Weekday derived from the LOCAL calendar date via a floating Date.UTC
// construction, so the host OS locale/timezone never leaks into the result.
function localWeekday(date: LocalDate): number {
  return new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
}

export function dailyPeriodStart(timezone: string, at?: Date): string {
  assertValidTimezone(timezone);
  const { year, month, day } = localDateOf(timezone, at);
  return formatPeriodStart(year, month, day);
}

export function weeklyPeriodStart(timezone: string, at?: Date): string {
  assertValidTimezone(timezone);
  const date = localDateOf(timezone, at);
  const weekday = localWeekday(date); // 0 = Sunday ... 6 = Saturday
  const backToMonday = weekday === 0 ? 6 : weekday - 1;
  const monday = new Date(Date.UTC(date.year, date.month - 1, date.day - backToMonday));
  return formatPeriodStart(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate());
}

export function nextDailyPeriodStart(timezone: string, periodStart: string): string {
  assertValidTimezone(timezone);
  return shiftPeriodStart(periodStart, 1);
}

export function nextWeeklyPeriodStart(timezone: string, periodStart: string): string {
  assertValidTimezone(timezone);
  return shiftPeriodStart(periodStart, 7);
}
