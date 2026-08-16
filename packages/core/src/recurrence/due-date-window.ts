import { createRequire } from "node:module";
import type * as RRuleModule from "rrule";
import {
  resolveWallClockToInstant,
  toWallClockComponents,
  wallClockToNaiveDate,
  type WallClockComponents,
} from "../timezone.js";

// rrule@2.8.1 ships CJS with no "exports" map and no declared default
// export, but Node's ESM<->CJS named-export interop (cjs-module-lexer)
// fails to statically detect its named exports at runtime even though the
// package's own .d.ts declares them -- `import { RRule } from "rrule"`
// type-checks fine but throws at runtime ("does not provide an export
// named 'RRule'"). A direct require() sidesteps that static analysis
// entirely; the type-only import above recovers full type safety from the
// package's own declared shape without pulling in a runtime import.
const require = createRequire(import.meta.url);
const rrulePkg = require("rrule") as typeof RRuleModule;
const { RRule, RRuleSet, rrulestr } = rrulePkg;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface DueDateRecurrenceRule {
  /** RFC 5545 RRULE string, e.g. "FREQ=MONTHLY;BYMONTHDAY=15" -- must not
   * embed UNTIL; use recurrenceUntil instead. */
  rrule: string;
  recurrenceTimezone: string;
  /** Wall-clock start of the series. For an all-day rule, pass hour: 12
   * (noon) to keep every generated instance safely away from any DST
   * transition boundary. */
  dtstart: WallClockComponents;
  /** Real instant cutoff (the tasks/events.recurrence_until column). */
  recurrenceUntil?: Date;
  recurrenceCount?: number;
  /** Calendar dates (YYYY-MM-DD) to exclude, matched against the rule's own
   * time-of-day. */
  recurrenceExdates?: string[];
}

export interface ExpandedOccurrence {
  occursAt: Date;
  occursLocal: WallClockComponents;
}

function fromFloatingDate(date: Date): WallClockComponents {
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: date.getUTCHours(),
    minute: date.getUTCMinutes(),
    second: date.getUTCSeconds(),
  };
}

// RRule has no IANA timezone awareness: it only ever reads/writes a Date's
// *UTC* getters (see the rrule README's "Important: Use UTC dates"
// section). So the whole expansion runs in "floating" wall-clock space --
// dtstart's local components reinterpreted as if they were UTC -- and each
// generated instance is resolved to a real timestamptz only at the very
// end, per-occurrence, through recurrenceTimezone. Expanding from a single
// pre-resolved UTC dtstart would drift an hour across DST (see
// docs/ARCHITECTURE.md's recurrence design section) -- this function exists
// specifically to avoid that.
export function expandDueDateWindow(
  rule: DueDateRecurrenceRule,
  windowDays: number,
  now: Date,
): ExpandedOccurrence[] {
  const dtstartFloating = wallClockToNaiveDate(rule.dtstart);
  const parsed = rrulestr(rule.rrule, { dtstart: dtstartFloating, forceset: false });
  if (parsed instanceof RRuleSet) {
    throw new Error("expandDueDateWindow expects a single RRULE, not a compound rule set");
  }

  const rr = new RRule({
    ...parsed.origOptions,
    dtstart: dtstartFloating,
    // recurrence_until is a real instant applied as a post-filter below;
    // an embedded UNTIL in the rrule string would be floating-space and
    // therefore meaningless here.
    until: null,
    count: rule.recurrenceCount ?? parsed.origOptions.count ?? null,
  });

  const ruleSet = new RRuleSet();
  ruleSet.rrule(rr);
  for (const exdate of rule.recurrenceExdates ?? []) {
    const [year, month, day] = exdate.split("-").map(Number);
    if (year === undefined || month === undefined || day === undefined) {
      throw new Error(`invalid exdate "${exdate}", expected YYYY-MM-DD`);
    }
    ruleSet.exdate(
      new Date(
        Date.UTC(year, month - 1, day, rule.dtstart.hour, rule.dtstart.minute, rule.dtstart.second),
      ),
    );
  }

  const windowEndReal = new Date(now.getTime() + windowDays * MS_PER_DAY);
  // Padded by a day on each side: converting real instants to floating
  // bounds can skew by up to a UTC offset (~24h at most), and this is only
  // a cheap pre-filter -- the real cutoffs below are what actually decide
  // inclusion.
  const between = ruleSet.between(
    wallClockToNaiveDate(
      toWallClockComponents(new Date(now.getTime() - MS_PER_DAY), rule.recurrenceTimezone),
    ),
    wallClockToNaiveDate(
      toWallClockComponents(
        new Date(windowEndReal.getTime() + MS_PER_DAY),
        rule.recurrenceTimezone,
      ),
    ),
    true,
  );

  const occurrences: ExpandedOccurrence[] = [];
  for (const instance of between) {
    const occursLocal = fromFloatingDate(instance);
    const occursAt = resolveWallClockToInstant(occursLocal, rule.recurrenceTimezone);
    if (occursAt.getTime() < now.getTime()) continue;
    if (occursAt.getTime() > windowEndReal.getTime()) continue;
    if (rule.recurrenceUntil && occursAt.getTime() > rule.recurrenceUntil.getTime()) continue;
    occurrences.push({ occursAt, occursLocal });
  }
  return occurrences;
}
