// The worker's structured logger.
//
// ===========================================================================
// WHY THIS EXISTS, AND WHY IT HAD TO EXIST BEFORE MAIL DATA REACHED A WORKER
// ===========================================================================
//
// apps/api has had logger discipline since Checkpoint 6.2: a custom `req`
// serializer emitting four allowlisted fields, added after the discovery that
// Fastify logs the request URL at `lib/route.js:522` -- 39 lines BEFORE any
// `onRequest` hook could scrub it -- and that the `redact.paths` entries
// everyone assumed were protecting request bodies were no-ops, because the
// default serializer never emitted a body in the first place.
//
// apps/worker has had none of that. `docs/STATUS.md` records it as standing
// debt: "worker top-level console.error lacks serializer discipline". Until now
// that was survivable, because a worker log line could at worst carry a health
// value or a capture's text.
//
// Phase 7 changes what is at stake. Mail metadata is the first ATTACKER-AUTHORED
// input to reach this process (ADR-054): a subject line and a display name are
// chosen by a stranger, and ADR-054 states plainly that "no email subject,
// address or display name may appear in a push body, a log line, a commit
// message or any status document". `console.error("sync failed", err)` on a
// path holding a message payload would violate that in one call.
//
// ---------------------------------------------------------------------------
// THE GUARANTEE, STATED HONESTLY
//
// Three layers, in decreasing order of strength:
//
//   1. STRUCTURAL, at the type level. `LogFields` accepts scalars only. There
//      is no way to pass an Error, a payload object, a row, or an array -- so
//      the single most common leak (`{ err }`, whose pino/serialize-error
//      equivalents walk every enumerable property, `detail` included) is not
//      expressible. `errorToken` is the only route from an error to a log, and
//      it emits a token.
//   2. A FIELD-NAME DENYLIST. A field called `subject`, `from`, `address`,
//      `token`... is dropped whatever its value, because the NAME already says
//      the value should not be here.
//   3. A VALUE-SHAPE FILTER. A string containing whitespace, "@", quotes or
//      angle brackets is replaced with a marker. That excludes prose, email
//      addresses and header values while passing uuids, ISO instants, machine
//      tokens and counts.
//
// The residual, said out loud rather than glossed: a single bare word is
// indistinguishable from a machine token, so a one-word subject ("Invoice")
// passed under a non-denylisted field name would survive layer 3. Layers 1 and
// 2 are what actually carry the guarantee; layer 3 is defence in depth. No
// mail code passes provider strings to this logger at all, and
// `no-raw-console.test.ts` pins that no new `console.*` call appears to route
// around it.

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
 * leaked subject line is permanent.
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
];

/**
 * A value shape that cannot express prose, an address, or a header.
 *
 * No whitespace (excludes every subject line of more than one word), no "@"
 * (excludes every email address), no quotes or angle brackets (excludes a
 * `From:` header verbatim). Bounded at 200 so nothing large lands in a log
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
 * literally "Failing row contains (...)" -- the whole row, subject line
 * included. An error's `message` is provider-controlled on every path that
 * matters. So neither crosses.
 *
 * Prefers a SQLSTATE when there is one (five upper-case alphanumerics, which is
 * what actually tells you a constraint fired), falls back to the error's class
 * name, and emits `unknown` for anything else. Same discipline as
 * `HealthSyncJobError`, which carries a SQLSTATE and nothing else.
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
 * the "no raw console" rule has exactly one sanctioned exception.
 */
export interface LogSink {
  write(level: LogLevel, record: Record<string, unknown>): void;
}

const consoleSink: LogSink = {
  write(level, record) {
    const line = JSON.stringify(record);
    // THE SINGLE SANCTIONED console CALL SITE in apps/worker. Everything else
    // routes through this module; no-raw-console.test.ts fails if a new one
    // appears anywhere else, and fails too if this one ever disappears -- a
    // scan that found nothing would otherwise pass while nothing was being
    // written at all.
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
