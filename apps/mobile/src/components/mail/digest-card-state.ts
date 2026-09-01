import type { MailDigestCurrentResponse } from "@personal-os/schema";

// Pure, React-free derivation of the mail digest card's state -- the same split
// as `brief/brief-card-state.ts`, whose shape this closely follows because the
// two surfaces answer the same question with the same four outcomes.
//
// Where it deliberately DIFFERS from the brief is the empty state. A brief has
// one way of being absent: nobody has generated it. A digest has three, and they
// need different words:
//
//   not_configured     this server has no Gmail credentials at all.
//   no_mailbox         credentials exist, but no mailbox is connected.
//   empty              a mailbox is connected; the digest just hasn't run yet.
//
// Collapsing them would tell a user to go set up something that is already set
// up -- which is the specific failure the API's three-field response was shaped
// to prevent, so throwing the distinction away here would waste it at the last
// step.

export type DigestCardState =
  | { kind: "loading" }
  | { kind: "unavailable" } // we could not read it, so we assert nothing
  | { kind: "not_configured" }
  | { kind: "no_mailbox" }
  | { kind: "empty" }
  | { kind: "present"; text: string; digestDate: string; timezone: string; generatedAt: string }
  | { kind: "generating"; previousText: string | null }
  | { kind: "requested"; previousText: string | null }
  | { kind: "failed"; reason: DigestFailureReason; previousText: string | null };

/**
 * Why a generation request failed, as a closed set.
 *
 * Each maps to a specific 409 the route can return synchronously. `unknown`
 * covers everything else -- including a 503 when the queue is not up -- and
 * deliberately carries no provider text.
 */
export type DigestFailureReason =
  | "not_configured"
  | "no_mailbox"
  | "no_provider"
  | "queue_unavailable"
  | "unknown";

export interface ResolveDigestCardStateParams {
  isLoading: boolean;
  data: MailDigestCurrentResponse | null | undefined;
  isLoadError: boolean;
  isGenerating: boolean;
  generateError: unknown;
  /**
   * A generation request has been ACCEPTED (202) and not yet superseded.
   *
   * WITHOUT THIS THE "generating" STATE IS ALMOST INVISIBLE. `isGenerating` is
   * the mutation's `isPending`, which ends when the route's 202 arrives -- not
   * when the worker finishes. Since the route only enqueues, that is an HTTP
   * round trip: a few hundred milliseconds. The card would flash "preparing a
   * digest" and revert to the previous state while the work had not started,
   * which reads as "nothing happened".
   *
   * Derived by the caller from the mutation's own `isSuccess`/`submittedAt`
   * against the digest's `generated_at`, so it needs no component state -- which
   * matters, because the render tests call the component with no React
   * dispatcher and an extra hook would throw.
   */
  hasPendingRequest?: boolean;
}

/**
 * Structural rather than `instanceof ApiClientError`, so this module imports
 * nothing from `@personal-os/api-client` and stays trivially unit-testable with
 * plain object fixtures. `status`/`code`/`body` are all plain public fields on
 * the real error class, so the check is exactly as correct.
 *
 * NOTE the deliberate difference from `brief-card-state.ts`: that module treats
 * a BARE 409 as "no provider", which is right for the briefs endpoint where a
 * 409 has only one meaning. This endpoint has three distinct 409s, so an
 * unclassified one maps to `unknown` rather than being guessed at.
 */
function classifyGenerateError(error: unknown): DigestFailureReason | null {
  if (error === null || error === undefined) return null;
  if (typeof error !== "object") return "unknown";

  const err = error as { status?: unknown; code?: unknown; body?: unknown };
  const body = err.body;
  const bodyError =
    typeof body === "object" && body !== null && "error" in body
      ? (body as { error?: unknown }).error
      : undefined;
  const code = typeof err.code === "string" ? err.code : undefined;
  const resolved = code ?? (typeof bodyError === "string" ? bodyError : undefined);

  switch (resolved) {
    case "mail_not_configured":
      return "not_configured";
    case "no_active_mailboxes":
      return "no_mailbox";
    case "no_provider_configured":
      return "no_provider";
    case "queue_unavailable":
      return "queue_unavailable";
    default:
      return "unknown";
  }
}

/**
 * Frozen precedence:
 *
 *   1. loading wins -- nothing is known yet.
 *   2. a generation in flight wins over any cached digest or error, carrying the
 *      previous text forward so the card does not blank out while waiting.
 *   3. a generation error maps to a named reason, ALSO carrying the previous
 *      text: a failed regeneration must never destroy the still-valid digest the
 *      card was already showing.
 *   4. a load error is `unavailable` -- we could not read, so we claim nothing.
 *   5. a digest present with nothing in flight is `present`.
 *   6. otherwise the specific empty state the server's two booleans name.
 */
export function resolveDigestCardState(params: ResolveDigestCardStateParams): DigestCardState {
  const { isLoading, data, isLoadError, isGenerating, generateError, hasPendingRequest } =
    params;

  if (isLoading) return { kind: "loading" };

  const previousText = data?.digest ? data.digest.content.text : null;

  if (isGenerating) return { kind: "generating", previousText };

  const reason = classifyGenerateError(generateError);
  if (reason !== null) return { kind: "failed", reason, previousText };

  // Accepted, but the worker has not produced a digest yet. Distinct from
  // `generating` (the request is still in flight) and from `present` (a digest
  // newer than the request exists).
  if (hasPendingRequest === true) return { kind: "requested", previousText };

  if (isLoadError) return { kind: "unavailable" };
  if (!data) return { kind: "loading" };

  if (data.digest) {
    return {
      kind: "present",
      text: data.digest.content.text,
      digestDate: data.digest.digest_date,
      timezone: data.digest.timezone,
      generatedAt: data.digest.generated_at,
    };
  }

  if (!data.configured) return { kind: "not_configured" };
  if (!data.has_active_mailbox) return { kind: "no_mailbox" };
  return { kind: "empty" };
}

/** Whether the card should offer a Generate action in this state. */
export function canGenerateDigest(state: DigestCardState): boolean {
  switch (state.kind) {
    case "loading":
    case "generating":
    // The request is already accepted; asking again would enqueue a duplicate
    // that the queue's singletonKey would collapse anyway.
    case "requested":
    case "unavailable":
    // No credentials and no mailbox are both setup steps the button cannot
    // advance -- it could only ever return the same 409 again.
    case "not_configured":
    case "no_mailbox":
      return false;
    case "empty":
    case "present":
      return true;
    case "failed":
      // A failure the user may have just fixed elsewhere (configuring a
      // provider, connecting a mailbox) must not be a dead end -- the same
      // reasoning that gave the brief card its "Try again" in the no-provider
      // state. Only the two states above, which the button provably cannot
      // change, withhold it.
      return state.reason !== "not_configured" && state.reason !== "no_mailbox";
  }
}

/** Fixed copy per failure reason. No provider text ever reaches this. */
export function digestFailureText(reason: DigestFailureReason): string {
  switch (reason) {
    case "not_configured":
      return "Gmail isn't set up on this server.";
    case "no_mailbox":
      return "No mailbox is connected yet.";
    case "no_provider":
      return "No AI provider is configured for mail digests.";
    case "queue_unavailable":
      return "Personal OS couldn't queue the digest. Try again in a moment.";
    case "unknown":
      return "Couldn't request a mail digest.";
  }
}
