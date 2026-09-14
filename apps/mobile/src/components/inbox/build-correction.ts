import { CAPTURE_TEXT_MAX_LENGTH, type ParserToolCall } from "@personal-os/schema";
import { formatInstantWithOffset } from "@personal-os/core/timezone";

// Builds the `corrected_tool_call` the owner supplies when the parser could
// not classify a capture (an `unclear` result, or a row the dead-letter
// handler finalized as `failed`). POST /inbox/:id/confirm already accepts a
// full ParserToolCall as the correction (Checkpoint 8.4, ADR-060); this is the
// client-side half that turns "file this as a task" into one.
//
// Nothing here INTERPRETS the text. It is control-stripped, whitespace-
// normalized and bounded, then placed into a title/body field. No date is
// parsed out of it, no route is derived from it, and it is never handed to a
// model -- the whole point of a manual correction is that the model already
// had its turn.

// C0 controls except tab and newline, DEL, and the C1 block -- the same class
// capture-intent/normalize.ts strips from shared text, written as escapes so
// this source file contains no control characters itself.
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;

/**
 * Bound on a title built from capture text.
 *
 * The server enforces no separate title bound (`TaskCreateSchema.title` is
 * `z.string().min(1)`); the only server-side ceiling a title inherits is
 * CAPTURE_TEXT_MAX_LENGTH on the capture itself. A 4,000-character task title
 * is legal and useless, so this caps at a length a list row can show. Anything
 * past it stays in the note BODY when filing as a note, and is simply not part
 * of the title when filing as a task or event -- the raw capture is retained
 * on the inbox row either way.
 */
export const FILE_AS_TITLE_MAX_CHARS = 200;

const ELLIPSIS = "…";

/** Strip controls FIRST, then bound -- the Checkpoint 8.1 ordering. */
function stripControls(raw: string): string {
  return raw.replace(CONTROL_CHARACTERS, "");
}

// A slice that ends on a high surrogate has split a pair; drop the dangling
// half rather than emit U+FFFD.
function endsWithDanglingHighSurrogate(value: string): boolean {
  if (value.length === 0) return false;
  const last = value.charCodeAt(value.length - 1);
  return last >= 0xd800 && last <= 0xdbff;
}

function capTitle(value: string, maxChars: number): string {
  if (value.length <= maxChars) return value;
  let slice = value.slice(0, maxChars - 1).trimEnd();
  if (endsWithDanglingHighSurrogate(slice)) slice = slice.slice(0, -1);
  return `${slice}${ELLIPSIS}`;
}

/**
 * A one-line title from free text: controls stripped, every run of whitespace
 * (newlines included) collapsed to one space, trimmed, then capped.
 * Empty input yields an empty string -- the caller decides that means
 * "nothing to file", never a placeholder title.
 */
export function titleFromText(raw: string, maxChars: number = FILE_AS_TITLE_MAX_CHARS): string {
  const collapsed = stripControls(raw).replace(/\s+/g, " ").trim();
  return capTitle(collapsed, maxChars);
}

/** The first non-blank line of the text, as a title. */
export function firstLineTitle(raw: string, maxChars: number = FILE_AS_TITLE_MAX_CHARS): string {
  const firstLine = stripControls(raw)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  return firstLine === undefined ? "" : titleFromText(firstLine, maxChars);
}

/** The full capture text as a body: controls stripped, trimmed, server-bounded. */
export function bodyFromText(raw: string): string {
  return stripControls(raw).slice(0, CAPTURE_TEXT_MAX_LENGTH).trim();
}

export interface TaskCorrectionOptions {
  /** Owner-edited title; falls back to the capture text when blank. */
  title?: string | null;
  /** Offset-bearing ISO instant from DateTimeField, or null for no due date. */
  dueAt?: string | null;
}

/** `create_task` from capture text. Null when there is no title to give it. */
export function buildTaskCorrection(
  rawText: string,
  options: TaskCorrectionOptions = {},
): ParserToolCall | null {
  const title = resolveTitle(options.title, () => titleFromText(rawText));
  if (title.length === 0) return null;
  const args: Extract<ParserToolCall, { tool: "create_task" }>["args"] = { title };
  if (options.dueAt) args.due_at = options.dueAt;
  return { tool: "create_task", args };
}

