/**
 * The Gmail OAuth redirect URI this client asks the server to use.
 *
 * DERIVED FROM THE API BASE URL, NEVER HARDCODED AND NEVER GUESSED. The server
 * keeps an exact-match allowlist with no normalization -- no prefix matching, no
 * trailing-slash tolerance -- and rejects anything not on it with
 * `400 invalid_redirect_uri`. Building it from the same `EXPO_PUBLIC_API_URL`
 * the client already talks to is what keeps a development loopback build and a
 * production tailnet build each asking for the redirect their own server
 * actually registered.
 *
 * The path is the one Checkpoint 7.2 registered with Google, and it is a
 * SERVER-side callback: Google redirects the user's BROWSER here, and Google's
 * own servers never call it. That is why a tailnet-only host works as a redirect
 * target at all, and why none of this needs public ingress (ADR-018).
 */
const CALLBACK_PATH = "/mail-connections/gmail/callback";

export function mailCallbackRedirectUri(apiBaseUrl: string): string {
  // `new URL` normalizes a trailing slash on the base, which matters because the
  // allowlist compares exactly: `http://host:3000/` and `http://host:3000` would
  // otherwise produce two different strings for one server.
  return new URL(CALLBACK_PATH, apiBaseUrl).toString();
}
