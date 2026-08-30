import { describe, expect, it } from "vitest";
import { GMAIL_METADATA_SCOPE } from "./gmail-catalog.js";
import {
  buildGmailAuthorizeUrl,
  exchangeGmailAuthCode,
  GmailOAuthError,
  refreshGmailAccessToken,
  revokeGmailToken,
} from "./gmail-oauth.js";
import type { FetchLike } from "./mail-client.js";

function stubToken(
  status: number,
  body: unknown,
): { fetchFn: FetchLike; bodies: string[]; urls: string[] } {
  const bodies: string[] = [];
  const urls: string[] = [];
  const fetchFn: FetchLike = (url, init) => {
    urls.push(url);
    bodies.push(typeof init?.body === "string" ? init.body : "");
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      }),
    );
  };
  return { fetchFn, bodies, urls };
}

describe("buildGmailAuthorizeUrl", () => {
  const base = {
    clientId: "client-123.apps.googleusercontent.com",
    redirectUri: "https://personal-os.example.ts.net/mail-connections/gmail/callback",
    state: "opaque-state",
  };

  it("requests exactly one scope, and it is gmail.metadata", () => {
    const url = new URL(buildGmailAuthorizeUrl(base));
    expect(url.searchParams.get("scope")).toBe(GMAIL_METADATA_SCOPE);
    // gmail.readonly is never requested: both are Restricted, so the narrower
    // scope buys no compliance relief -- it buys an unfetchable message body.
    expect(url.searchParams.get("scope")).not.toContain("gmail.readonly");
    expect(url.searchParams.get("scope")).not.toContain("openid");
  });

  it("SENDS redirect_uri, unlike the Phase 4 calendar flow", () => {
    const url = new URL(buildGmailAuthorizeUrl(base));
    expect(url.searchParams.get("redirect_uri")).toBe(base.redirectUri);
  });

  it("always requests offline access and never inherits other grants", () => {
    const url = new URL(buildGmailAuthorizeUrl(base));
    expect(url.searchParams.get("access_type")).toBe("offline");
    // Inheriting would silently widen the grant using the Calendar and Health
    // scopes already held by the same Google account.
    expect(url.searchParams.get("include_granted_scopes")).toBe("false");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  it("sends prompt=consent ONLY when a refresh token is genuinely required", () => {
    // Google caps an account at 100 live refresh tokens per client and evicts
    // the oldest, so prompting on every reconnect slowly destroys older grants.
    expect(new URL(buildGmailAuthorizeUrl(base)).searchParams.has("prompt")).toBe(false);
    expect(
      new URL(buildGmailAuthorizeUrl({ ...base, forceConsent: false })).searchParams.has("prompt"),
    ).toBe(false);
    expect(
      new URL(buildGmailAuthorizeUrl({ ...base, forceConsent: true })).searchParams.get("prompt"),
    ).toBe("consent");
  });

  it("carries the state verbatim", () => {
    const url = new URL(buildGmailAuthorizeUrl({ ...base, state: "a/b+c=d" }));
    expect(url.searchParams.get("state")).toBe("a/b+c=d");
  });
});

describe("exchangeGmailAuthCode", () => {
  it("posts the five expected fields INCLUDING redirect_uri", async () => {
    const { fetchFn, bodies, urls } = stubToken(200, {
      access_token: "at",
      refresh_token: "rt",
      expires_in: 3600,
      scope: GMAIL_METADATA_SCOPE,
    });
    await exchangeGmailAuthCode(
      { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://cb" },
      fetchFn,
    );
    expect(urls[0]).toBe("https://oauth2.googleapis.com/token");
    const sent = new URLSearchParams(bodies[0]);
    expect(sent.get("grant_type")).toBe("authorization_code");
    expect(sent.get("code")).toBe("c");
    // The Phase 4 calendar exchange asserts this is ABSENT. Gmail is a
    // browser-redirect flow, so here it must be present.
    expect(sent.get("redirect_uri")).toBe("https://cb");
    expect([...sent.keys()].sort()).toEqual([
      "client_id",
      "client_secret",
      "code",
      "grant_type",
      "redirect_uri",
    ]);
  });

  it("computes expiry from an injected clock", async () => {
    const { fetchFn } = stubToken(200, { access_token: "at", expires_in: 1800 });
    const now = Date.parse("2026-08-30T12:00:00Z");
    const result = await exchangeGmailAuthCode(
      { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://cb" },
      fetchFn,
      now,
    );
    expect(result.expiresAt.toISOString()).toBe("2026-08-30T12:30:00.000Z");
  });

  it("returns refreshToken null when Google did not issue one", async () => {
    const { fetchFn } = stubToken(200, { access_token: "at", expires_in: 60 });
    const result = await exchangeGmailAuthCode(
      { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://cb" },
      fetchFn,
    );
    // Null, so a caller can tell "no new token" from "a new token" and refuse
    // to clobber the stored one.
    expect(result.refreshToken).toBeNull();
  });

  it("throws GmailOAuthError carrying only the machine-readable error token", async () => {
    const { fetchFn } = stubToken(400, {
      error: "invalid_grant",
      // Google's prose. This has reached a user's screen in this project once
      // already (Checkpoint 6.5) and must not survive the boundary.
      error_description: "Token has been expired or revoked.",
    });
    let caught: GmailOAuthError | undefined;
    try {
      await exchangeGmailAuthCode(
        { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://cb" },
        fetchFn,
      );
    } catch (e) {
      caught = e as GmailOAuthError;
    }
    expect(caught).toBeInstanceOf(GmailOAuthError);
    expect(caught?.googleErrorCode).toBe("invalid_grant");
    expect(caught?.isPermanent).toBe(true);
    const serialized = JSON.stringify({
      message: caught?.message,
      stack: caught?.stack,
      ...Object.fromEntries(Object.entries(caught ?? {})),
    });
    expect(serialized).not.toContain("Token has been expired or revoked");
  });

  it("treats a 200 with no access_token as a failure", async () => {
    const { fetchFn } = stubToken(200, { scope: GMAIL_METADATA_SCOPE });
    await expect(
      exchangeGmailAuthCode(
        { code: "c", clientId: "id", clientSecret: "sec", redirectUri: "https://cb" },
        fetchFn,
      ),
    ).rejects.toBeInstanceOf(GmailOAuthError);
  });
});

describe("GmailOAuthError.isPermanent", () => {
  it("is true only for a genuinely dead grant", () => {
    expect(new GmailOAuthError("invalid_grant", 400).isPermanent).toBe(true);
    expect(new GmailOAuthError("invalid_client", 401).isPermanent).toBe(true);
    // A transient 5xx or an unrecognised code must NOT mark a connection
    // needs_reauth -- that would send a user to re-consent over a blip.
    expect(new GmailOAuthError("internal_failure", 500).isPermanent).toBe(false);
    expect(new GmailOAuthError(undefined, 503).isPermanent).toBe(false);
  });
});

describe("refreshGmailAccessToken", () => {
  it("posts a refresh_token grant", async () => {
    const { fetchFn, bodies } = stubToken(200, { access_token: "new", expires_in: 3600 });
    await refreshGmailAccessToken(
      { refreshToken: "rt", clientId: "id", clientSecret: "sec" },
      fetchFn,
    );
    const sent = new URLSearchParams(bodies[0]);
    expect(sent.get("grant_type")).toBe("refresh_token");
    expect(sent.get("refresh_token")).toBe("rt");
  });

  it("STRUCTURALLY cannot surface a refresh token to the caller", async () => {
    // Google sometimes echoes a refresh_token on a refresh. The narrow return
    // type means a caller cannot accidentally write an absent one over a good
    // stored one -- the same discipline as RefreshedGoogleTokens.
    const { fetchFn } = stubToken(200, {
      access_token: "new",
      refresh_token: "SHOULD-NOT-ESCAPE",
      expires_in: 3600,
    });
    const result = await refreshGmailAccessToken(
      { refreshToken: "rt", clientId: "id", clientSecret: "sec" },
      fetchFn,
    );
    expect(Object.keys(result).sort()).toEqual(["accessToken", "expiresAt"]);
    expect(JSON.stringify(result)).not.toContain("SHOULD-NOT-ESCAPE");
  });
});

describe("revokeGmailToken", () => {
  it("returns true on success", async () => {
    const { fetchFn, urls, bodies } = stubToken(200, {});
    await expect(revokeGmailToken("tok", fetchFn)).resolves.toBe(true);
    expect(urls[0]).toBe("https://oauth2.googleapis.com/revoke");
    expect(new URLSearchParams(bodies[0]).get("token")).toBe("tok");
  });

  it("returns false rather than throwing, so a disconnect can always proceed", async () => {
    // Failing to tell Google must never leave the user unable to clear their
    // own credentials locally.
    const { fetchFn } = stubToken(400, { error: "invalid_token" });
    await expect(revokeGmailToken("tok", fetchFn)).resolves.toBe(false);

    const throwing: FetchLike = () => Promise.reject(new Error("network down"));
    await expect(revokeGmailToken("tok", throwing)).resolves.toBe(false);
  });
});
