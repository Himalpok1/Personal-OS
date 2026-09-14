import { createRequire } from "node:module";
import type * as RRuleModule from "rrule";
import { isValidTimezone } from "../timezone.js";
import { validateCompletionAnchoredRule } from "./lazy-next-occurrence.js";

// See due-date-window.ts for why this isn't a plain named import.
const require = createRequire(import.meta.url);
const rrulePkg = require("rrule") as typeof RRuleModule;
const { rrulestr, RRuleSet } = rrulePkg;

export interface ValidateRecurrenceRuleParams {
  rrule: string | null | undefined;
  recurrenceTimezone?: string | null;
  recurrenceUntil?: Date | null;
  recurrenceCount?: number | null;
  recurrenceExdates?: string[] | null;
  recurrenceAnchor?: "due_date" | "completion_date" | null;
  isTask?: boolean;
}

/**
 * Validates a recurrence rule against RFC 5545 syntax, Personal OS data model
 * constraints, and task/event semantics.
 */
export function validateRecurrenceRule(params: ValidateRecurrenceRuleParams): void {
  const {
    rrule,
    recurrenceTimezone,
    recurrenceUntil,
    recurrenceCount,
    recurrenceExdates,
    recurrenceAnchor,
    isTask = false,
  } = params;

  if (rrule === null || rrule === undefined || rrule.trim() === "") {
    if (recurrenceUntil != null) {
      throw new Error("recurrenceUntil cannot be set without an rrule");
    }
    if (recurrenceCount != null) {
      throw new Error("recurrenceCount cannot be set without an rrule");
    }
    if (recurrenceExdates != null && recurrenceExdates.length > 0) {
      throw new Error("recurrenceExdates cannot be set without an rrule");
    }
    if (recurrenceAnchor != null) {
      throw new Error("recurrenceAnchor cannot be set without an rrule");
    }
    return;
  }

  if (!isTask && recurrenceAnchor != null) {
    throw new Error("recurrenceAnchor is only supported for tasks");
  }

  if (!recurrenceTimezone || !isValidTimezone(recurrenceTimezone)) {
    throw new Error(`invalid recurrence timezone "${recurrenceTimezone}"`);
  }

  if (/(?:^|[;:])(?:UNTIL|COUNT)=/i.test(rrule)) {
    throw new Error(
      "RRULE string must not embed UNTIL or COUNT; use recurrenceUntil or recurrenceCount instead",
    );
  }

  if (recurrenceUntil != null && recurrenceCount != null) {
    throw new Error("recurrenceUntil and recurrenceCount are mutually exclusive");
  }

  if (recurrenceUntil != null && Number.isNaN(recurrenceUntil.getTime())) {
    throw new Error("recurrenceUntil must be a valid Date");
  }

  if (recurrenceCount != null) {
    if (!Number.isInteger(recurrenceCount) || recurrenceCount < 1) {
      throw new Error("recurrenceCount must be a positive integer");
    }
  }

  if (recurrenceExdates != null) {
    for (const exdate of recurrenceExdates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(exdate)) {
        throw new Error(`invalid exdate "${exdate}", expected YYYY-MM-DD`);
      }
    }
  }

  // rrulestr is a lenient parser: it accepts `INTERVAL=0`, `INTERVAL=-1` and
  // `INTERVAL=abc` verbatim (the value is never validated), and a rule with
  // no FREQ at all silently becomes YEARLY. None of those can be expanded --
  // INTERVAL=0 yields nothing, a negative interval never terminates -- so
  // they are rejected here, structurally, BEFORE the parse (Checkpoint 9.3).
  // Anything else (unknown FREQ, unknown parts, malformed BY* values) is
  // rrulestr's own rejection below.
  const bareParts = rrule
    .trim()
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((part) => {
      const eqIdx = part.indexOf("=");
      return {
        key: (eqIdx === -1 ? part : part.slice(0, eqIdx)).trim().toUpperCase(),
        value: eqIdx === -1 ? undefined : part.slice(eqIdx + 1).trim(),
      };
    });
  if (!bareParts.some((part) => part.key === "FREQ")) {
    throw new Error(`invalid RRULE syntax: "${rrule}" (FREQ is required)`);
  }
  for (const part of bareParts) {
    if (part.key === "INTERVAL" && !/^[1-9]\d*$/.test(part.value ?? "")) {
      throw new Error(`invalid RRULE syntax: "${rrule}" (INTERVAL must be a positive integer)`);
    }
  }

  let parsed;
  try {
    parsed = rrulestr(rrule, { forceset: false });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`invalid RRULE syntax: "${rrule}" (${msg})`, { cause: err });
  }

  if (parsed instanceof RRuleSet) {
    throw new Error("compound RRULE sets are not supported");
  }

  if (recurrenceAnchor === "completion_date") {
    if (recurrenceUntil != null) {
      throw new Error("completion-anchored recurrence rules do not support recurrenceUntil");
    }
    if (recurrenceCount != null) {
      throw new Error("completion-anchored recurrence rules do not support recurrenceCount");
    }
    if (recurrenceExdates != null && recurrenceExdates.length > 0) {
      throw new Error("completion-anchored recurrence rules do not support recurrenceExdates");
    }
    validateCompletionAnchoredRule(rrule);
  }
}

