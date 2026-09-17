// The shared structured logger for both server processes.
//
// ===========================================================================
// WHY THIS LIVES IN core RATHER THAN IN apps/worker (WHERE IT WAS BORN)
// ===========================================================================
//
// This module started as `apps/worker/src/logger.ts`. apps/api has had partial
// logger discipline since Checkpoint 6.2 (a custom `req` serializer), but no
// general-purpose guarded logger of its own -- which is why the Daily Brief
// lane has never emitted `ai.usage`. Checkpoint 8.6B needs exactly this
// guarantee in `apps/api` for the Ask lane, and `apps/api` may never import
// from `apps/worker` (the two are separate processes whose only interface is
// Postgres and pg-boss, per docs/ARCHITECTURE.md). So the implementation moves
// here -- ONE copy, TWO consumers -- and both `apps/worker/src/logger.ts` and
// `apps/api/src/logging/logger.ts` are now thin re-exports of this module. The
// Daily Brief inherits the fix for free.
//
// Nothing here imports a Node builtin, so it is safe under the same `./*`
// deep-subpath convention `./ai/*`, `./mail/*` and `./search/*` already use --
// though in practice only the two server processes ever import `./logging/*`;
// apps/mobile has no reason to and does not.
//
// ---------------------------------------------------------------------------
// THE GUARANTEE, STATED HONESTLY
//
// Three layers, in decreasing order of strength:
//
//   1. STRUCTURAL, at the type level. `LogFields` accepts scalars only. There
//      is no way to pass an Error, a payload object, a row, or an array -- so
//      the single most common leak (`{ err }`, whose pino/serialize-error
//      equivalents walk every enumerable property) is not expressible.
//      `errorToken` is the only route from an error to a log, and it emits a
//      token.
//   2. A FIELD-NAME DENYLIST. A field called `subject`, `from`, `address`,
//      `token`... is dropped whatever its value, because the NAME already says
//      the value should not be here.
//   3. A VALUE-SHAPE FILTER. A string containing whitespace, "@", quotes or
//      angle brackets is replaced with a marker. That excludes prose, email
//      addresses and header values while passing uuids, ISO instants, machine
//      tokens and counts.
//
// The residual, said out loud rather than glossed: a single bare word is
// indistinguishable from a machine token, so a one-word value ("Invoice")
// passed under a non-denylisted field name would survive layer 3. Layers 1 and
// 2 are what actually carry the guarantee; layer 3 is defence in depth.

export type LogLevel = "info" | "warn" | "error";

/**
 * Scalars only. This is the load-bearing type in the file: it makes
 * `log.error("mail.sync.failed", { err })` a COMPILE error rather than a leak
 * to be caught in review.
 */
export type LogValue = string | number | boolean | null | undefined;
export type LogFields = Record<string, LogValue>;

/**
 * Field names that are dropped whatever they contain.
 *
 * Matched on the LOWERCASED name and as a substring, so `fromDisplayName`,
 * `messageSubject` and `accessToken` are all caught. Over-matching is the
 * intended failure mode: a dropped diagnostic costs a debugging session, a
 * leaked subject line or a leaked prompt is permanent.
 */
const FORBIDDEN_FIELD_FRAGMENTS: readonly string[] = [
  "subject",
  "sender",
  "recipient",
  "address",
  "email",
  "mailbox",
  "displayname",
  "body",
  "snippet",
  "header",
  "payload",
  "token",
  "secret",
  "password",
  "credential",
  "ciphertext",
  "authtag",
  "authorization",
  "apikey",
  "cursor",
  "raw",
  // Checkpoint 8.6B additions -- the Ask lane's own vocabulary. A "question"
  // is user-authored free text and a "prompt"/"answer" is the exact material
  // this whole feature exists to keep out of a log line. Deliberately NOT
  // "context" or "source": the Ask lane's required counts-only fields
  // (`contextChars`, `sourceCount`) contain those as substrings, and a name
  // fragment that shadows its own required field would be a self-inflicted
  // bug, not a guarantee. A full-content "context"/"sources" value could only
  // ever be an array/object, which `LogFields`' scalar-only type already makes
  // impossible to pass at all (layer 1), and any full-text string value still
  // fails the value-shape filter (layer 3).
  "question",
  "prompt",
  "answer",
  // Checkpoint 10.7 (ADR-077 §6): a memory's `statement` is the owner's most
  // deliberately authored text. Counts-only logging is the contract; the name
  // fragment is the backstop. No route in the tree logs a field of this name
  // for any other purpose (verified by grep before adding).
  "statement",
];

