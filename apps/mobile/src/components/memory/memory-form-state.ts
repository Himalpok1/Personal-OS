import {
  MEMORY_KINDS,
  type MemoryCreate,
  type MemoryItem,
  type MemoryKind,
  type MemoryUpdate,
} from "@personal-os/schema";
import { redactSecrets } from "@personal-os/core/ask/redact-secrets";

// Pure decisions behind the memory editor (Checkpoint 10.7, ADR-077): what
// the form may submit, how an edit diffs against the loaded row, and the
// honest "Used by" sentence per kind. No hook, no clock, no fetch.

export interface MemoryFormValues {
  kind: MemoryKind;
  statement: string;
  note: string;
  projectId: string | null;
  courseId: string | null;
}

export const EMPTY_MEMORY_FORM: MemoryFormValues = {
  kind: "preference",
  statement: "",
  note: "",
  projectId: null,
  courseId: null,
};

/** A `?kind=` route param, or the default -- never an unchecked string. */
export function coerceMemoryKindParam(value: unknown): MemoryKind {
  return typeof value === "string" && (MEMORY_KINDS as readonly string[]).includes(value)
    ? (value as MemoryKind)
    : EMPTY_MEMORY_FORM.kind;
}

/** A `?statement=` prefill: a string, trimmed, or empty. The bound is the input's `maxLength`. */
export function coerceStatementParam(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** The form a loaded memory opens with. */
export function memoryFormFromItem(memory: MemoryItem): MemoryFormValues {
  return {
    kind: memory.kind,
    statement: memory.statement,
    note: memory.note ?? "",
    projectId: memory.project_id,
    courseId: memory.canvas_course_id,
  };
}

/** Save is enabled only once the statement has a non-blank character. */
export function canSaveMemory(values: Pick<MemoryFormValues, "statement">): boolean {
  return values.statement.trim().length > 0;
}

/** `POST /memories` body. `source` is never sent (the server writes `user`). */
export function buildMemoryCreate(values: MemoryFormValues): MemoryCreate {
  const note = values.note.trim();
  return {
    kind: values.kind,
    statement: values.statement.trim(),
    ...(note.length > 0 ? { note } : {}),
    ...(values.projectId ? { project_id: values.projectId } : {}),
    ...(values.courseId ? { canvas_course_id: values.courseId } : {}),
  };
}

/**
 * `PATCH /memories/:id` body: only what changed against the loaded row, so
 * an untouched field is never re-sent (and `source`/`suggestion_id` cannot
 * be -- the update shape has no such keys). Null when nothing changed.
 */
export function buildMemoryUpdate(
  memory: MemoryItem,
  values: MemoryFormValues,
): MemoryUpdate | null {
  const patch: MemoryUpdate = {};
  if (values.kind !== memory.kind) patch.kind = values.kind;
  const statement = values.statement.trim();
  if (statement !== memory.statement) patch.statement = statement;
  const note = values.note.trim();
  const loadedNote = memory.note ?? "";
  if (note !== loadedNote) patch.note = note.length > 0 ? note : null;
  if (values.projectId !== memory.project_id) patch.project_id = values.projectId;
  if (values.courseId !== memory.canvas_course_id) patch.canvas_course_id = values.courseId;
  return Object.keys(patch).length === 0 ? null : patch;
}

/**
 * The "Used by" sentence (ADR-077 §5): memory reaches Focus Now only by
 * typed link, only as one of two named reasons, never for a fact. Said
 * plainly per kind, and honestly when the row is not linked to anything.
 */
export function memoryUsedByCopy(kind: MemoryKind, linked: boolean): string {
  if (kind === "fact") {
    return "Facts are kept for you to read. Focus Now doesn't score them.";
  }
  const reason = kind === "preference" ? "Matches your preference" : "Supports a goal";
  const base = `Focus Now can cite this as '${reason}' when an item is linked to the same project or course.`;
  return linked ? base : `${base} Link it to a project or course to make that possible.`;
}

/** The export page, on the same origin the client already talks to (ADR-077 §2). */
export function memoryExportUrl(apiBaseUrl: string): string {
  return `${apiBaseUrl.replace(/\/+$/, "")}/export`;
}

/**
 * ADR-077 §6's warn-only credential check. `redactSecrets` is the same
 * anchored, client-safe shape detector Ask uses before a question leaves the
 * device (API keys, bearer tokens, JWTs, private-key blocks). It is not a DLP
 * system and is never a gate: a memory is stored in the owner's own database
 * and never sent to a model, so the only honest response to a credential-
 * shaped statement is to SAY so and let the owner decide. Returns the caption
 * to show, or null. Counts only -- the matched text is never surfaced.
 */
export const MEMORY_CREDENTIAL_WARNING =
  "This looks like it contains a credential. Memories are stored in your own database and never sent to an AI model, but a password or key is safer in a password manager.";

export function memoryCredentialWarning(
  values: Pick<MemoryFormValues, "statement" | "note">,
): string | null {
  const { redactions } = redactSecrets(`${values.statement}\n${values.note}`);
  return redactions > 0 ? MEMORY_CREDENTIAL_WARNING : null;
}
