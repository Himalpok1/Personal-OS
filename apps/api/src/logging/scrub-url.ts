// Strips credential-bearing query parameters out of a request URL before it is
// logged.
//
// WHY A SERIALIZER AND NOT A HOOK:
//
// Fastify logs the incoming request BEFORE any onRequest hook runs --
// lib/route.js calls the log controller's incomingRequest() roughly forty lines
// before onRequestHookRunner(). A hook that rewrites req.url is therefore always
// too late; the raw URL is already on disk.
//
// AND WHY NOT redact.paths:
//
// Fastify's default `req` serializer emits only
// {method, url, version, host, remoteAddress, remotePort}. There is no req.query
// and no req.body in the log object at all, so redact paths like
// "req.query.code" censor nothing -- they are silent no-ops. (The same is true
// of the pre-existing "req.body.api_key" entries: bodies are safe because the
// serializer never emits them, not because of the redact list.)
//
// A custom serializer runs at SERIALIZATION time, which is inside that first
// log call, so it is the one place that actually covers it.

/**
 * Query parameters whose VALUES must never be logged.
 *
 * `code` is a live, single-use Google authorization code; `state` is the CSRF
 * token bound to it. Both arrive in the query string of the OAuth callback.
 *
 * Applied on EVERY route, not just the callback, so a future route that gains a
 * sensitive parameter is covered without anyone having to remember.
 */
// `q` is the /search query string (Checkpoint 8.6A). It is the owner's own
// first-party text rather than a credential, but Fastify's request serializer
// emits `url` on every request, so every search anyone types was landing in the
// container log verbatim. This list is applied on EVERY route by design, so
// adding the name here also covers any future route that names a parameter `q`.
export const SENSITIVE_QUERY_PARAMS: readonly string[] = ["code", "state", "access_token", "q"];

const REDACTED = "[redacted]";

/**
 * Returns `url` with every sensitive parameter's value replaced.
 *
 * Deliberately string-based rather than URL-based: `req.url` is a path with a
 * query, not an absolute URL, and parsing it against a fake origin then
 * re-serializing would silently normalize encoding and parameter order in the
 * logs. Preserving the URL as-sent makes log lines comparable.
 */
export function scrubSensitiveQueryParams(url: string): string {
  const queryStart = url.indexOf("?");
  if (queryStart === -1) return url;

  const path = url.slice(0, queryStart);
  const query = url.slice(queryStart + 1);
  if (query.length === 0) return url;

  const scrubbed = query
    .split("&")
    .map((pair) => {
      if (pair.length === 0) return pair;
      const eq = pair.indexOf("=");
      const rawName = eq === -1 ? pair : pair.slice(0, eq);
      let name: string;
      try {
        name = decodeURIComponent(rawName);
      } catch {
        // A malformed percent-escape must not throw inside the logger; fall
        // back to the raw name so the parameter is still matched literally.
        name = rawName;
      }
      if (!SENSITIVE_QUERY_PARAMS.includes(name)) return pair;
      // Keep the parameter NAME so the log still shows a callback was hit --
      // only the value is destroyed.
      return `${rawName}=${REDACTED}`;
    })
    .join("&");

  return `${path}?${scrubbed}`;
}
