import net from "node:net";

// Blocks the SSRF / cloud-metadata-exfiltration class this project already
// solved once for CalDAV's structurally identical shape -- a connect flow
// where the owner pastes a provider base URL and this app then sends a live
// credential to it, indefinitely (packages/calendar-providers/src/caldav/
// ssrf.ts's `validateCalDavUrl`/`isSameOrigin`).
//
// Canvas had NEITHER guard until Checkpoint 10.1's own adversarial security
// review caught it: `connectCanvasConnection` did a live, unauthenticated-
// by-any-perimeter-guard outbound GET carrying the just-pasted PAT to
// whatever `base_url` was submitted, validated by nothing beyond
// `z.string().url()`, and the hourly worker cron repeats that same
// unguarded request for the connection's entire lifetime. Concretely: a
// spoofed `base_url` could exfiltrate a real PAT, or -- since
// `canvas_sync_runs.failure_class` distinguishes "nothing answered"
// (`network_error`) from "something answered" (`provider_error`/
// `auth_failed`) -- fingerprint whether an internal host:port is listening.
//
// A near-duplicate of CalDAV's module rather than an import from
// packages/calendar-providers, per this project's own stated convention
// (ADR-052) of deliberate near-duplication across provider packages over a
// premature shared dependency between two packages that otherwise share
// nothing.
export class CanvasUrlBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasUrlBlockedError";
  }
}

/**
 * Validates a Canvas URL (the connection's own `base_url`, or a redirect
 * target reached from it) against SSRF and cloud-metadata rules:
 *
 * 1. HTTPS only, except loopback HTTP in test/development.
 * 2. The cloud-metadata IP range (169.254.0.0/16) and IPv6 link-local
 *    (fe80::/10) are blocked outright.
 * 3. `0.0.0.0` and the IPv4 broadcast address are blocked.
 */
export function validateCanvasUrl(urlStr: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new CanvasUrlBlockedError(`Invalid Canvas URL: "${urlStr}"`);
  }

  const allowLoopback =
    process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "development";

  if (parsed.protocol === "http:") {
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    if (!allowLoopback || !isLoopback) {
      throw new CanvasUrlBlockedError(
        `Insecure protocol "${parsed.protocol}" not allowed for a Canvas instance. HTTPS is required.`,
      );
    }
  } else if (parsed.protocol !== "https:") {
    throw new CanvasUrlBlockedError(
      `Unsupported protocol "${parsed.protocol}". Canvas requires HTTPS.`,
    );
  }

  const hostname = parsed.hostname.toLowerCase();
  // `URL#hostname` keeps the brackets on an IPv6 literal ("[fe80::1]"), but
  // `net.isIP` only recognizes the bare address -- passing the bracketed
  // form makes `net.isIP` return 0 for every IPv6 host, silently skipping
  // this entire block. Stripped here so the check below actually runs
  // (found by this file's own test suite: the identical unstripped form in
  // CalDAV's `validateCalDavUrl`, which this module is a near-duplicate of,
  // has the same latent gap and no test that would have caught it).
  const bareHost =
    hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
  if (net.isIP(bareHost)) {
    if (bareHost.startsWith("169.254.")) {
      throw new CanvasUrlBlockedError(
        `Access to link-local/cloud metadata IP "${bareHost}" is blocked.`,
      );
    }
    if (bareHost === "0.0.0.0" || bareHost === "255.255.255.255") {
      throw new CanvasUrlBlockedError(`Access to invalid host IP "${bareHost}" is blocked.`);
    }
    if (bareHost.startsWith("fe80:")) {
      throw new CanvasUrlBlockedError(
        `Access to IPv6 link-local address "${bareHost}" is blocked.`,
      );
    }
  }

  return parsed;
}

/**
 * True only when both the scheme and host match exactly -- the boundary at
 * which `Authorization` must be dropped rather than forwarded across a
 * redirect.
 */
export function isSameOrigin(urlA: URL, urlB: URL): boolean {
  return urlA.protocol === urlB.protocol && urlA.host === urlB.host;
}
