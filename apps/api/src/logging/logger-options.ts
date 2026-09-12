import type { FastifyRequest } from "fastify";
import { serializeErrorForLog } from "./serialize-error.js";
import { scrubQueryForUnknownRoute, scrubSensitiveQueryParams } from "./scrub-url.js";

/**
 * The API's Pino options.
 *
 * Extracted from server.ts so the OAuth-code suppression can be verified
 * against a real log stream rather than by reading the config -- a config-level
 * assertion is exactly what would have passed while the leak persisted.
 */
export function buildLoggerOptions() {
  return {
    serializers: {
      // Fastify logs the incoming request BEFORE any onRequest hook runs, so a
      // hook that rewrites req.url is always too late. A serializer runs inside
      // that first log call, which is the only place that actually covers the
      // OAuth callback's ?code=/&state= query string.
      //
      // This mirrors Fastify's own default req serializer field-for-field --
      // overriding it means we own every field emitted.
      req(request: FastifyRequest) {
        return {
          method: request.method,
          // Checkpoint 9.0 Part B. `request.is404` is Fastify's own public
          // flag for "this request is being served by the not-found
          // context" (lib/request.js: `config.url` is undefined only for the
          // not-found context and for the bad-URL context server.ts's
          // `frameworkErrors` runs under), and it is already true when this
          // serializer runs inside the very first "incoming request" log
          // call -- verified in server.not-found.test.ts against the real
          // stream. That is what lets the policy differ by route existence
          // without a hook (which would be too late, see scrub-url.ts): a
          // KNOWN route keeps name-based scrubbing so its non-sensitive
          // parameters stay diagnosable, while an UNKNOWN route loses its
          // whole query, because a mistyped path can carry any parameter
          // name and nothing would have read it anyway.
          //
          // OPTIONS is treated as unknown too, whatever the path. `is404` is
          // false for every OPTIONS request because @fastify/cors registers a
          // real `OPTIONS *` catch-all (index.js `fastify.options('*', ...)`)
          // that matches any path at all, so `OPTIONS /nope?anything=x` was
          // reaching the name-based branch and logging `anything=x` verbatim
          // -- the exact leak the unknown-route policy closes for GET. The
          // catch-all's handler and the cors preflight hook read headers
          // only, never the query, and this API registers no OPTIONS route
          // of its own (server.not-found.test.ts pins that), so there is no
          // diagnostic value being given up.
          url:
            request.is404 || request.method === "OPTIONS"
              ? scrubQueryForUnknownRoute(request.url)
              : scrubSensitiveQueryParams(request.url),
          host: request.host,
          remoteAddress: request.ip,
          remotePort: request.socket.remotePort,
        };
      },
      // Fastify MERGES custom serializers over its own defaults, so leaving
      // `err` out silently kept pino.stdSerializers.err -- which copies every
      // own-enumerable property of the error (CalDavError.responseBody, a pg
      // error's `detail`) onto the log line. See ./serialize-error.ts.
      err: serializeErrorForLog,
    },
    // Defence in depth, not the mechanism: the serializer above emits neither
    // query nor body, so a body field cannot reach a log line in the first
    // place. Kept so any future change that DOES log bodies inherits censoring.
    redact: {
      paths: [
        "req.body.api_key",
        "req.body.auth_code",
        "req.body.password",
        "req.headers.authorization",
      ],
      censor: "[redacted]",
    },
  };
}
