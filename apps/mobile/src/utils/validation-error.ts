import { ApiClientError } from "@personal-os/api-client";

// One human line for a rejected form field (Checkpoint 9.6, ADR-065).
//
// A user-typed write over a content bound is REFUSED, never truncated, and it
// can be refused in two places that used to be indistinguishable on screen:
//
//   1. Server-side: `400 validation_failed` with `issues[]` -- the Zod issues
//      the API's error handler returns verbatim (apps/api/src/server.ts).
//      Every `.max()` in the Create/Update schemas carries `tooLongMessage`,
//      "<field> must be at most N characters", so the message IS the copy.
//   2. Client-side: the api-client runs `XCreateSchema.parse(body)` BEFORE the
//      request (packages/api-client/src/tasks.ts and siblings), so an
//      over-bound body throws a raw ZodError that never reaches the network.
//      Before 9.6 every form fell through to its generic line -- "check your
//      connection" for a body that was simply too long.
//
// The ZodError is recognised by SHAPE (`name === "ZodError"` and an `issues`
// array) rather than `instanceof`: apps/mobile does not depend on zod
// directly, and the instance would come from the schema package's copy
// anyway. Only the FIRST issue is described -- one line, on a 480 px screen.
//
// Nothing here echoes a value. The output is built from the issue's field
// path and its bound; the text the owner typed is never part of it.

const TOO_LONG_MESSAGE = /^[\w.]+ must be at most \d+ characters$/;

interface IssueLike {
  code?: unknown;
  path?: unknown;
  message?: unknown;
  maximum?: unknown;
  origin?: unknown;
}

/** The Zod issue list carried by a server 400 or a client-side parse throw, if any. */
function validationIssues(error: unknown): IssueLike[] | null {
  if (error instanceof ApiClientError) {
    if (error.code !== "validation_failed") return null;
    return Array.isArray(error.issues) ? (error.issues as IssueLike[]) : [];
  }
  if (error instanceof Error && error.name === "ZodError") {
    const issues = (error as Error & { issues?: unknown }).issues;
    if (Array.isArray(issues)) return issues as IssueLike[];
  }
  return null;
}

/** `["title"]` → "title"; `["calendar", "connection_id"]` → "calendar.connection_id". */
function fieldName(path: unknown): string | null {
  if (!Array.isArray(path)) return null;
  const parts = path.filter(
    (segment): segment is string | number =>
      typeof segment === "string" || typeof segment === "number",
  );
  return parts.length === 0 ? null : parts.join(".");
}

/**
 * A human line for a validation failure, or null when `error` is not one --
 * so every caller keeps its own copy for connection failures, 404s and the
 * rest:
 *
 *   describeValidationError(err) ?? "Couldn't save those changes. Please try again."
 *
 * The server's `tooLongMessage` shape is used verbatim ("title must be at
 * most 512 characters"); a `too_big` string issue with a default Zod message
 * is rebuilt into the same shape from its `maximum`; anything else names the
 * field and says only that it isn't valid.
 */
export function describeValidationError(error: unknown): string | null {
  const issues = validationIssues(error);
  if (issues === null) return null;
  const first = issues[0];
  if (!first) return "Something in the form isn't valid.";
  const field = fieldName(first.path);
  if (typeof first.message === "string" && TOO_LONG_MESSAGE.test(first.message)) {
    return first.message;
  }
  if (
    field !== null &&
    first.code === "too_big" &&
    first.origin === "string" &&
    typeof first.maximum === "number"
  ) {
    return `${field} must be at most ${first.maximum} characters`;
  }
  return field === null ? "Something in the form isn't valid." : `${field} isn't valid`;
}
