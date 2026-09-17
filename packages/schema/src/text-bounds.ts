// Content bounds for every user-authored (and LLM/provider-authored) free-text
// field that reaches tasks, notes, events, projects and inbox_items
// (Checkpoint 9.6, ADR-065).
//
// ===========================================================================
// WHY ONE FILE, AND WHY IN THIS PACKAGE
// ===========================================================================
//
// Until 9.6 the only bounded entity text was `capture.text` (4000). Task,
// note, event and project text was `z.string()` all the way down to a plain
// Postgres `text` column, so one paste could put a megabyte into a title.
// Mail already had the discipline this file generalises
// (packages/core/src/mail/provider-strings.ts): a named constant, asserted in
// Zod at the boundary, and re-applied at write by any path that bypasses Zod.
//
// The constants live in `@personal-os/schema` -- not core -- because every
// client-side producer (mobile TextInput maxLength, the share-intent
// normaliser, the inbox file-as form) must bound against the SAME number the
// server enforces. That is the CAPTURE_TEXT_MAX_LENGTH precedent.
//
// ===========================================================================
// THE CONTRACT
// ===========================================================================
//
//   USER-TYPED text (POST/PATCH bodies, corrected tool calls) is REJECTED
//   when over the bound: `400 validation_failed` with the field path. A person
//   typing is the only party who can decide what to cut, so the server never
//   cuts for them.
//
//   PROVIDER- or MODEL-AUTHORED text (calendar sync ingest, the PTT
//   transcript, the parser's tool-call output) is TRUNCATED AT WRITE to the
//   same bound, surrogate-safely, with a counts-only log line. Rejecting a
//   third party's oversized calendar description would drop the whole event
//   from the owner's calendar view, and rejecting a long transcript would
//   lose the whole capture -- both are worse than keeping the first N chars of
//   text the owner did not write and can re-read at the source.
//
//   Lengths are UTF-16 code units (`string.length`), the unit both Zod
//   `.max()` and React Native `maxLength` count in, so the client and server
//   agree by construction.
//
//   The bounds apply to CREATE/UPDATE/tool schemas only. The read schemas
//   (TaskSchema, NoteSchema, EventSchema, ProjectSchema) are reused to parse
//   responses and the export, and a legacy row written before 9.6 must keep
//   reading back; a bound there would turn history into a 500.

/** Task titles, note titles, event titles, project names, parser-emitted titles. */
export const ENTITY_TITLE_MAX_CHARS = 512;

/** Task body (notes about a task). Same as a capture: it is often one. */
export const TASK_BODY_MAX_CHARS = 4000;

/** Note body -- the one field with a deliberately larger allowance. */
export const NOTE_BODY_MAX_CHARS = 20_000;

/** Event description, local and synced alike. */
export const EVENT_DESCRIPTION_MAX_CHARS = 4000;

/** Event location (an address or a room, not a document). */
export const EVENT_LOCATION_MAX_CHARS = 512;

/** Project goal / description. */
export const PROJECT_GOAL_MAX_CHARS = 2000;

/**
 * The parser's `unclear.reason` and `create_task.project` reference. Model
 * prose that is persisted into `inbox_items.parse_result` only; never a row.
 */
export const PARSER_REASON_MAX_CHARS = 1000;
export const PARSER_PROJECT_REF_MAX_CHARS = 200;

/** Human-facing message used by every `.max()` below so the client can key on it. */
export function tooLongMessage(field: string, max: number): string {
  return `${field} must be at most ${max} characters`;
}

/**
 * Checkpoint 10.7 (ADR-077): a memory's statement -- one sentence the owner
 * wants Personal OS to keep ("I work best in the evening"). User-typed, so
 * REJECTED over the bound, never truncated. Deliberately shorter than a task
 * body: a memory is a fact or a preference, not a document.
 */
export const MEMORY_STATEMENT_MAX_CHARS = 1000;

/** A memory's optional free-text note (why it matters, when it changed). */
export const MEMORY_NOTE_MAX_CHARS = 2000;
