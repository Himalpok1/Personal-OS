import {
  readStoredParseFailure,
  readStoredParseResult,
  type InboxItem,
  type ParserToolCall,
} from "@personal-os/schema";
import { formatFieldLabel } from "@/components/datetime-field-state";

// Turns `inbox_items.parse_result` -- `jsonb`, `unknown` on the wire -- into
// lines a person can read. Before Checkpoint 9.3 the Inbox tab rendered it as
// `JSON.stringify(item.parse_result)`, which on the Rabbit R1's 480px screen is
// two lines of braces and quotes that nobody reads.
//
// Every value is placed into a <Text>; nothing is interpreted. Titles and
// bodies are the parser's paraphrase of the owner's own capture. The `reason`
// on an `unclear` result is likewise derived from the owner's text; the API
// deliberately never ECHOES it in a refusal (ADR-060), but on the item's own
// detail screen it is the one sentence explaining why nothing was filed.

export interface ParseSummaryLine {
  label: string;
  value: string;
}

// Same class capture-intent/normalize.ts and build-correction.ts strip.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/** Preview length for a note body on a summary line. */
export const SUMMARY_PREVIEW_MAX_CHARS = 140;

function preview(value: string, maxChars: number = SUMMARY_PREVIEW_MAX_CHARS): string {
  const oneLine = value.replace(CONTROL_CHARACTERS, "").replace(/\s+/g, " ").trim();
  if (oneLine.length <= maxChars) return oneLine;
  return `${oneLine.slice(0, maxChars - 1).trimEnd()}…`;
}

function instant(value: string | undefined): string | null {
  if (value === undefined) return null;
  // formatFieldLabel returns null for an unparseable value; fall back to the
  // raw string rather than dropping the line, since an offset-less
  // FlexibleDatetime the parser emitted is still informative as text.
  return formatFieldLabel(value) ?? preview(value, 40);
}

/**
 * Copy for the closed confidence-flag vocabulary (packages/core
 * parse-confidence.ts). An unknown token is shown verbatim rather than
 * dropped, so a flag added upstream is visible before this map learns it.
 */
const FLAG_COPY: Record<string, string> = {
  typeAmbiguous: "unsure whether this is a task, note or event",
  unresolvedDatePhrase: "mentions a date it couldn't resolve",
  recurrenceInferred: "inferred a repeat rule (always confirmed the first time)",
  modelUnclear: "the parser couldn't classify it",
  degenerateTitle: "the title is too short",
  unknownProjectReference: "mentions a project that doesn't exist",
  lowTranscriptionConfidence: "the transcription was unclear",
};

export function describeConfidenceFlags(flags: readonly string[]): string | null {
  if (flags.length === 0) return null;
  return flags.map((flag) => FLAG_COPY[flag] ?? flag).join("; ");
}

function summarizeToolCall(call: ParserToolCall): ParseSummaryLine[] {
  const lines: ParseSummaryLine[] = [];
  switch (call.tool) {
    case "create_task": {
      const { args } = call;
      lines.push({ label: "Task", value: preview(args.title) });
      const due = instant(args.due_at);
      if (due) lines.push({ label: "Due", value: due });
      const remind = instant(args.remind_at);
      if (remind) lines.push({ label: "Reminder", value: remind });
      if (args.priority !== undefined) lines.push({ label: "Priority", value: `P${args.priority}` });
      if (args.project) lines.push({ label: "Project", value: preview(args.project) });
      if (args.rrule) {
        const anchor =
          args.recurrence_anchor === "completion_date" ? " (after each completion)" : "";
        lines.push({ label: "Repeats", value: `${preview(args.rrule, 80)}${anchor}` });
      }
      return lines;
    }
    case "create_note": {
      const { args } = call;
      lines.push({ label: "Note", value: preview(args.title) });
      const body = preview(args.body);
      if (body.length > 0) lines.push({ label: "Body", value: body });
      if (args.project) lines.push({ label: "Project", value: preview(args.project) });
      return lines;
    }
    case "create_event": {
      const { args } = call;
      lines.push({ label: "Event", value: preview(args.title) });
      if (args.all_day) lines.push({ label: "All day", value: "yes" });
      const start = instant(args.start);
      if (start) lines.push({ label: "Starts", value: start });
      const end = instant(args.end);
      if (end) lines.push({ label: "Ends", value: end });
      if (args.location) lines.push({ label: "Where", value: preview(args.location) });
      if (args.rrule) lines.push({ label: "Repeats", value: preview(args.rrule, 80) });
      return lines;
    }
    case "unclear":
      lines.push({ label: "Couldn't classify", value: preview(call.args.reason) });
      return lines;
  }
}

/**
 * Human-readable lines for a stored parse result. Empty when there is nothing
 * stored (a `pending` item) or the value is in no shape any reader knows.
 * Never returns JSON.
 */
export function summarizeParseResult(parseResult: unknown): ParseSummaryLine[] {
  const lines: ParseSummaryLine[] = [];
  const stored = readStoredParseResult(parseResult);
  if (stored !== null) {
    lines.push(...summarizeToolCall(stored.toolCall));
    const flags = describeConfidenceFlags(stored.confidenceFlags);
    if (flags) lines.push({ label: "Flagged because", value: flags });
  }

  const failure = readStoredParseFailure(parseResult);
  if (failure !== null) {
    const when = formatFieldLabel(failure.failed_at);
    lines.push({
      label: "Filing failed",
      value: `Gave up after repeated attempts${when ? ` on ${when}` : ""}.`,
    });
  } else if (stored === null && isLegacyErrorShape(parseResult)) {
    // The `{error}` shape capture.parse writes when no AI provider is
    // configured. The message is server-authored, but a fixed sentence says
    // what to do about it and echoes nothing.
    lines.push({ label: "Filing failed", value: "No AI provider was available to parse this." });
  }

  return lines;
}

function isLegacyErrorShape(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "error" in value &&
    typeof (value as { error: unknown }).error === "string"
  );
}

/** One line for a list row: the parsed entity and its title, or the failure. */
export function parseSummaryHeadline(item: Pick<InboxItem, "parse_result">): string | null {
  const lines = summarizeParseResult(item.parse_result);
  const first = lines[0];
  return first ? `${first.label}: ${first.value}` : null;
}
