import { describe, expect, it, vi } from "vitest";
import {
  buildAuthorizeUrl,
  exchangeHealthAuthCode,
  GoogleHealthOAuthError,
  refreshHealthAccessToken,
  revokeHealthToken,
} from "./google-health-oauth.js";
import { PHASE_6A_SCOPES } from "./google-health-catalog.js";
import type { FetchLike } from "./google-health-oauth.js";

const CREDS = { clientId: "cid", clientSecret: "secret" };
const REDIRECT = "https://personal-os.example.ts.net/health-connections/google/callback";

// Typed as FetchLike so mock.calls is a real tuple rather than any[] --
// otherwise every assertion on the request body is unchecked.
function okJson(body: unknown) {
  return vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
}
function errJson(status: number, body: unknown) {
  return vi.fn<FetchLike>().mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe("buildAuthorizeUrl", () => {
  const url = new URL(
    buildAuthorizeUrl({
      clientId: "cid",
      redirectUri: REDIRECT,
      scopes: PHASE_6A_SCOPES,
      state: "st-123",
    }),
  );

  // Without BOTH of these Google returns no refresh token at all, and the whole
  // unattended-sync premise collapses.
  it("requests offline access and forces the consent prompt", () => {
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("sends exactly the three Phase 6A read scopes", () => {
    const scopes = url.searchParams.get("scope")!.split(" ").sort();
    expect(scopes).toEqual([...PHASE_6A_SCOPES].sort());
    expect(scopes).toHaveLength(3);
  });

  it("requests no write scope and no settings scope", () => {
    const scope = url.searchParams.get("scope")!;
    expect(scope).not.toContain("writeonly");
    expect(scope).not.toContain("settings");
    expect(scope).not.toContain("location");
  });

  it("carries the redirect_uri and state", () => {
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("state")).toBe("st-123");
  });
});

describe("exchangeHealthAuthCode", () => {
  // The single most important difference from the calendar OAuth module, which
  // deliberately omits redirect_uri. Google Health uses a Web Server client and
  // rejects an exchange without it.
  it("SENDS redirect_uri", async () => {
    const f = okJson({
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      scope: "s",
      token_type: "Bearer",
    });
    await exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f);
    const body = f.mock.calls[0]![1]?.body as URLSearchParams;
    expect(body.get("redirect_uri")).toBe(REDIRECT);
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(f.mock.calls[0]![0]).toBe("https://oauth2.googleapis.com/token");
  });

  it("returns the granted scope, which may be a subset of what was requested", async () => {
    const granted = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";
    const f = okJson({
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      scope: granted,
      token_type: "Bearer",
    });
    const t = await exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f);
    expect(t.scope).toBe(granted);
  });

  it("computes an absolute expiry from expires_in", async () => {
    const f = okJson({
      access_token: "a",
      refresh_token: "r",
      expires_in: 3600,
      scope: "s",
      token_type: "Bearer",
    });
    const before = Date.now();
    const t = await exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f);
    expect(t.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);
  });

  // Silently accepting a tokenless response would leave a connection that looks
  // healthy and can never refresh.
  it("throws a diagnosable error when no refresh_token comes back", async () => {
    const f = okJson({ access_token: "a", expires_in: 3600, scope: "s", token_type: "Bearer" });
    await expect(
      exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f),
    ).rejects.toThrow(/access_type=offline/);
  });

  it("surfaces Google's machine-readable error code", async () => {
    const f = errJson(400, { error: "invalid_grant", error_description: "Bad Request" });
    await expect(
      exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f),
    ).rejects.toMatchObject({ googleErrorCode: "invalid_grant", httpStatus: 400 });
  });

  it("tolerates a non-JSON error body", async () => {
    const f = vi.fn().mockResolvedValue(new Response("<html>502</html>", { status: 502 }));
    await expect(
      exchangeHealthAuthCode({ ...CREDS, code: "c", redirectUri: REDIRECT }, f),
    ).rejects.toThrow(/HTTP 502/);
  });
});

describe("GoogleHealthOAuthError.isPermanent", () => {
  // This getter is the whole permanent-vs-transient classifier. A permanent
  // grant failure must mark needs_reauth and RETURN, never throw into a retry.
  it("is true for a dead grant and a bad client", () => {
    expect(new GoogleHealthOAuthError("x", 400, "invalid_grant").isPermanent).toBe(true);
    expect(new GoogleHealthOAuthError("x", 401, "invalid_client").isPermanent).toBe(true);
  });

  it("is false for transient and unknown failures", () => {
    expect(new GoogleHealthOAuthError("x", 503, undefined).isPermanent).toBe(false);
    expect(new GoogleHealthOAuthError("x", 429, "rate_limit_exceeded").isPermanent).toBe(false);
  });
});

describe("refreshHealthAccessToken", () => {
  it("posts a refresh_token grant", async () => {
    const f = okJson({ access_token: "a2", expires_in: 3600, scope: "s", token_type: "Bearer" });
    await refreshHealthAccessToken({ ...CREDS, refreshToken: "r" }, f);
    const body = f.mock.calls[0]![1]?.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("r");
  });

  // Google often omits a new refresh_token on refresh. Not surfacing one makes
  // it impossible for a caller to overwrite a good stored token with undefined.
  it("does not surface a refresh token even when Google returns one", async () => {
    const f = okJson({
      access_token: "a2",
      refresh_token: "rotated",
      expires_in: 3600,
      scope: "s",
      token_type: "Bearer",
    });
    const t = await refreshHealthAccessToken({ ...CREDS, refreshToken: "r" }, f);
    expect(Object.keys(t)).toEqual(["accessToken", "expiresAt"]);
  });
});

describe("revokeHealthToken", () => {
  it("reports success on a 200", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    await expect(revokeHealthToken("t", f)).resolves.toBe(true);
  });

  // A disconnect must always proceed to clear local credentials; an unreachable
  // Google must not strand the user in a connected state.
  it("resolves false instead of throwing when Google is unreachable", async () => {
    const f = vi.fn().mockRejectedValue(new Error("network down"));
    await expect(revokeHealthToken("t", f)).resolves.toBe(false);
  });

  it("resolves false on a non-2xx", async () => {
    const f = vi.fn().mockResolvedValue(new Response("", { status: 400 }));
    await expect(revokeHealthToken("t", f)).resolves.toBe(false);
  });
});
