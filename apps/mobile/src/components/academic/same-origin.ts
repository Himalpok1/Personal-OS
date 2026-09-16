// The one origin check every "open in Canvas" affordance goes through
// (Checkpoint 10.2, ADR-070; moved verbatim in semantics from Checkpoint
// 10.1's `isOwnCanvasOrigin` in the retired upcoming-assignments card).
//
// `html_url` is provider-generated, not user-typed, but it is still
// provider-supplied content this project does not control, and
// `Linking.openURL` opens whatever it is given (the one thing
// apps/worker/src/mobile-inert-rendering.test.ts requires every such call
// site to justify). This turns "trust the LMS's own link" into a checked
// invariant: a row may only open if `html_url`'s origin is EXACTLY the
// connection's own `source_base_url` origin, so no academic surface can ever
// navigate anywhere other than the owner's own configured instance.
//
// Every academic `Linking.openURL` call site must be justified by this exact
// check against the row's `source_base_url` -- in practice there is one such
// site, `source-link.tsx`, and `__tests__/academic-open-url.test.ts` pins
// that it stays the only one and that it calls this first.

/**
 * True only when both parse as URLs and their origins (scheme + host + port)
 * are identical. A malformed URL on either side fails CLOSED (not openable)
 * rather than throwing, and `null`/empty `html_url` is simply not openable.
 */
export function isSameOrigin(htmlUrl: string | null, sourceBaseUrl: string): boolean {
  if (htmlUrl === null || htmlUrl.length === 0) return false;
  try {
    return new URL(htmlUrl).origin === new URL(sourceBaseUrl).origin;
  } catch {
    return false;
  }
}
