// User-facing copy for a Canvas connection's last sync failure.
//
// Direct sibling of `mail/sync-error-copy.ts` and `calendar/sync-error-copy.ts`,
// and it exists for the same recorded reason: the API stores a CODE, never a
// message -- `packages/schema/src/canvas.ts`'s file header documents
// `canvas_connections.last_sync_error` as "a SANITIZED CLASSIFICATION TOKEN
// ... the mail_sync_runs precedent this mirrors exactly" -- so this map is
// the ONLY place a Canvas sync failure acquires words. Interpolating what the
// server sent is exactly the defect the calendar version of this file was
// written to replace.
//
// ============================================================================
// WHY THIS FILE CANNOT ITERATE A CLOSED ENUM THE WAY mailSyncErrorCopy DOES
// ============================================================================
//
// Unlike `MailSyncErrorCodeSchema`, Canvas has no closed Zod enum for this
// column. `CanvasSyncTokenSchema` (packages/schema/src/canvas.ts) is a SHAPE
// -- a lowercase machine token, optionally one `:`-qualifier -- not a finite
// vocabulary, because the same column also stores
// `canvas_sync_runs.failure_class`/`error_message` under the identical
// token contract, and those need room for a qualified token like
// `provider_error:503` (see apps/worker/src/canvas/run.ts).
//
// The actual CLOSED set of values this app's own worker classifier ever
// produces is `CanvasFailureClass`
// (packages/canvas-providers/src/canvas-client.ts): `auth_failed`,
// `rate_limited`, `not_found`, `provider_error`, `network_error`,
// `blocked_url`. That type is duplicated below rather than imported:
// `canvas-providers` is this
// integration's HTTP client, meant to run in `apps/api`/`apps/worker`, and
// this project's own standing convention is near-duplication of a small
// closed shape per provider over a cross-boundary dependency (ADR-052/068's
// stated reasoning for the identical choice elsewhere) -- not, as with the
// server-only packages named in AGENTS.md, that it is structurally unsafe to
// import from a client bundle.
//
// The `Record<CanvasFailureClass, string>` below is what enforces
// exhaustiveness here instead of a runtime enum walk: TypeScript refuses to
// compile this file if a member of that union is missing, the same guarantee
// mail's `for (const code of MailSyncErrorCodeSchema.options)` test gives at
// runtime.

type CanvasFailureClass =
  | "auth_failed"
  | "rate_limited"
  | "not_found"
  | "provider_error"
  | "network_error"
  | "blocked_url";

/**
 * Every sentence says what the owner can DO, or explicitly says nothing is
 * required of them -- the same rule `mail/sync-error-copy.ts` states and for
 * the same reason: "Personal OS will retry" is not filler, and without it a
 * transient failure reads as a chore.
 */
const COPY: Record<CanvasFailureClass, string> = {
  auth_failed:
    "Canvas rejected the saved access token. Reconnect with a fresh one to resume syncing.",
  rate_limited: "Canvas is rate-limiting Personal OS. It will retry on its own.",
  not_found: "A course or item Personal OS was tracking no longer exists on Canvas.",
  provider_error: "A recent sync didn't finish. Personal OS will try again on its own.",
  network_error: "Canvas couldn't be reached. Personal OS will retry on its own.",
  blocked_url:
    "Personal OS refused to contact this Canvas address for safety reasons. Disconnect and reconnect with the correct address.",
};

/**
 * A safe sentence for a Canvas sync-error token, or null when there is
 * nothing to report.
 *
 * A qualified token (`provider_error:503`) is matched on its base member --
 * the qualifier is diagnostic detail meant for a log line, never for this
 * screen. An unrecognised base falls back to the `provider_error` sentence,
 * matching `mailSyncErrorCopy`'s own fallback, so a worker that gains a token
 * before the app is rebuilt still renders words rather than a raw string.
 *
 * NULL AND THE `provider_error` SENTENCE ARE DIFFERENT ANSWERS and this
 * function keeps them apart: null means "no error", the sentence means "an
 * error we cannot name more precisely".
 */
export function canvasSyncErrorCopy(token: string | null | undefined): string | null {
  if (token === null || token === undefined || token === "") return null;
  const base = token.split(":")[0] as CanvasFailureClass;
  return COPY[base] ?? COPY.provider_error;
}