export interface NoteCorrectionOptions {
  title?: string | null;
}

/** `create_note`: title is the first line (or the edit), body is the whole text. */
export function buildNoteCorrection(
  rawText: string,
  options: NoteCorrectionOptions = {},
): ParserToolCall | null {
  const title = resolveTitle(options.title, () => firstLineTitle(rawText));
  if (title.length === 0) return null;
  return { tool: "create_note", args: { title, body: bodyFromText(rawText) } };
}

export const EVENT_DEFAULT_DURATION_MS = 60 * 60 * 1000;

export interface EventCorrectionOptions {
  title?: string | null;
  /** Offset-bearing ISO instant from DateTimeField. Required: an event needs a start. */
  start: string | null;
  /** IANA zone the end instant is rendered in; the device's zone by default. */
  timezone?: string;
}

/**
 * `create_event` from capture text, ending one hour after the chosen start.
 *
 * The end is computed on the INSTANT and re-rendered with the zone's own
 * offset for that instant, so an event that starts an hour before a DST
 * transition still ends sixty real minutes later rather than at a wall-clock
 * time that does not exist. Null when there is no title or no start.
 */
export function buildEventCorrection(
  rawText: string,
  options: EventCorrectionOptions,
): ParserToolCall | null {
  const title = resolveTitle(options.title, () => titleFromText(rawText));
  if (title.length === 0) return null;
  if (!options.start) return null;
  const startInstant = new Date(options.start);
  if (Number.isNaN(startInstant.getTime())) return null;
  const timezone = options.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const end = formatInstantWithOffset(
    new Date(startInstant.getTime() + EVENT_DEFAULT_DURATION_MS),
    timezone,
  );
  return { tool: "create_event", args: { title, start: options.start, end } };
}

function resolveTitle(edited: string | null | undefined, fallback: () => string): string {
  if (edited !== null && edited !== undefined) {
    const normalized = titleFromText(edited);
    if (normalized.length > 0) return normalized;
  }
  return fallback();
}

// ---------------------------------------------------------------------------
// The "File as" draft the detail screen edits. Lifted out of the view so the
// view stays hookless (see components/ask/cloud-ask-card.tsx on why) and so
// the draft -> tool-call step is a pure function with its own tests.
// ---------------------------------------------------------------------------

export type FileAsKind = "task" | "note" | "event";

export interface FileAsDraft {
  kind: FileAsKind | null;
  /** Owner-editable title; seeded by `defaultTitleFor` when a kind is chosen. */
  title: string;
  /** Task due (optional), as an offset-bearing ISO instant. */
  dueAt: string | null;
  /** Event start (required), as an offset-bearing ISO instant. */
  startAt: string | null;
}

export const EMPTY_FILE_AS_DRAFT: FileAsDraft = { kind: null, title: "", dueAt: null, startAt: null };

/** The title the draft is seeded with when a kind is chosen. */
export function defaultTitleFor(kind: FileAsKind, rawText: string): string {
  return kind === "note" ? firstLineTitle(rawText) : titleFromText(rawText);
}

/**
 * The tool call a draft submits, or null when it is not submittable yet (no
 * kind chosen, no title, or an event with no start). The submit button is
 * disabled exactly when this is null.
 */
export function buildCorrectionFromDraft(
  rawText: string,
  draft: FileAsDraft,
  timezone?: string,
): ParserToolCall | null {
  switch (draft.kind) {
    case null:
      return null;
    case "task":
      return buildTaskCorrection(rawText, { title: draft.title, dueAt: draft.dueAt });
    case "note":
      return buildNoteCorrection(rawText, { title: draft.title });
    case "event":
      return buildEventCorrection(rawText, {
        title: draft.title,
        start: draft.startAt,
        ...(timezone === undefined ? {} : { timezone }),
      });
  }
}
