import { afterEach, describe, expect, it, vi } from "vitest";
import { GoogleOAuthError, exchangeAuthCode, refreshAccessToken } from "./google-oauth.js";

function base64url(json: unknown): string {
  return Buffer.from(JSON.stringify(json)).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fakeIdToken(payload: { sub: string; email: string }): string {
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const body = base64url(payload);
  return `${header}.${body}.fake-signature`;
}

describe("exchangeAuthCode", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("exchanges a code for tokens and extracts sub/email from the id_token", async () => {
    const idToken = fakeIdToken({ sub: "1234567890", email: "user@example.com" });
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "access-abc",
          refresh_token: "refresh-abc",
          expires_in: 3600,
          scope: "https://www.googleapis.com/auth/calendar",
          id_token: idToken,
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
    const result = await exchangeAuthCode({
      code: "auth-code",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(result.accessToken).toBe("access-abc");
    expect(result.refreshToken).toBe("refresh-abc");
    expect(result.scope).toBe("https://www.googleapis.com/auth/calendar");
    expect(result.googleAccountId).toBe("1234567890");
    expect(result.googleAccountEmail).toBe("user@example.com");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 3600 * 1000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://oauth2.googleapis.com/token");
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    // No redirect_uri: this native flow never involves one (see Stage A
    // evidence in google-oauth.ts's exchangeAuthCode comment).
    expect(body.has("redirect_uri")).toBe(false);
  });

  it("throws GoogleOAuthError with the raw Google error code on invalid_grant", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: "invalid_grant", error_description: "Bad Request" }), { status: 400 }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      exchangeAuthCode({
        code: "bad-code",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).rejects.toMatchObject({
      name: "GoogleOAuthError",
      googleErrorCode: "invalid_grant",
      httpStatus: 400,
    });
  });

  it("marks invalid_grant/invalid_client as permanent and other errors as not permanent", async () => {
    const permanent = new GoogleOAuthError("bad grant", 400, "invalid_grant");
    expect(permanent.isPermanent).toBe(true);

    const transient = new GoogleOAuthError("server error", 503, undefined);
    expect(transient.isPermanent).toBe(false);
  });

  it("throws when Google omits refresh_token on the exchange", async () => {
    const idToken = fakeIdToken({ sub: "1", email: "a@b.com" });
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "access-abc",
            expires_in: 3600,
            scope: "openid",
            id_token: idToken,
            token_type: "Bearer",
          }),
          { status: 200 },
        ),
      ),
    );

    await expect(
      exchangeAuthCode({
        code: "auth-code",
        clientId: "client-id",
        clientSecret: "client-secret",
      }),
    ).rejects.toThrow(/refresh_token/);
  });
});

describe("refreshAccessToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refreshes and reports expiresAt without requiring a new refresh_token", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: "new-access",
          expires_in: 1800,
          scope: "https://www.googleapis.com/auth/calendar",
          token_type: "Bearer",
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
    const result = await refreshAccessToken({
      refreshToken: "refresh-abc",
      clientId: "client-id",
      clientSecret: "client-secret",
    });

    expect(result.accessToken).toBe("new-access");
    expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 1800 * 1000);

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("refresh_token");
    expect(body.get("refresh_token")).toBe("refresh-abc");
  });

  it("throws GoogleOAuthError on invalid_grant (revoked refresh token)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been revoked" }), {
          status: 400,
        }),
      ),
    );

    await expect(
      refreshAccessToken({ refreshToken: "revoked", clientId: "client-id", clientSecret: "client-secret" }),
    ).rejects.toMatchObject({ name: "GoogleOAuthError", googleErrorCode: "invalid_grant" });
  });
});