/**
 * A value shape that cannot express prose, an address, or a header.
 *
 * No whitespace (excludes every subject line or sentence of more than one
 * word), no "@" (excludes every email address), no quotes or angle brackets
 * (excludes a header verbatim). Bounded at 200 so nothing large lands in a log
 * whatever its shape.
 */
const SAFE_VALUE = /^[A-Za-z0-9_.:/+=-]{1,200}$/;

const REDACTED = "[redacted]";
const FORBIDDEN = "[forbidden-field]";

/** Event names are machine tokens: `mail.sync.started`, not a sentence. */
const EVENT_NAME = /^[a-z][a-z0-9_]*(\.[a-z0-9_]+)*$/;

function isForbiddenName(name: string): boolean {
  const lower = name.toLowerCase();
  return FORBIDDEN_FIELD_FRAGMENTS.some((fragment) => lower.includes(fragment));
}

function sanitizeValue(value: LogValue): string | number | boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : REDACTED;
  return SAFE_VALUE.test(value) ? value : REDACTED;
}

/**
 * Builds the object that is serialized. Exported for the tests, which assert on
 * the RECORD rather than on captured stdout -- asserting on a spied
 * `console.log` would test the spy, and asserting on the config would be the
 * exact mistake Checkpoint 6.2 caught in the API (a config-level assertion
 * passes happily while a code is still being written to disk).
 */
export function buildLogRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    ts: now.toISOString(),
    level,
    // A non-token event name is itself suspicious -- it means someone passed a
    // sentence where a name belongs, and a sentence is where prose hides.
    event: EVENT_NAME.test(event) ? event : REDACTED,
  };
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined) continue;
    record[key] = isForbiddenName(key) ? FORBIDDEN : sanitizeValue(value);
  }
  return record;
}

/**
 * Reduces any thrown value to a single safe token.
 *
 * THE ONLY ROUTE FROM AN ERROR TO A LOG LINE, and deliberately lossy. A `pg`
 * DatabaseError carries `detail`, which for a CHECK or unique violation is
 * literally "Failing row contains (...)" -- the whole row. An AI SDK
 * `APICallError` carries `requestBodyValues` -- the whole prompt -- as an own
 * property. An error's `message` is provider-controlled on every path that
 * matters. So none of these cross.
 *
 * Prefers a SQLSTATE when there is one (five upper-case alphanumerics, which is
 * what actually tells you a constraint fired), falls back to the error's class
 * name, and emits `unknown` for anything else.
 */
export function errorToken(err: unknown): string {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = String(err.code);
    if (/^[A-Z0-9]{5}$/.test(code)) return code;
  }
  if (err instanceof Error && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(err.name)) return err.name;
  return "unknown";
}

/**
 * The sink. Separated so tests can capture without spying on globals, and so
 * the "no raw console" rule has exactly one sanctioned exception per process.
 */
export interface LogSink {
  write(level: LogLevel, record: Record<string, unknown>): void;
}

const consoleSink: LogSink = {
  write(level, record) {
    const line = JSON.stringify(record);
    // THE SINGLE SANCTIONED console CALL SITE for this logger. Everything
    // downstream of `log.*` routes through this module; each consumer's own
    // "no raw console" guard excludes its local re-export shim and instead
    // asserts THIS file is where the sanctioned call actually lives.
    if (level === "error") console.error(line);
    else if (level === "warn") console.warn(line);
    else console.log(line);
  },
};

let sink: LogSink = consoleSink;

/** Replaces the sink. Returns a function restoring the previous one. */
export function setLogSink(next: LogSink): () => void {
  const previous = sink;
  sink = next;
  return () => {
    sink = previous;
  };
}

function emit(level: LogLevel, event: string, fields?: LogFields): void {
  sink.write(level, buildLogRecord(level, event, fields));
}

export const log = {
  info: (event: string, fields?: LogFields): void => emit("info", event, fields),
  warn: (event: string, fields?: LogFields): void => emit("warn", event, fields),
  error: (event: string, fields?: LogFields): void => emit("error", event, fields),
};