// Frequencies a TASK's due-date rule may not use (Checkpoint 9.4). rrule
// accepts them and the nightly window expansion would faithfully materialise
// a 90-day window of them -- 7.7 million rows for FREQ=SECONDLY -- with no
// budget at commit (the exposure 9.3 recorded as debt). The product offers
// nothing finer than "daily", so anything below it is rejected at write time.
const SUB_DAILY_FREQUENCIES = new Set(["SECONDLY", "MINUTELY", "HOURLY"]);

/**
 * Closed error tokens for validateTaskDueDateRule. They are the ONLY text the
 * message carries besides a fixed phrase -- never the rule itself -- so a
 * route can echo the message in a `400 validation_failed` without
 * reproducing request text (the error-token discipline of ADR-060).
 */
export type TaskDueDateRuleErrorCode = "unsupported_frequency" | "embedded_until_count";

export class TaskDueDateRuleError extends Error {
  readonly code: TaskDueDateRuleErrorCode;
  constructor(code: TaskDueDateRuleErrorCode, message: string) {
    super(message);
    this.name = "TaskDueDateRuleError";
    this.code = code;
  }
}

/**
 * Write-time validation of a task's `due_date`-anchored rule, as used by
 * POST /tasks and PATCH /tasks/:id (Checkpoint 9.4). Server-only -- it runs
 * the full rrulestr-backed validateRecurrenceRule first, so it lives on the
 * barrel and never on a client-safe subpath.
 *
 *   1. validateRecurrenceRule with `isTask: true` and the given zone: syntax,
 *      FREQ present, positive INTERVAL, no compound sets. This already
 *      rejects an embedded UNTIL/COUNT, but its message quotes the rule, so
 *      the embedded case is caught BEFORE it here with a token-only message.
 *   2. FREQ must be DAILY or coarser.
 *
 * Throws TaskDueDateRuleError (token-only message) for the two 9.4 rules and
 * re-throws validateRecurrenceRule's own errors for everything else. The
 * anchor check is the caller's: a completion-anchored rule goes through
 * validateCompletionAnchoredRule instead.
 */
export function validateTaskDueDateRule(
  rrule: string,
  recurrenceTimezone: string = "UTC",
  extras: Pick<
    ValidateRecurrenceRuleParams,
    "recurrenceUntil" | "recurrenceCount" | "recurrenceExdates"
  > = {},
): void {
  if (/(?:^|[;:])(?:UNTIL|COUNT)=/i.test(rrule)) {
    throw new TaskDueDateRuleError(
      "embedded_until_count",
      "task recurrence rule must not embed UNTIL or COUNT (embedded_until_count)",
    );
  }

  validateRecurrenceRule({
    rrule,
    recurrenceTimezone,
    recurrenceAnchor: "due_date",
    isTask: true,
    ...extras,
  });

  const freqPart = rrule
    .trim()
    .replace(/^RRULE:/i, "")
    .split(";")
    .map((part) => part.trim())
    .find((part) => /^FREQ=/i.test(part));
  const freq = freqPart?.slice("FREQ=".length).trim().toUpperCase() ?? "";
  if (SUB_DAILY_FREQUENCIES.has(freq)) {
    throw new TaskDueDateRuleError(
      "unsupported_frequency",
      "task recurrence rule frequency must be DAILY or coarser (unsupported_frequency)",
    );
  }
}
