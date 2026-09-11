import { AISDKError } from "ai";

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
 *
 * CHECKPOINT 8.6B ADDITION -- STRUCTURAL DETECTION FOR THE AI SDK.
 *
 * The 8.6B design audit (finding #23) found that `AI_APICallError` was absent
 * from the name-only allowlist below, so its `message` -- which for a
 * content-policy rejection can quote the request back -- would have survived
 * into this serializer's output. Rather than enumerating the AI SDK's ~40
 * error subclasses by name (a list a future SDK minor version would silently
 * grow past), every one of them extends the SDK's own exported `AISDKError`
 * base class (verified against the installed `ai@7.0.66`: `new
 * APICallError(...) instanceof AISDKError` is `true`, and its `name` is
 * `"AI_APICallError"`). `err instanceof AISDKError` is therefore preferred
 * here over name matching, per this checkpoint's instruction to prefer
 * structural detection where practical -- it is authored by whichever
 * provider or adapter threw it, never by this codebase, exactly like the
 * five hand-named classes below.
 */

/** Error classes whose `message` is authored upstream, not by us. */
const PROVIDER_ERROR_NAMES: ReadonlySet<string> = new Set([
  "GoogleOAuthError",
  "GoogleCalendarApiError",
  "CalDavError",
  "GoogleHealthOAuthError",
  "GoogleHealthApiError",
  // Phase 7. GmailApiError already destroys the provider's message in its own
  // constructor, and GmailOAuthError constructs one from an error token -- so
  // neither should carry prose in the first place. They are listed anyway
  // because this allowlist is the layer that must hold when a constructor is
  // later changed by someone who has not read that comment.
  "GmailOAuthError",
  "GmailApiError",
]);

/**
 * Whether `err`'s message is authored by an upstream AI provider/SDK rather
 * than by this codebase -- true for the five hand-named classes above, and
 * structurally true for EVERY AI SDK error via `instanceof AISDKError` (see
 * the comment above `PROVIDER_ERROR_NAMES`).
 */
function isProviderAuthoredError(err: Error): boolean {
  return PROVIDER_ERROR_NAMES.has(err.name || "Error") || err instanceof AISDKError;
}

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
  const isProviderAuthored = isProviderAuthoredError(err);

  // A `pg` error's `code` is a SQLSTATE; anything else shaped like a short
  // machine token is equally safe. Free text is not echoed.
  const rawCode: unknown = (err as { code?: unknown }).code;
  const code =
    typeof rawCode === "string" && /^[A-Za-z0-9_]{1,40}$/.test(rawCode) ? rawCode : undefined;

  return {
    type,
    message: isProviderAuthored ? `[${type} message withheld]` : err.message,
    // Withheld entirely for provider-authored errors. A stack's own frames are
    // near-worthless for these (they land inside undici), and `framesOnly`
    // alone was NOT sufficient -- see its comment.
    stack: isProviderAuthored || err.stack === undefined ? "" : framesOnly(err),
    ...(code === undefined ? {} : { code }),
  };
}

/**
 * Removes the message header from a stack, then keeps only frame lines.
 *
 * V8 formats a stack as `<name>: <message>\n    at ...`, so the header is a
 * verbatim copy of the message and must go.
 *
 * Filtering for lines that look like frames is NOT enough on its own, and an
 * adversarial review of this file proved it: a message containing a line of its
 * own shaped like `    at attacker (leak-<secret>.js:1:1)` passes that filter
 * intact. So the header is removed by LENGTH first -- it is exactly
 * `${name}: ${message}`, however many lines that spans -- and the frame filter
 * is the second layer rather than the only one.
 *
 * Provider-authored errors never reach here at all; their stack is withheld
 * outright, so this defence only has to hold for messages we wrote ourselves.
 */
function framesOnly(err: Error): string {
  const stack = err.stack ?? "";
  const header = `${err.name}: ${err.message}`;
  const body = stack.startsWith(header) ? stack.slice(header.length) : stack;
  return body
    .split("\n")
    .filter((line) => line.trimStart().startsWith("at "))
    .join("\n");
}
