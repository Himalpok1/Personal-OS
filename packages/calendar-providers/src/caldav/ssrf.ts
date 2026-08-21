import net from "net";

/**
 * Validates a target URL against SSRF and cloud metadata exfiltration rules.
 *
 * Rules:
 * 1. Protocol must be HTTPS (or HTTP localhost/127.0.0.1 in non-production environments).
 * 2. Cloud metadata IP 169.254.169.254 and link-local ranges (169.254.0.0/16, fe80::/10) are strictly blocked.
 * 3. 0.0.0.0 and broadcast addresses are blocked.
 */
export function validateCalDavUrl(
  urlStr: string,
  options: { allowHttpLoopback?: boolean } = {},
): URL {
  let parsed: URL;
  try {
    parsed = new URL(urlStr);
  } catch {
    throw new Error(`Invalid CalDAV URL: "${urlStr}"`);
  }

  const allowLoopback =
    options.allowHttpLoopback ??
    (process.env["NODE_ENV"] === "test" || process.env["NODE_ENV"] === "development");

  if (parsed.protocol === "http:") {
    const isLoopback =
      parsed.hostname === "localhost" ||
      parsed.hostname === "127.0.0.1" ||
      parsed.hostname === "::1";
    if (!allowLoopback || !isLoopback) {
      throw new Error(
        `Insecure protocol "${parsed.protocol}" not allowed for CalDAV server. HTTPS is required.`,
      );
    }
  } else if (parsed.protocol !== "https:") {
    throw new Error(`Unsupported protocol "${parsed.protocol}". CalDAV requires HTTPS.`);
  }

  const hostname = parsed.hostname.toLowerCase();

  // Block cloud metadata & link-local IP addresses
  if (net.isIP(hostname)) {
    if (hostname.startsWith("169.254.")) {
      throw new Error(`Access to link-local/cloud metadata IP "${hostname}" is blocked.`);
    }
    if (hostname === "0.0.0.0" || hostname === "255.255.255.255") {
      throw new Error(`Access to invalid host IP "${hostname}" is blocked.`);
    }
    if (hostname.toLowerCase().startsWith("fe80:")) {
      throw new Error(`Access to IPv6 link-local address "${hostname}" is blocked.`);
    }
  }

  return parsed;
}

/**
 * Checks if target redirect URL has the same origin as the source URL.
 * If origins differ, Authorization headers must be stripped to prevent credential leaks.
 */
export function isSameOrigin(urlA: URL, urlB: URL): boolean {
  return urlA.protocol === urlB.protocol && urlA.host === urlB.host;
}
