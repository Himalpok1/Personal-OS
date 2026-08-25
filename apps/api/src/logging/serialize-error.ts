/**
 * A closed-allowlist replacement for pino's default `err` serializer.
 *
 * WHY THIS EXISTS
 * ---------------
 * `buildLoggerOptions` overrides only `req`. Fastify merges custom serializers
 * ON TOP of its own defaults (`logger-factory.js` does
 * `Object.assign({}, serializers, local.serializers)`), so `err` kept using
 * `pino.stdSerializers.err` -- which emits `{type, message, stack}` and then
 * copies EVERY own-enumerable property of the error onto the log object, and
 * finally attaches the untouched original as `.raw`.
 *
 * Two concrete consequences on this codebase:
 *
 *  - `CalDavError` carries `responseBody` -- the provider's full raw response
 *    body -- as an own property, and `GoogleOAuthError.message` is Google's own
 *    `error_description`. `GET /calendar-connections/:id/available-calendars`
 *    has no local catch, and neither class exposes a numeric `statusCode`, so
 *    both fall through to `server.ts`'s `request.log.error({ err })`.
 *  - A `pg` error carries `detail`, which literally reads
 *    `Failing row contains (...)` -- user-authored task titles, note bodies,
 *    capture text. Checkpoint 6.3 fixed exactly this for one worker job; the
 *    generic API handler never got the same treatment.
 *
 * The fix is an allowlist rather than a denylist: only the four fields below are
 * ever emitted, so a property nobody anticipated cannot ride along. That is the
 * difference between "we removed the leaks we found" and "a leak is
 * inexpressible".
 *
 * `message` is kept because we author every error the API itself throws and it
 * is the whole diagnostic value of a log line -- but it is dropped for the
 * provider error classes, which are the only ones whose message is written by
 * someone else. `stack` is reduced to frame lines: V8 puts the message on the
 * stack's first line too, so keeping the stack verbatim would reinstate the leak
 * through the back door.
 */

/** Error classes whose `message` is authored upstream, not by us. */
const PROVIDER_ERROR_NAMES: ReadonlySet<string> = new Set([
  "GoogleOAuthError",
  "GoogleCalendarApiError",
  "CalDavError",
  "GoogleHealthOAuthError",
  "GoogleHealthApiError",
]);

/**
 * `stack` is a required `string` because Fastify's own
 * `FastifyLoggerOptions["serializers"]["err"]` demands that exact shape --
 * making it optional makes the whole logger-options object fail to match
 * Fastify's overload, which silently resolves `Fastify()` to its HTTP/2
 * signature. An absent stack is therefore the empty string, not a missing key.
 */
export interface SerializedError {
  // Fastify's contract also carries `[key: string]: unknown`. It is reproduced
  // here so the options object matches Fastify's overload -- WITHOUT it, TS
  // falls through to the HTTP/2 signature and every downstream FastifyInstance
  // annotation in the app stops matching.
  [key: string]: unknown;
  type: string;
  message: string;
  stack: string;
  code?: string;
}

export function serializeErrorForLog(err: unknown): SerializedError {
  if (!(err instanceof Error)) {
    return { type: typeof err, message: "non-Error value thrown", stack: "" };
  }

  const type = err.name || "Error";
  const isProviderAuthored = PROVIDER_ERROR_NAMES.has(type);

  // A `pg` error's `code` is a SQLSTATE; anything else shaped like a short
  // machine token is equally safe. Free text is not echoed.
  const rawCode: unknown = (err as { code?: unknown }).code;
  const code =
    typeof rawCode === "string" && /^[A-Za-z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined;

  return {
    type,
    message: isProviderAuthored ? `[${type} message withheld]` : err.message,
    stack: err.stack === undefined ? "" : framesOnly(err.stack),
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * Keeps only `    at ...` frame lines.
 *
 * V8 formats a stack as `<name>: <message>\n    at ...`, so the header line is a
 * verbatim copy of the message. Dropping every non-frame line removes it without
 * needing to know how many lines the header occupies (it is more than one for a
 * multi-line message).
 */
function framesOnly(stack: string): string {
  return stack
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
}
