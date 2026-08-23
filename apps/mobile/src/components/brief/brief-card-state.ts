// Pure, zero React/expo import on purpose -- same reasoning as
// resolve-notification-route.ts and reminder-eligibility.ts: keeping the
// state-derivation logic free of any rendering framework means it is
// testable with plain vitest, and brief-card.tsx stays a thin renderer
// over it.
//
// Frozen precedence (do not reorder without re-checking every caller):
//   1. isLoading always wins -- nothing else is known yet.
//   2. isGenerating wins over any cached brief/error -- a generation is
//      in flight and must show its own state, carrying the previous
//      brief's text forward so the card doesn't blank out while waiting.
//   3. An error maps to either "no_provider" (calm, non-fatal -- ADR-041's
//      documented graceful-degradation case) or "error" (everything else).
//      Both carry previousText: a failed regeneration must never destroy
//      the still-cached, still-valid brief the card was already showing.
//   4. A present brief with nothing in flight and no error is "present".
//   5. No brief, no error, not loading is "empty".

export type BriefCardState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "present"; text: string; generatedAt: string }
  | { kind: "generating"; previousText: string | null }
  | { kind: "no_provider"; previousText: string | null }
  | { kind: "error"; previousText: string | null };

export interface BriefLike {
  content: { text: string };
  generated_at: string;
}

export interface ResolveBriefCardStateParams {
  isLoading: boolean;
  brief: BriefLike | null | undefined;
  isGenerating: boolean;
  error: unknown;
}

// Defensive shape check rather than an `instanceof ApiClientError` check --
// this module deliberately imports nothing from @personal-os/api-client so
// it stays trivially unit-testable with plain object fixtures, and a
// structural check is exactly as correct against the real error class
// (status/code/body are all plain public fields on ApiClientError).
function isNoProviderConfiguredError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const err = error as { status?: unknown; code?: unknown; body?: unknown };
  if (err.status !== 409) return false;

  const code = typeof err.code === "string" ? err.code : undefined;
  const body = err.body;
  const bodyError =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: unknown }).error
      : undefined;
  const bodyErrorCode = typeof bodyError === "string" ? bodyError : undefined;

  // A bare 409 -- no code, no body.error to inspect -- also counts as
  // no_provider: on this endpoint a 409 with no other classification is
  // the documented no-provider-configured shape, not some other conflict.
  if (code === undefined && bodyErrorCode === undefined) return true;

  return code === "no_provider_configured" || bodyErrorCode === "no_provider_configured";
}

export function resolveBriefCardState(params: ResolveBriefCardStateParams): BriefCardState {
  const { isLoading, brief, isGenerating, error } = params;

  if (isLoading) return { kind: "loading" };

  const previousText = brief ? brief.content.text : null;

  if (isGenerating) return { kind: "generating", previousText };

  if (error !== null && error !== undefined) {
    if (isNoProviderConfiguredError(error)) {
      return { kind: "no_provider", previousText };
    }
    return { kind: "error", previousText };
  }

  if (brief) {
    return { kind: "present", text: brief.content.text, generatedAt: brief.generated_at };
  }

  return { kind: "empty" };
}
