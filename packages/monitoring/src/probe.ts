import tls from "node:tls";

// Probe execution and, more importantly, probe FAILURE CLASSIFICATION.
//
// ===========================================================================
// A PROBE ERROR IS A LEAK CHANNEL, AND THIS IS THE VALVE.
// ===========================================================================
//
// Node's fetch failures carry the URL they failed against -- `TypeError: fetch
// failed` with a `cause` naming the host, and undici errors that stringify the
// whole request. A monitor target's URL is operator-supplied and may legitimately
// carry a token in a query string, so an error message reaching a log line or a
// durable column is a credential leak with extra steps.
//
// So NOTHING here ever returns, stores or logs an error's message, stack, cause
// or the URL. Every failure becomes a lowercase machine token from a small set,
// and `MonitorFailureClassSchema` rejects anything else at the boundary -- prose
// has spaces and capitals, so a writer reaching for `err.message` fails there
// rather than in Postgres.
//
// The one exception is deliberate and narrow: an HTTP STATUS is echoed, as
// `http_status:503`. A status code is three digits and cannot carry a secret.

export type ProbeOutcome =
  | { status: "up"; httpStatus: number | null; latencyMs: number }
  | { status: "down"; httpStatus: number | null; latencyMs: number; failureClass: string };

export interface HttpProbeRequest {
  url: string;
  expectedStatus: number;
  timeoutMs: number;
  /** Parse the body against the Personal OS /health contract. */
  expectHealthyPayload: boolean;
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/**
 * The shape `/health` returns, as much of it as the probe cares about.
 *
 * Read defensively: a 200 from something that is not Personal OS must classify
 * as a bad payload rather than throw, because "the wrong thing is answering on
 * this port" is exactly the outage a monitor exists to catch.
 */
interface HealthPayload {
  status?: unknown;
  db?: unknown;
  worker?: { stale?: unknown } | null;
}

/**
 * Classifies a health-endpoint body.
 *
 * A 200 whose body says the database is unreachable or the worker is stale is
 * NOT up in any sense the user cares about, and recording it as up would make
 * the monitor agree with the outage. Each degraded fact gets its own token, so
 * "the API is fine but the worker died" is distinguishable from "the API cannot
 * reach Postgres" without reading a message.
 */
export function classifyHealthPayload(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return "health_payload_unreadable";
  const payload = body as HealthPayload;

  if (payload.db !== undefined && payload.db !== "connected") return "health_db_unreachable";
  const worker = payload.worker;
  if (worker !== undefined && worker !== null && worker.stale === true) {
    return "health_worker_stale";
  }
  if (payload.status !== undefined && payload.status !== "ok") return "health_degraded";
  // A body with none of the three fields is not a Personal OS health response.
  if (payload.status === undefined && payload.db === undefined && payload.worker === undefined) {
    return "health_payload_unreadable";
  }
  return null;
}

/** `AbortSignal.timeout` rejects with "TimeoutError"; an external abort, "AbortError". */
function isAbortLike(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const name = (err as { name?: unknown }).name;
  return name === "TimeoutError" || name === "AbortError";
}

/**
 * Reduces any transport failure to a token.
 *
 * Deliberately COARSE. A finer taxonomy would mean reading the error's message
 * or `cause.code` and mapping strings, which is both the leak channel this file
 * exists to close and a mapping that breaks silently the first time a runtime
 * rewords an error. "We could not reach it" and "we gave up waiting" are the two
 * distinctions an operator actually acts on differently.
 */
export function classifyTransportFailure(err: unknown): string {
  return isAbortLike(err) ? "timeout" : "unreachable";
}

/**
 * Probes one HTTP target.
 *
 * `fetchFn` is injectable and defaults to the global, following the CalDAV and
 * Gmail clients rather than the Google Calendar client -- the latter closes over
 * a module-scope fetch "and consequently has no test file at all".
 *
 * `redirect: "manual"` on purpose: a monitor asks "is THIS endpoint serving?",
 * and silently following a redirect to somewhere else would report the health of
 * a service nobody configured. A 3xx is compared against `expectedStatus` like
 * any other status, so a target that legitimately redirects can simply expect it.
 */
export async function probeHttp(
  request: HttpProbeRequest,
  fetchFn: FetchLike = globalThis.fetch,
  now: () => number = () => performance.now(),
): Promise<ProbeOutcome> {
  const startedAt = now();
  let response: Response;
  try {
    response = await fetchFn(request.url, {
      method: "GET",
      redirect: "manual",
      signal: AbortSignal.timeout(request.timeoutMs),
      headers: { Accept: "application/json" },
    });
  } catch (err) {
    return {
      status: "down",
      httpStatus: null,
      latencyMs: Math.max(0, Math.round(now() - startedAt)),
      failureClass: classifyTransportFailure(err),
    };
  }

  const latencyMs = Math.max(0, Math.round(now() - startedAt));

  if (response.status !== request.expectedStatus) {
    return {
      status: "down",
      httpStatus: response.status,
      latencyMs,
      // The one echoed value: three digits, incapable of carrying a secret.
      failureClass: `http_status:${response.status}`,
    };
  }

  if (request.expectHealthyPayload) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      // A non-JSON body from something claiming to be /health. Nothing of it is
      // retained -- it could be an error page echoing a request.
      return {
        status: "down",
        httpStatus: response.status,
        latencyMs,
        failureClass: "health_payload_unreadable",
      };
    }
    const failureClass = classifyHealthPayload(body);
    if (failureClass !== null) {
      return { status: "down", httpStatus: response.status, latencyMs, failureClass };
    }
  }

  return { status: "up", httpStatus: response.status, latencyMs };
}

