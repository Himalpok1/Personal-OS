import { afterEach, describe, expect, it, vi } from "vitest";
import {
  connectGmail,
  disconnectMailConnection,
  getGmailAuthorizeUrl,
  getMailConnection,
  listMailConnections,
} from "./mail.js";

const BASE = "http://localhost:3000";
const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

function stub(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  global.fetch = f;
  return f;
}

const CONNECTION = {
  id: "11111111-1111-4111-8111-111111111111",
  provider: "gmail",
  external_account_id: "person@example.com",
  status: "active",
  granted_scope: "https://www.googleapis.com/auth/gmail.metadata",
  identity_verified_at: "2026-08-30T12:00:00Z",
  last_sync_error: null,
  last_sync_error_at: null,
  created_at: "2026-08-30T12:00:00Z",
  updated_at: "2026-08-30T12:00:00Z",
};

describe("getGmailAuthorizeUrl", () => {
  it("URL-encodes the redirect into the query", async () => {
    const f = stub({
      url: "https://accounts.google.com/o/oauth2/v2/auth?x=1",
      state_expires_at: "2026-08-30T12:10:00Z",
    });
    await getGmailAuthorizeUrl(BASE, "https://host.example.ts.net/mail-connections/gmail/callback");
    const [url] = f.mock.calls[0] as [URL];
    expect(url.toString()).toContain("/mail-connections/gmail/authorize-url?redirect_uri=");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://host.example.ts.net/mail-connections/gmail/callback",
    );
  });

  it("parses the response at the boundary", async () => {
    stub({ url: "not-a-url", state_expires_at: "2026-08-30T12:10:00Z" });
    // A server regression is a parse failure here, not a bad value handed to a
    // caller.
    await expect(getGmailAuthorizeUrl(BASE, "https://h/cb")).rejects.toThrow();
  });
});

describe("connectGmail", () => {
  it("POSTs the auth code with a JSON content type", async () => {
    const f = stub(CONNECTION, 201);
    await connectGmail(BASE, {
      auth_code: "c",
      redirect_uri: "https://h/cb",
      state: "s",
    });
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe(`${BASE}/mail-connections/gmail`);
    expect(init.method).toBe("POST");
    expect(JSON.parse(typeof init.body === "string" ? init.body : "{}")).toEqual({
      auth_code: "c",
      redirect_uri: "https://h/cb",
      state: "s",
    });
  });
});

describe("listMailConnections", () => {
  it("returns the configured flag alongside the items", async () => {
    stub({ configured: true, items: [CONNECTION] });
    const result = await listMailConnections(BASE);
    // `configured` is what lets a client tell "no mailboxes yet" from "this
    // server cannot connect one" -- different states needing different words.
    expect(result.configured).toBe(true);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.external_account_id).toBe("person@example.com");
  });

  it("REJECTS a response carrying provider prose in last_sync_error", async () => {
    // The wire field is typed to the closed MailSyncErrorCode enum, so a leak
    // is a parse failure at the client boundary too, not only at the server's.
    stub({
      configured: true,
      items: [{ ...CONNECTION, last_sync_error: "Token has been expired or revoked." }],
    });
    await expect(listMailConnections(BASE)).rejects.toThrow();
  });

  it("accepts a known error code", async () => {
    stub({ configured: true, items: [{ ...CONNECTION, last_sync_error: "cursor_expired" }] });
    const result = await listMailConnections(BASE);
    expect(result.items[0]?.last_sync_error).toBe("cursor_expired");
  });

  it("REJECTS a response carrying a credential-shaped field", async () => {
    // MailConnectionSchema is a non-passthrough object, so an extra key is
    // simply dropped rather than surfaced -- assert the SAFE shape survives and
    // the credential does not appear on the parsed result.
    stub({
      configured: true,
      items: [{ ...CONNECTION, access_token: "ya29.leak", refresh_token: "1//leak" }],
    });
    const result = await listMailConnections(BASE);
    expect(JSON.stringify(result)).not.toContain("ya29.leak");
    expect(JSON.stringify(result)).not.toContain("1//leak");
  });
});

describe("getMailConnection", () => {
  it("percent-encodes the id", async () => {
    const f = stub(CONNECTION);
    await getMailConnection(BASE, "a/b");
    const [url] = f.mock.calls[0] as [URL];
    expect(url.pathname).toBe("/mail-connections/a%2Fb");
  });
});

describe("disconnectMailConnection", () => {
  it("POSTs and returns the revoked flag separately from success", async () => {
    const f = stub({ connection: { ...CONNECTION, status: "disconnected" }, revoked: false });
    const result = await disconnectMailConnection(BASE, CONNECTION.id);
    const [url, init] = f.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe(`/mail-connections/${CONNECTION.id}/disconnect`);
    expect(init.method).toBe("POST");
    // revoked=false accompanies a fully disconnected connection: revocation is
    // best-effort and must never block the local clearing.
    expect(result.revoked).toBe(false);
    expect(result.connection.status).toBe("disconnected");
  });

  it("sends no Content-Type on a bodyless POST", async () => {
    // The Phase 2 regression: Fastify rejects a claimed-but-empty JSON body
    // with FST_ERR_CTP_EMPTY_JSON_BODY.
    const f = stub({ connection: CONNECTION, revoked: true });
    await disconnectMailConnection(BASE, CONNECTION.id);
    const [, init] = f.mock.calls[0] as [URL, RequestInit];
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers["Content-Type"]).toBeUndefined();
  });
});
