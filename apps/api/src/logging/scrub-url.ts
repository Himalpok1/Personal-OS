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
 * Index of the character that starts the query string, or -1 if there is none.
 *
 * The router, not this file, decides where the query begins, and it does NOT
 * split on `?` alone: find-my-way's `safeDecodeURI` (lib/url-sanitizer.js)
 * treats `?` and `#` as query delimiters, so `/search#q=x` is routed to
 * `/search` and executed with `q=x` -- a client that can put a `#` on the wire
 * gets a real search out of it. A scrubber that only looked for `?` would then
 * write that whole string to the log as if it were a path, which is exactly a
 * mismatch between the privacy control and the thing it guards (Checkpoint 9.0
 * Part B review). The earliest of the two wins, because a `#` inside a `?`
 * query (or vice versa) is already query by then.
 *
 * `;` is deliberately not a delimiter here: find-my-way splits on it only under
 * `useSemicolonDelimiter`, which Fastify defaults to false and this API never
 * sets, so `/nope;code=x` is a PATH to the router and is kept as one. If that
 * option is ever enabled, this function is where the third delimiter goes.
 */
function findQueryStart(url: string): number {
  const question = url.indexOf("?");
  const hash = url.indexOf("#");
  if (question === -1) return hash;
  if (hash === -1) return question;
  return Math.min(question, hash);
}

/**
 * Returns `url` with every sensitive parameter's value replaced.
 *
 * Deliberately string-based rather than URL-based: `req.url` is a path with a
 * query, not an absolute URL, and parsing it against a fake origin then
 * re-serializing would silently normalize encoding and parameter order in the
 * logs. Preserving the URL as-sent makes log lines comparable.
 */
export function scrubSensitiveQueryParams(url: string): string {
  const queryStart = findQueryStart(url);
  if (queryStart === -1) return url;

  // The delimiter is re-emitted as sent (`?` or `#`) for the same reason the
  // rest of the URL is: a normalized log line is no longer comparable with
  // what the client actually put on the wire.
  const path = url.slice(0, queryStart);
  const delimiter = url[queryStart];
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

  return `${path}${delimiter}${scrubbed}`;
}

/**
 * Returns `url` with the ENTIRE query string destroyed, keeping only the path
 * and a marker that a query was present.
 *
 * For a route that does not exist (Checkpoint 9.0 Part B). `scrubSensitiveQueryParams`
 * works by NAME, which is the right tool for a known route: its parameters are
 * enumerable, so the sensitive ones can be listed and the rest stay readable
 * for diagnosis (`/tasks?limit=5` should say `limit=5`). A mistyped route has no
 * such list -- it can carry any parameter name at all, so name-based scrubbing
 * can never enumerate what to hide -- and its query has no diagnostic value
 * anyway, because there is no handler that would have read it. The only
 * observability that matters for a 404 is the method and the path, which is
 * what remains.
 *
 * The marker uses the same `[redacted]` sentinel as the per-parameter scrub so a
 * single grep finds every place the logger has suppressed something. `?` alone
 * (an empty query) is passed through unchanged: there is nothing to hide, and
 * rewriting it would make the two log lines for one request disagree.
 */
export function scrubQueryForUnknownRoute(url: string): string {
  const queryStart = findQueryStart(url);
  if (queryStart === -1) return url;
  if (queryStart === url.length - 1) return url;
  return `${url.slice(0, queryStart)}${url[queryStart]}${REDACTED}`;
}
