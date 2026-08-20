import { createRequire } from "node:module";
import type * as RRuleModule from "rrule";
import {
  resolveWallClockToInstant,
  toWallClockComponents,
  wallClockToNaiveDate,
  type WallClockComponents,
} from "../timezone.js";

// See due-date-window.ts for why this isn't a plain named import.
const require = createRequire(import.meta.url);
const rrulePkg = require("rrule") as typeof RRuleModule;
const { RRule, RRuleSet, rrulestr } = rrulePkg;

import { validateCompletionAnchoredRule } from "./editor.js";
export { validateCompletionAnchoredRule };

export interface CompletionAnchoredRule {
  rrule: string;
  recurrenceTimezone: string;
}

export interface NextLazyOccurrenceResult {
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

// Anchored strictly from fromInstant -- a task completed three weeks late
// still generates its next occurrence three days (say) after the actual
// completion, never from the original due date it missed. fromStatus is
// accepted (rather than folded away) because "completed" vs "skipped" is
// meaningful to callers/audit logs even though the date math is identical
// either way -- both anchor from the same instant per ARCHITECTURE.md.
export function computeNextLazyOccurrence(
  rule: CompletionAnchoredRule,
  fromInstant: Date,
  fromStatus: "completed" | "skipped",
): NextLazyOccurrenceResult {
  if (fromStatus !== "completed" && fromStatus !== "skipped") {
    throw new Error(`invalid fromStatus "${String(fromStatus)}"`);
  }
  validateCompletionAnchoredRule(rule.rrule);

  const fromLocal = toWallClockComponents(fromInstant, rule.recurrenceTimezone);
  const dtstart = wallClockToNaiveDate(fromLocal);
  const parsed = rrulestr(rule.rrule, { dtstart, forceset: false });
  if (parsed instanceof RRuleSet) {
    throw new Error("computeNextLazyOccurrence expects a single RRULE, not a compound rule set");
  }

  const rr = new RRule({ ...parsed.origOptions, dtstart, until: null, count: 2 });
  const [, next] = rr.all();
  if (!next) {
    throw new Error(`could not compute next occurrence for rule "${rule.rrule}"`);
  }

  const occursLocal = fromFloatingDate(next);
  return { occursAt: resolveWallClockToInstant(occursLocal, rule.recurrenceTimezone), occursLocal };
}
