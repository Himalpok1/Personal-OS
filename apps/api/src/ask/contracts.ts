// Cloud Ask -- shared contracts (Checkpoint 8.6B, ADR-056/8.6B design doc).
//
// Frozen before authorize/select-context/redact/prompt/generate are written,
// following the Brief and mail digest precedent: one definition every module
// builds against, nothing here reads the database or calls a provider.

/** The `ai_task_routes.task_name` this feature resolves. Its ROW'S PRESENCE is the switch itself. */
export const ASK_TASK_NAME = "ask";

// ---------------------------------------------------------------------------
// Retrieval bounds (design doc §7)
// ---------------------------------------------------------------------------

/** Total records sent to the model, across both types combined. */
export const ASK_MAX_RECORDS = 8;
/** Records of any ONE type (task or note) that may be selected before capping to the total. */
export const ASK_MAX_PER_TYPE = 5;
/** A record's title, after control-stripping and redaction, truncated to this. */
export const ASK_TITLE_MAX_CHARS = 120;
/** A record's body, after control-stripping and redaction, truncated to this. */
export const ASK_BODY_MAX_CHARS = 1500;
/**
 * Whole-context ceiling, measured on the EXACT serialized string embedded in
 * the prompt -- not a structural approximation of it. The 8.6B design review
 * found the Daily Brief measures a compact JSON.stringify but SENDS a pretty
 * one two lines later, an unrecorded defect Ask must not repeat.
 */
export const ASK_MAX_CONTEXT_CHARS = 12000;

// ---------------------------------------------------------------------------
// Generation bounds
// ---------------------------------------------------------------------------

export const ASK_ATTEMPT_TIMEOUT_MS = 30_000;
export const ASK_MAX_OUTPUT_TOKENS = 800;
/** Hard ceiling on the returned answer, applied by the shared output filter. */
export const ASK_MAX_ANSWER_CHARS = 4000;

// ---------------------------------------------------------------------------
// Error taxonomy
// ---------------------------------------------------------------------------
//
// Every message is STATIC. A raw provider/SDK error can echo request headers
// or body -- and this lane's request body can carry note/task text -- so no
// provider text may become an error message, a log line, or a response field.
// server.ts's setErrorHandler only passes a thrown error's own statusCode
// through when it is 4xx, so the two 5xx classes below are caught and replied
// to explicitly by the route, exactly like BriefGenerationTimeoutError and
// BriefGenerationFailedError.

export class AskDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = "cloud_ask_disabled";
  constructor() {
    super("Cloud Ask is not enabled");
    this.name = "AskDisabledError";
  }
}

/**
 * Route present, but the configured connection is disabled or otherwise
 * unusable (resolve-model.ts's `loadModel` throws a plain Error for this --
 * never NoProviderConfiguredError, which means "no route at all" and is
 * mapped to AskDisabledError above instead, per the design's "two 409s for
 * one state" resolution).
 */
export class AskProviderDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = "no_provider_configured";
  constructor() {
    super("the configured AI provider is unavailable");
    this.name = "AskProviderDisabledError";
  }
}

export class AskNoRelevantContextError extends Error {
  readonly statusCode = 422;
  readonly code = "no_relevant_context";
  constructor() {
    super("nothing in the corpus matched the question");
    this.name = "AskNoRelevantContextError";
  }
}

export class AskInFlightError extends Error {
  readonly statusCode = 429;
  readonly code = "ask_in_flight";
  constructor() {
    super("an Ask request is already in progress");
    this.name = "AskInFlightError";
  }
}

export class AskTimeoutError extends Error {
  readonly statusCode = 504;
  readonly code = "ask_timeout";
  constructor() {
    super("AI provider request timed out");
    this.name = "AskTimeoutError";
  }
}

export class AskGenerationFailedError extends Error {
  readonly statusCode = 502;
  readonly code = "ask_failed";
  constructor() {
    super("AI provider request failed");
    this.name = "AskGenerationFailedError";
  }
}
