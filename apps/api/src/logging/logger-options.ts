import type { FastifyRequest } from "fastify";
import { serializeErrorForLog } from "./serialize-error.js";
import { scrubSensitiveQueryParams } from "./scrub-url.js";

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
          url: scrubSensitiveQueryParams(request.url),
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
