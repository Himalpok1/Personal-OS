/**
 * Classifies a failed `POST /ai/providers/:id/test` into a bounded token.
 *
 * The route hands a user-supplied base URL and a user-supplied API key to a
 * vendor SDK, so the thrown error can carry an arbitrary upstream response
 * body -- and, for a misconfigured OpenAI-compatible endpoint, sometimes the
 * request that was sent. Echoing `err.message` made that the response.
 *
 * The tokens below are the distinctions a user can actually act on when a
 * connection test fails. Anything else is `provider_error`; the point is that
 * an unrecognised failure produces a word we chose rather than a sentence the
 * vendor wrote.
 */
export type AiProviderTestFailure =
  | "invalid_credentials"
  | "model_not_found"
  | "rate_limited"
  | "provider_unavailable"
  | "network_error"
  | "not_configured"
  | "provider_error";

export function classifyAiProviderTestFailure(err: unknown): AiProviderTestFailure {
  if (!(err instanceof Error)) return "provider_error";

  // The AI SDK surfaces the upstream status on the error object rather than in
  // a typed field we can import here without pulling the SDK into this route.
  const status = readNumber(err, "statusCode") ?? readNumber(err, "status");
  if (status !== undefined) {
    if (status === 401 || status === 403) return "invalid_credentials";
    if (status === 404) return "model_not_found";
    if (status === 429) return "rate_limited";
    if (status >= 500) return "provider_unavailable";
  }

  // Our own pre-flight failures, thrown before any request is made.
  if (err.name === "NoProviderConfiguredError") return "not_configured";

  const cause: unknown = (err as { cause?: unknown }).cause;
  const code =
    cause && typeof cause === "object" && "code" in cause
      ? (cause as { code?: unknown }).code
      : undefined;
  if (typeof code === "string") return "network_error";

  return "provider_error";
}

function readNumber(err: Error, key: string): number | undefined {
  const value: unknown = (err as unknown as Record<string, unknown>)[key];
  return typeof value === "number" ? value : undefined;
}
