// Suggested Focus -- shared contracts (Checkpoint 9.8 design gate, approved
// D1-D5, extends ADR-066). Mirrors apps/api/src/ask/contracts.ts's
// class-per-error-code pattern.
//
// This lane deliberately reuses two of Ask's existing states rather than
// inventing parallel ones: "Cloud Ask disabled" (`cloud_ask_disabled`,
// applied here via `authorizeCloudAsk` returning null, exactly as
// routes/ask.ts replies to it directly with no error class of its own)
// and "the configured connection is unusable" (`AskProviderDisabledError`,
// imported directly from `../ask/contracts.js`) are genuinely the same
// underlying state -- Suggested Focus uses the SAME "ask" task route as its
// consent switch, no new `ai_task_routes` row, no new disclosure surface. The
// consent-vintage state (`AskConsentOutdatedError`) is reused the same way.

export const FOCUS_ATTEMPT_TIMEOUT_MS = 20_000;
export const FOCUS_MAX_OUTPUT_TOKENS = 150;
/** Hard ceiling on the returned suggestion, applied by the shared output filter. */
export const FOCUS_MAX_SUGGESTION_CHARS = 400;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------
//
// Every message is STATIC, matching ask/contracts.ts's discipline -- no
// provider/SDK text may become an error message, a log line, or a response
// field. server.ts's setErrorHandler only passes a thrown error's own
// statusCode through when it is 4xx, so the 5xx classes below are caught and
// replied to explicitly by the route.

/**
 * Fewer than `FOCUS_MIN_CANDIDATES` (overdue + due-today tasks) exist. The
 * route returns this state directly (`reply.code(409).send(...)`) rather than
 * throwing it, so the response body can carry `candidate_count` alongside the
 * error code -- this class exists for documentation/taxonomy parity with the
 * rest of this file and is not itself thrown on the primary path.
 */
export class FocusNotEnoughCandidatesError extends Error {
  readonly statusCode = 409;
  readonly code = "focus_not_enough_candidates";
  constructor() {
    super("not enough overdue or due-today tasks to suggest a focus");
    this.name = "FocusNotEnoughCandidatesError";
  }
}

export class FocusTimeoutError extends Error {
  readonly statusCode = 504;
  readonly code = "focus_timeout";
  constructor() {
    super("AI provider request timed out");
    this.name = "FocusTimeoutError";
  }
}

export class FocusGenerationFailedError extends Error {
  readonly statusCode = 502;
  readonly code = "focus_failed";
  constructor() {
    super("AI provider request failed");
    this.name = "FocusGenerationFailedError";
  }
}

/**
 * The model cited zero refs, more than one ref, or a ref that does not
 * resolve to a candidate in the overdue/due-today section set -- unlike Ask
 * (which tolerates zero citations for an empty day), Suggested Focus REQUIRES
 * exactly one citation, because its whole point is picking exactly one task.
 */
export class FocusUncitedAnswerError extends Error {
  readonly statusCode = 502;
  readonly code = "focus_uncited";
  constructor() {
    super("the suggestion did not cite exactly one candidate task");
    this.name = "FocusUncitedAnswerError";
  }
}