// ---------------------------------------------------------------------------
// TLS expiry
// ---------------------------------------------------------------------------

export interface TlsObservation {
  expiresAt: Date;
  daysRemaining: number;
}

export type TlsProbeFn = (
  host: string,
  port: number,
  timeoutMs: number,
) => Promise<{ validTo: string }>;

/**
 * Reads the peer certificate's expiry.
 *
 * A SEPARATE CONNECTION FROM THE HTTP PROBE, and it has to be: `fetch` gives no
 * access to the peer certificate at all -- undici does not surface it -- so
 * there is no way to fold this into the request above. `node:tls` is the only
 * route.
 *
 * `rejectUnauthorized: false` is deliberate and is the opposite of a security
 * hole here. The probe's job is to REPORT on the certificate, including an
 * already-expired or otherwise invalid one; refusing to connect to a bad
 * certificate would mean the monitor goes blind at exactly the moment it has
 * something to say. Nothing is sent over this socket and no response body is
 * read, so there is nothing to protect.
 */
export const connectForTlsCertificate: TlsProbeFn = (host, port, timeoutMs) =>
  new Promise((resolve, reject) => {
    const socket = tls.connect(
      { host, port, servername: host, rejectUnauthorized: false, timeout: timeoutMs },
      () => {
        const cert = socket.getPeerCertificate();
        socket.end();
        if (!cert || typeof cert.valid_to !== "string" || cert.valid_to === "") {
          reject(new Error("no peer certificate"));
          return;
        }
        resolve({ validTo: cert.valid_to });
      },
    );
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      const err = new Error("tls timeout");
      err.name = "TimeoutError";
      reject(err);
    });
    socket.on("error", (err: unknown) => {
      socket.destroy();
      // Normalized to an Error before rejecting: `classifyTransportFailure`
      // reads `name`, and a socket can in principle emit a non-Error. The
      // original message is deliberately NOT carried across -- a connection
      // failure names the host it failed against, and a target URL may carry a
      // token.
      const normalized = new Error("tls socket error");
      normalized.name = err instanceof Error ? err.name : "Error";
      reject(normalized);
    });
  });

/**
 * Turns a certificate's `valid_to` into days remaining.
 *
 * Floors rather than rounds: 0.9 days remaining is "expires today", and
 * reporting it as 1 would let a target sail past a `tls_warn_days: 1` threshold
 * on the last day it could still have been renewed calmly.
 */
export function daysUntil(validTo: string, now: Date): TlsObservation | null {
  const expiresAt = new Date(validTo);
  if (Number.isNaN(expiresAt.getTime())) return null;
  const daysRemaining = Math.floor((expiresAt.getTime() - now.getTime()) / 86_400_000);
  return { expiresAt, daysRemaining };
}

export interface TlsProbeRequest {
  url: string;
  warnDays: number;
  timeoutMs: number;
}

export interface TlsProbeResult {
  observation: TlsObservation | null;
  /** Null when the certificate is comfortably valid. */
  failureClass: string | null;
}

/**
 * Probes a target's certificate and decides whether it is a problem yet.
 *
 * Three outcomes, and the middle one is the reason to bother: an EXPIRED
 * certificate is an outage (`tls_expired`), an expiring one is a warning
 * (`tls_expiring`) that arrives while there is still time to act, and a
 * comfortable one is silence. An unreachable TLS endpoint is `tls_unreachable`
 * rather than a transport failure of the HTTP probe, so a certificate problem is
 * never mistaken for the service being down.
 */
export async function probeTls(
  request: TlsProbeRequest,
  connect: TlsProbeFn = connectForTlsCertificate,
  now: Date = new Date(),
): Promise<TlsProbeResult> {
  let host: string;
  let port: number;
  try {
    const parsed = new URL(request.url);
    host = parsed.hostname;
    port = parsed.port === "" ? 443 : Number(parsed.port);
  } catch {
    return { observation: null, failureClass: "tls_target_invalid" };
  }

  let validTo: string;
  try {
    ({ validTo } = await connect(host, port, request.timeoutMs));
  } catch (err) {
    return {
      observation: null,
      failureClass: isAbortLike(err) ? "tls_timeout" : "tls_unreachable",
    };
  }

  const observation = daysUntil(validTo, now);
  if (observation === null) return { observation: null, failureClass: "tls_unreadable" };
  if (observation.daysRemaining < 0) return { observation, failureClass: "tls_expired" };
  if (observation.daysRemaining <= request.warnDays) {
    return { observation, failureClass: "tls_expiring" };
  }
  return { observation, failureClass: null };
}
