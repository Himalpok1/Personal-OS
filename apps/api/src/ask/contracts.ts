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
// Checkpoint 9.7 -- "Ask about today" bounds (ADR-066, design §9 D5)
// ---------------------------------------------------------------------------

/**
 * When a `<today>` block is present, the lexical `<records>` block shrinks to
 * this ceiling (measured on the same exact serialized string) so the two
 * together stay under `ASK_PROMPT_MAX_CHARS`. Without `tz` the 8.6B
 * `ASK_MAX_CONTEXT_CHARS` applies unchanged.
 *
 * 5 000, not 6 000: the 9.7 review did the arithmetic the first draft did
 * not. The worst-case USER prompt is TODAY_CONTEXT_MAX_CHARS (12 000) +
 * this + the 512-char question + 238 chars of framing (buildAskUserPrompt's
 * fixed text and fences). At 6 000 that is 18 750 > 18 000, so the ceiling
 * below was reachable and its "unreachable by construction" comment was
 * false. The owner-approved combined ceiling (18 000) is kept and this
 * budget is narrowed instead: 12 000 + 5 000 + 512 + 238 = 17 750 ≤ 18 000.
 */
export const ASK_RECORDS_MAX_CHARS_WITH_TODAY = 5000;
/** Record cap when `<today>` is present (else `ASK_MAX_RECORDS`). */
export const ASK_MAX_RECORDS_WITH_TODAY = 4;
/**
 * Ceiling on the CONCATENATED USER-role prompt (question + `<today>` +
 * `<records>` + framing), asserted in generate.ts on the exact string sent,
 * before the single transmission. The system prompt (≈ 3.5k chars, static,
 * user-content-free) is NOT counted against it. Worst case with Today
 * present is 12 000 + 5 000 + 512 + 238 = 17 750, so the assertion is a
 * guard against a future change to any of those four numbers, not a routine
 * path; without Today it is 12 000 + 512 + framing, far below.
 */
export const ASK_PROMPT_MAX_CHARS = 18000;

/**
 * Consent vintage. The 8.6B Cloud Ask disclosure described note/task bodies
 * only; 9.7 widens what may leave the machine to the Today context (schedule
 * scalars, event titles/locations, capture text). An `ask` task route whose
 * `created_at` is BEFORE this instant was consented under the 8.6B disclosure
 * and must not be widened silently: a `tz`-bearing request against such a row
 * is refused with `409 ask_consent_outdated` and the client routes to
 * Settings "Re-enable" (delete + re-create under the new text).
 *
 * INTEGRATOR: set this to the 9.7 production deploy instant (the value
 * below is a PLACEHOLDER). Tests never depend on the wall clock relative to
 * it: the route-test seed helper defaults `created_at` to this instant + 1 s,
 * and only the vintage tests pass explicit values. The 9.7 deploy
 * MUST occur AFTER this value -- a row created between this instant and the
 * deploy would be treated as 9.7-consented although the owner only ever saw
 * the 8.6B text. Rows created before it were consented under 8.6B.
 */
export const ASK_TODAY_CONSENT_FROM = "2026-09-15T03:00:00Z";

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
//
// Three states in this taxonomy have no class here: a disabled route
// (`cloud_ask_disabled`, when `authorizeCloudAsk` returns null), no matching
// corpus rows (`no_relevant_context`), and a concurrent request
// (`ask_in_flight`, the process-level `askInFlight` flag). routes/ask.ts
// replies to all three directly with `reply.code(...).send(...)` rather than
// throwing and catching by name, so no class was ever instantiated for them.

/**
 * Route present, but the configured connection is disabled or otherwise
 * unusable (resolve-model.ts's `loadModel` throws a plain Error for this --
 * never NoProviderConfiguredError, which means "no route at all" and is
 * mapped to `cloud_ask_disabled` directly by the route instead, per the
 * design's "two 409s for one state" resolution).
 */
export class AskProviderDisabledError extends Error {
  readonly statusCode = 409;
  readonly code = "no_provider_configured";
  constructor() {
    super("the configured AI provider is unavailable");
    this.name = "AskProviderDisabledError";
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

/**
 * Checkpoint 9.7: the model cited a ref that resolves to nothing in the
 * context it was given. The answer is discarded rather than returned with an
 * uncheckable claim in it; the client asks the user to try again. Thrown and
 * caught by name in routes/ask.ts (the AskTimeoutError pattern).
 */
export class AskUncitedAnswerError extends Error {
  readonly statusCode = 502;
  readonly code = "ask_uncited";
  constructor() {
    super("the answer cited something not in the context");
    this.name = "AskUncitedAnswerError";
  }
}

/**
 * Checkpoint 9.7: the `ask` route row predates `ASK_TODAY_CONSENT_FROM`, so
 * the owner consented under the narrower 8.6B disclosure. A `tz`-bearing
 * request (which would add the Today context) is refused until the route is
 * re-created under the 9.7 text. A `tz`-less request is unaffected. Thrown
 * and caught by name in routes/ask.ts.
 */
export class AskConsentOutdatedError extends Error {
  readonly statusCode = 409;
  readonly code = "ask_consent_outdated";
  constructor() {
    super("Cloud Ask was enabled under an earlier disclosure");
    this.name = "AskConsentOutdatedError";
  }
}
