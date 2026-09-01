import { decryptSecret } from "@personal-os/ai-providers";
import { mailConnections, mailOauthStates } from "@personal-os/db";
import {
  createFakeMailClient,
  GmailApiError,
  GMAIL_METADATA_SCOPE,
} from "@personal-os/mail-providers";
import { eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { env } from "../env.js";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";

const REDIRECT = "https://personal-os.tail62a68f.ts.net/mail-connections/gmail/callback";
const ALT_REDIRECT = "https://alt.example.ts.net/mail-connections/gmail/callback";

let app: FastifyInstance;
let fake: ReturnType<typeof createFakeMailClient>;

beforeAll(async () => {
  fake = createFakeMailClient();
  app = await buildTestApp({ gmailClient: fake });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables(app);
  // Drop every queued response AND every recorded call. The app is built
  // once with one fake, so a response queued by a test that failed before
  // consuming it would otherwise be drained by the NEXT test -- which is how
  // this suite first produced passes for code paths nobody exercised.
  fake.reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs Google's token endpoint. No test here ever reaches the network. */
function stubTokenEndpoint(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    }),
  );
  vi.stubGlobal("fetch", f);
  return f;
}

const TOKENS = {
  access_token: "ya29.fake-access",
  refresh_token: "1//fake-refresh",
  expires_in: 3600,
  scope: GMAIL_METADATA_SCOPE,
};

/** Mints a real state row through the authorize-url route. */
async function mintState(redirect = REDIRECT): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(redirect)}`,
  });
  expect(res.statusCode).toBe(200);
  const url = new URL(res.json<{ url: string }>().url);
  return url.searchParams.get("state")!;
}

/** Runs one full callback with a scripted profile. */
async function callback(opts: {
  state: string;
  code?: string;
  email?: string;
  historyId?: string;
  tokens?: unknown;
  tokenStatus?: number;
  /** Lets a test present itself as a browser (Checkpoint 7.7). */
  accept?: string;
}) {
  stubTokenEndpoint(opts.tokens ?? TOKENS, opts.tokenStatus ?? 200);
  if (opts.email !== undefined) {
    fake.queueProfile({ emailAddress: opts.email, historyId: opts.historyId ?? "1000" });
  }
  return await app.inject({
    method: "GET",
    url: `/mail-connections/gmail/callback?code=${encodeURIComponent(opts.code ?? "auth-code")}&state=${encodeURIComponent(opts.state)}`,
    ...(opts.accept === undefined ? {} : { headers: { accept: opts.accept } }),
  });
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

describe("GET /mail-connections/gmail/authorize-url", () => {
  it("requests EXACTLY gmail.metadata and nothing else", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    });
    expect(res.statusCode).toBe(200);
    const url = new URL(res.json<{ url: string }>().url);
    const scope = url.searchParams.get("scope");
    expect(scope).toBe(GMAIL_METADATA_SCOPE);
    // The scopes this checkpoint must never request.
    for (const forbidden of [
      "gmail.readonly",
      "gmail.modify",
      "gmail.send",
      "gmail.compose",
      "gmail.insert",
      "gmail.settings",
      "gmail.labels",
      "mail.google.com",
      "openid",
      "userinfo.email",
    ]) {
      expect(scope).not.toContain(forbidden);
    }
    expect(scope!.split(" ")).toHaveLength(1);
  });

  it("sends the exact redirect, offline access, and an ADDITIVE consent", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    });
    const url = new URL(res.json<{ url: string }>().url);
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("response_type")).toBe("code");
    // CORRECTED, not loosened (ADR-053a). This asserted "false" under the
    // comment "Never inherit the Calendar/Health grants held by the same
    // account" -- which pinned the defect as correct behaviour. `false` makes
    // the consent NON-ADDITIVE, so it REPLACES the app's grant instead of
    // adding to it, and it is what revoked the live Calendar and Health grants
    // 11 and 56 minutes after Checkpoint 7.2's consent.
    //
    // Asserted at the ROUTE as well as in the provider, because this is the
    // string a real browser is actually sent.
    expect(url.searchParams.get("include_granted_scopes")).toBe("true");
  });

  it("forces consent, because no mailbox is known before consent", async () => {
    // Being wrong in this direction costs one extra consent screen; being wrong
    // the other way costs a connection that can never refresh unattended.
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    });
    expect(new URL(res.json<{ url: string }>().url).searchParams.get("prompt")).toBe("consent");
  });

  it("accepts the second allowlisted redirect", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(ALT_REDIRECT)}`,
    });
    expect(res.statusCode).toBe(200);
    expect(new URL(res.json<{ url: string }>().url).searchParams.get("redirect_uri")).toBe(
      ALT_REDIRECT,
    );
  });

  it("REJECTS a redirect outside the allowlist without saying what is allowed", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent("https://evil.example.com/steal")}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_redirect_uri" });
    // An attacker probing redirects learns only that theirs was rejected.
    expect(res.body).not.toContain("tail62a68f");
    expect(res.body).not.toContain("alt.example");
  });

  it("stores ONLY the sha256 of the state, never the raw value", async () => {
    const state = await mintState();
    const rows = await app.db.select().from(mailOauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).not.toBe(state);
    expect(rows[0]!.stateHash).toMatch(/^[0-9a-f]{64}$/);
    // A database dump cannot be replayed into a consent flow.
    expect(rows[0]!.stateHash).not.toContain(state);
    expect(rows[0]!.redirectUri).toBe(REDIRECT);
    expect(rows[0]!.consumedAt).toBeNull();
  });

  it("mints a high-entropy state and a fresh one each time", async () => {
    const a = await mintState();
    const b = await mintState();
    expect(a).not.toBe(b);
    // 32 random bytes, base64url.
    expect(a.length).toBeGreaterThanOrEqual(43);
  });
});

// ---------------------------------------------------------------------------
// Callback — happy path
// ---------------------------------------------------------------------------

describe("GET /mail-connections/gmail/callback", () => {
  it("connects a first mailbox and returns 201", async () => {
    const state = await mintState();
    const res = await callback({ state, email: "Person@Example.com", historyId: "998877" });

    expect(res.statusCode).toBe(201);
    const body = res.json<{ external_account_id: string; status: string; granted_scope: string }>();
    // Identity came from users.getProfile and was normalized.
    expect(body.external_account_id).toBe("person@example.com");
    expect(body.status).toBe("active");
    expect(body.granted_scope).toBe(GMAIL_METADATA_SCOPE);
    // getProfile, not an id_token.
    expect(fake.callsFor("getProfile")).toHaveLength(1);
  });

  it("ENCRYPTS both credentials and stores no plaintext", async () => {
    const state = await mintState();
    await callback({ state, email: "a@example.com" });

    const [row] = await app.db.select().from(mailConnections);
    expect(row).toBeDefined();
    // Both triples complete -- the all-or-nothing CHECK would have rejected a
    // partial write.
    expect(row!.accessTokenCiphertext).not.toBeNull();
    expect(row!.accessTokenIv).not.toBeNull();
    expect(row!.accessTokenAuthTag).not.toBeNull();
    expect(row!.refreshTokenCiphertext).not.toBeNull();

    const raw = JSON.stringify(row);
    expect(raw).not.toContain(TOKENS.access_token);
    expect(raw).not.toContain(TOKENS.refresh_token);

    // ...and they round-trip through the ONE existing crypto implementation.
    expect(
      decryptSecret(
        {
          ciphertext: row!.accessTokenCiphertext!,
          iv: row!.accessTokenIv!,
          authTag: row!.accessTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe(TOKENS.access_token);
    expect(
      decryptSecret(
        {
          ciphertext: row!.refreshTokenCiphertext!,
          iv: row!.refreshTokenIv!,
          authTag: row!.refreshTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe(TOKENS.refresh_token);
  });

  it("records identity_verified_at and the granted scope", async () => {
    const state = await mintState();
    await callback({ state, email: "a@example.com" });
    const [row] = await app.db.select().from(mailConnections);
    expect(row!.identityVerifiedAt).toBeInstanceOf(Date);
    expect(row!.grantedScope).toBe(GMAIL_METADATA_SCOPE);
  });

  it("does NOT start synchronization or persist any message", async () => {
    const state = await mintState();
    await callback({ state, email: "a@example.com" });
    // 7.2 owns the lifecycle only. No cursor row, no message row, no job.
    const counts = await app.db.execute(
      sql`select
            (select count(*)::int from mail_messages)     as messages,
            (select count(*)::int from mail_sync_cursors) as cursors,
            (select count(*)::int from mail_sync_runs)    as runs`,
    );
    const row = counts.rows[0] as { messages: number; cursors: number; runs: number };
    expect(row.messages).toBe(0);
    expect(row.cursors).toBe(0);
    expect(row.runs).toBe(0);
    // The client was asked for a profile and nothing else -- no listMessages,
    // no listHistory.
    expect(fake.callsFor("listMessages")).toHaveLength(0);
    expect(fake.callsFor("listHistory")).toHaveLength(0);
    expect(fake.callsFor("getMessageMetadata")).toHaveLength(0);
  });

  it("consumes the state exactly once — a replayed callback is rejected", async () => {
    const state = await mintState();
    expect((await callback({ state, email: "a@example.com" })).statusCode).toBe(201);

    // Same state again. The second attempt must fail, and must not create or
    // mutate a connection.
    const replay = await callback({ state, email: "a@example.com" });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: "invalid_state" });
    const rows = await app.db.select().from(mailConnections);
    expect(rows).toHaveLength(1);
  });

  it("does NOT spend the authorization code when the state is bad", async () => {
    // Validation precedes exchange, so a forged callback never causes a token
    // exchange -- the code is never presented to Google at all.
    const f = stubTokenEndpoint(TOKENS);
    const res = await app.inject({
      method: "GET",
      url: "/mail-connections/gmail/callback?code=stolen-code&state=never-minted",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
    expect(f).not.toHaveBeenCalled();
  });

  it("rejects an expired state", async () => {
    const state = await mintState();
    // Backdate the only state row so expiry is genuinely exercised. Note the
    // row is still CONSUMED by the attempt -- expiry is checked after the
    // atomic consume, which is the correct order: an expired state must not
    // remain replayable.
    await app.db.update(mailOauthStates).set({ expiresAt: new Date(Date.now() - 1000) });

    const res = await callback({ state, email: "a@example.com" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
    expect(await app.db.select().from(mailConnections)).toHaveLength(0);
  });

  it("rejects a state issued for a DIFFERENT redirect", async () => {
    // The callback resolves its redirect from the allowlist by path, so a state
    // minted for the alt redirect cannot be replayed against the primary one.
    const state = await mintState(ALT_REDIRECT);
    const res = await callback({ state, email: "a@example.com" });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
  });

  it("rejects a denied consent cleanly", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mail-connections/gmail/callback?error=access_denied&state=whatever",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "gmail_consent_failed" });
  });

  it("rejects a malformed callback missing code or state", async () => {
    for (const url of [
      "/mail-connections/gmail/callback",
      "/mail-connections/gmail/callback?code=only",
      "/mail-connections/gmail/callback?state=only",
    ]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toEqual({ error: "missing_code_or_state" });
    }
  });

  it("maps a failed token exchange to 422 WITHOUT the provider's prose", async () => {
    const state = await mintState();
    const res = await callback({
      state,
      tokens: {
        error: "invalid_grant",
        error_description: "Token has been expired or revoked.",
      },
      tokenStatus: 400,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "gmail_oauth_failed" });
    expect(res.body).not.toContain("expired or revoked");
    expect(await app.db.select().from(mailConnections)).toHaveLength(0);
  });

  it("maps a failed identity lookup to 422 and persists NOTHING", async () => {
    const state = await mintState();
    stubTokenEndpoint(TOKENS);
    fake.queueProfile(new GmailApiError(403, "PERMISSION_DENIED", [{ reason: "forbidden" }], null));
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "gmail_api_failed" });
    // Nothing is written until identity is verified.
    expect(await app.db.select().from(mailConnections)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Refresh-token semantics
// ---------------------------------------------------------------------------

describe("refresh token handling", () => {
  it("REFUSES a first connection with no refresh token", async () => {
    // Without one the connection could never refresh unattended, and storing it
    // as `active` would be a lie 7.3 would trip over.
    const state = await mintState();
    const res = await callback({
      state,
      email: "a@example.com",
      tokens: { access_token: "at", expires_in: 3600, scope: GMAIL_METADATA_SCOPE },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "missing_refresh_token" });
    expect(await app.db.select().from(mailConnections)).toHaveLength(0);
  });

  it("does NOT erase a stored refresh token when a later response omits one", async () => {
    // Google omits refresh_token on most re-authorizations. The stored one is
    // still valid and must survive.
    const s1 = await mintState();
    await callback({ state: s1, email: "a@example.com" });
    const [before] = await app.db.select().from(mailConnections);
    const storedRefresh = before!.refreshTokenCiphertext;
    expect(storedRefresh).not.toBeNull();

    const s2 = await mintState();
    const res = await callback({
      state: s2,
      email: "a@example.com",
      tokens: { access_token: "at-2", expires_in: 3600, scope: GMAIL_METADATA_SCOPE },
    });
    expect(res.statusCode).toBe(200); // reconnect, not created

    const [after] = await app.db.select().from(mailConnections);
    expect(after!.refreshTokenCiphertext).toEqual(storedRefresh);
    expect(
      decryptSecret(
        {
          ciphertext: after!.refreshTokenCiphertext!,
          iv: after!.refreshTokenIv!,
          authTag: after!.refreshTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe(TOKENS.refresh_token);
    // The access token DID rotate.
    expect(
      decryptSecret(
        {
          ciphertext: after!.accessTokenCiphertext!,
          iv: after!.accessTokenIv!,
          authTag: after!.accessTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe("at-2");
  });

  it("REPLACES the stored refresh token when Google issues a new one", async () => {
    const s1 = await mintState();
    await callback({ state: s1, email: "a@example.com" });
    const s2 = await mintState();
    await callback({
      state: s2,
      email: "a@example.com",
      tokens: { ...TOKENS, refresh_token: "1//rotated" },
    });
    const [row] = await app.db.select().from(mailConnections);
    expect(
      decryptSecret(
        {
          ciphertext: row!.refreshTokenCiphertext!,
          iv: row!.refreshTokenIv!,
          authTag: row!.refreshTokenAuthTag!,
        },
        env.CREDENTIALS_ENCRYPTION_KEY,
      ),
    ).toBe("1//rotated");
  });
});

// ---------------------------------------------------------------------------
// Multiple mailboxes and reconnect
// ---------------------------------------------------------------------------

describe("multiple mailboxes", () => {
  it("lets two Gmail accounts coexist as separate connections", async () => {
    const s1 = await mintState();
    expect((await callback({ state: s1, email: "work@example.com" })).statusCode).toBe(201);
    const s2 = await mintState();
    expect((await callback({ state: s2, email: "personal@example.com" })).statusCode).toBe(201);

    const rows = await app.db.select().from(mailConnections);
    expect(rows).toHaveLength(2);
    expect(rows.map((r) => r.externalAccountId).sort()).toEqual([
      "personal@example.com",
      "work@example.com",
    ]);
  });

  it("one mailbox's callback CANNOT overwrite another's connection", async () => {
    // The failure mode Health structurally cannot have, because it is
    // single-account and looks its prior row up with .limit(1). Mail looks up
    // by (provider, external_account_id) AFTER identity, which is what makes
    // this safe.
    const s1 = await mintState();
    await callback({ state: s1, email: "work@example.com", historyId: "111" });
    const [work] = await app.db
      .select()
      .from(mailConnections)
      .where(eq(mailConnections.externalAccountId, "work@example.com"));
    const workAccessBefore = work!.accessTokenCiphertext;

    const s2 = await mintState();
    await callback({
      state: s2,
      email: "personal@example.com",
      tokens: { ...TOKENS, access_token: "ya29.personal" },
    });

    const [workAfter] = await app.db
      .select()
      .from(mailConnections)
      .where(eq(mailConnections.externalAccountId, "work@example.com"));
    expect(workAfter!.id).toBe(work!.id);
    expect(workAfter!.accessTokenCiphertext).toEqual(workAccessBefore);
  });

  it("reconnecting the same mailbox REUSES the row rather than duplicating it", async () => {
    const s1 = await mintState();
    const first = await callback({ state: s1, email: "a@example.com" });
    expect(first.statusCode).toBe(201);
    const firstId = first.json<{ id: string; created_at: string }>();

    const s2 = await mintState();
    const second = await callback({ state: s2, email: "a@example.com" });
    expect(second.statusCode).toBe(200);
    const secondId = second.json<{ id: string; created_at: string }>();

    expect(secondId.id).toBe(firstId.id);
    // History is preserved, not recreated.
    expect(secondId.created_at).toBe(firstId.created_at);
    expect(await app.db.select().from(mailConnections)).toHaveLength(1);
  });

  it("normalizes case so one mailbox cannot become two rows", async () => {
    const s1 = await mintState();
    await callback({ state: s1, email: "Person@Example.com" });
    const s2 = await mintState();
    const res = await callback({ state: s2, email: "person@EXAMPLE.com" });
    expect(res.statusCode).toBe(200);
    expect(await app.db.select().from(mailConnections)).toHaveLength(1);
  });
});

describe("reconnect after disconnect / needs_reauth", () => {
  async function connectOnce(email = "a@example.com") {
    const state = await mintState();
    const res = await callback({ state, email });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  it("a DISCONNECTED mailbox reconnects to active with credentials restored", async () => {
    const id = await connectOnce();
    await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });

    const state = await mintState();
    const res = await callback({ state, email: "a@example.com" });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("active");

    const [row] = await app.db.select().from(mailConnections);
    expect(row!.id).toBe(id);
    expect(row!.accessTokenCiphertext).not.toBeNull();
    expect(row!.refreshTokenCiphertext).not.toBeNull();
    // NOTHING stays disabled after a reconnect. This is the deliberate
    // divergence from Health, where disconnect disables every stream and
    // reconnect does not restore them, leaving a connection that is "active"
    // but silently syncs nothing. Mail has no per-mailbox enable flag at all,
    // so that class of defect is unrepresentable rather than merely avoided.
    expect(row!.status).toBe("active");
  });

  it("a NEEDS_REAUTH mailbox reconnects and its error is cleared", async () => {
    const id = await connectOnce();
    await app.db
      .update(mailConnections)
      .set({ status: "needs_reauth", lastSyncError: "auth_expired", lastSyncErrorAt: new Date() })
      .where(eq(mailConnections.id, id));

    const state = await mintState();
    const res = await callback({ state, email: "a@example.com" });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ status: string; last_sync_error: string | null }>();
    expect(body.status).toBe("active");
    // A successful reconnect clears whatever failure sent the user here.
    expect(body.last_sync_error).toBeNull();
  });

  it("a reconnected mailbox is left in a state 7.3 can synchronize", async () => {
    const id = await connectOnce();
    await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    const state = await mintState();
    await callback({ state, email: "a@example.com" });

    const [row] = await app.db.select().from(mailConnections);
    // Everything a sync pass needs: active, both credential triples complete,
    // an identity, and a granted scope.
    expect(row!.status).toBe("active");
    expect(row!.accessTokenCiphertext).not.toBeNull();
    expect(row!.accessTokenIv).not.toBeNull();
    expect(row!.accessTokenAuthTag).not.toBeNull();
    expect(row!.refreshTokenCiphertext).not.toBeNull();
    expect(row!.identityVerifiedAt).not.toBeNull();
    expect(row!.grantedScope).toBe(GMAIL_METADATA_SCOPE);
  });
});

// ---------------------------------------------------------------------------
// Manual completion fallback
// ---------------------------------------------------------------------------

describe("POST /mail-connections/gmail", () => {
  it("completes through the same service and the same checks", async () => {
    const state = await mintState();
    stubTokenEndpoint(TOKENS);
    fake.queueProfile({ emailAddress: "a@example.com", historyId: "1" });
    const res = await app.inject({
      method: "POST",
      url: "/mail-connections/gmail",
      payload: { auth_code: "c", redirect_uri: REDIRECT, state },
    });
    expect(res.statusCode).toBe(201);
  });

  it("cannot bypass the redirect allowlist", async () => {
    const state = await mintState();
    const res = await app.inject({
      method: "POST",
      url: "/mail-connections/gmail",
      payload: { auth_code: "c", redirect_uri: "https://evil.example.com/cb", state },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_redirect_uri" });
  });

  it("rejects an unknown body field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mail-connections/gmail",
      payload: { auth_code: "c", redirect_uri: REDIRECT, state: "s", extra: "nope" },
    });
    expect(res.statusCode).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// Read + disconnect
// ---------------------------------------------------------------------------

describe("read and disconnect", () => {
  async function connectOnce(email = "a@example.com") {
    const state = await mintState();
    const res = await callback({ state, email });
    return res.json<{ id: string }>().id;
  }

  it("lists connections and reports whether the server can connect one", async () => {
    const empty = await app.inject({ method: "GET", url: "/mail-connections" });
    expect(empty.statusCode).toBe(200);
    expect(empty.json()).toEqual({ configured: true, items: [] });

    await connectOnce();
    const res = await app.inject({ method: "GET", url: "/mail-connections" });
    expect(res.json<{ items: unknown[] }>().items).toHaveLength(1);
  });

  it("404s an unknown connection id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mail-connections/11111111-1111-4111-8111-111111111111",
    });
    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ error: "not_found" });
  });

  it("disconnects: revokes, clears every secret column, keeps the row", async () => {
    const id = await connectOnce();
    const revoke = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", revoke);

    const res = await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ revoked: boolean; connection: { status: string } }>();
    expect(body.revoked).toBe(true);
    expect(body.connection.status).toBe("disconnected");

    const [row] = await app.db.select().from(mailConnections);
    // Row KEPT as history; every secret column NULLed.
    expect(row!.id).toBe(id);
    expect(row!.accessTokenCiphertext).toBeNull();
    expect(row!.accessTokenIv).toBeNull();
    expect(row!.accessTokenAuthTag).toBeNull();
    expect(row!.accessTokenExpiresAt).toBeNull();
    expect(row!.refreshTokenCiphertext).toBeNull();
    expect(row!.refreshTokenIv).toBeNull();
    expect(row!.refreshTokenAuthTag).toBeNull();
    // Identity and history survive.
    expect(row!.externalAccountId).toBe("a@example.com");
    expect(row!.identityVerifiedAt).not.toBeNull();
  });

  it("disconnects locally even when revocation FAILS", async () => {
    // Failing to tell Google must never leave the user unable to clear their
    // own credentials.
    const id = await connectOnce();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 400 })));
    const res = await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ revoked: boolean }>().revoked).toBe(false);
    const [row] = await app.db.select().from(mailConnections);
    expect(row!.status).toBe("disconnected");
    expect(row!.refreshTokenCiphertext).toBeNull();
  });

  it("disconnects locally even when revocation THROWS", async () => {
    const id = await connectOnce();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const res = await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ revoked: boolean }>().revoked).toBe(false);
    const [row] = await app.db.select().from(mailConnections);
    expect(row!.refreshTokenCiphertext).toBeNull();
  });

  it("is idempotent — a repeated disconnect is safe", async () => {
    const id = await connectOnce();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    const again = await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    expect(again.statusCode).toBe(200);
    // No credentials left to revoke, so revoked is honestly false the second time.
    expect(again.json<{ revoked: boolean }>().revoked).toBe(false);
    expect(again.json<{ connection: { status: string } }>().connection.status).toBe("disconnected");
  });

  it("does NOT delete mail metadata on disconnect (ADR-054)", async () => {
    const id = await connectOnce();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` });
    // There are no message rows in 7.2 anyway, but the row itself surviving is
    // the property that matters: disconnect clears credentials, never history.
    expect(await app.db.select().from(mailConnections)).toHaveLength(1);
  });

  it("404s a disconnect for an unknown id", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/mail-connections/11111111-1111-4111-8111-111111111111/disconnect",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Wire safety
// ---------------------------------------------------------------------------

describe("API wire safety", () => {
  it("no credential-bearing field can appear in ANY mail response", async () => {
    const state = await mintState();
    await callback({ state, email: "a@example.com" });
    const id = (await app.db.select().from(mailConnections))[0]!.id;

    const bodies = [
      (await app.inject({ method: "GET", url: "/mail-connections" })).body,
      (await app.inject({ method: "GET", url: `/mail-connections/${id}` })).body,
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    bodies.push(
      (await app.inject({ method: "POST", url: `/mail-connections/${id}/disconnect` })).body,
    );

    for (const body of bodies) {
      // Values.
      expect(body).not.toContain(TOKENS.access_token);
      expect(body).not.toContain(TOKENS.refresh_token);
      expect(body).not.toContain(env.GMAIL_OAUTH_CLIENT_SECRET ?? "###");
      // Field names, so a future column cannot ride along unnoticed.
      for (const key of [
        "ciphertext",
        "_iv",
        "auth_tag",
        "authTag",
        "access_token",
        "refresh_token",
        "state_hash",
        "stateHash",
        "client_secret",
      ]) {
        expect(body.toLowerCase()).not.toContain(key.toLowerCase());
      }
    }
  });

  it("never returns a raw provider message", async () => {
    const state = await mintState();
    const res = await callback({
      state,
      tokens: { error: "invalid_client", error_description: "The OAuth client was not found." },
      tokenStatus: 401,
    });
    expect(res.body).not.toContain("OAuth client was not found");
    expect(res.json()).toEqual({ error: "gmail_oauth_failed" });
  });
});

// ---------------------------------------------------------------------------
// Unconfigured Gmail
// ---------------------------------------------------------------------------

describe("when Gmail is not configured", () => {
  // The vitest env block sets the Gmail trio for every other test in this file,
  // so the unconfigured path is reached by blanking the parsed env object for
  // the duration of one test and restoring it afterwards. That exercises the
  // REAL route rather than re-deriving the config rule, which is what
  // env-mail-config.test.ts already covers at the schema level.
  //
  // The property under test is the one the Checkpoint 6.3 audit was written
  // about: an unconfigured integration must degrade to a structured 409, never
  // take the API down. Capture, calendar, health, reminders and notifications
  // must all keep working.
  const saved = {
    id: env.GMAIL_OAUTH_CLIENT_ID,
    secret: env.GMAIL_OAUTH_CLIENT_SECRET,
    redirects: env.GMAIL_OAUTH_REDIRECT_URI,
  };

  function blank(which: "all" | "id" | "secret" | "redirects") {
    if (which === "all" || which === "id") env.GMAIL_OAUTH_CLIENT_ID = undefined;
    if (which === "all" || which === "secret") env.GMAIL_OAUTH_CLIENT_SECRET = undefined;
    if (which === "all" || which === "redirects") env.GMAIL_OAUTH_REDIRECT_URI = [];
  }

  afterEach(() => {
    env.GMAIL_OAUTH_CLIENT_ID = saved.id;
    env.GMAIL_OAUTH_CLIENT_SECRET = saved.secret;
    env.GMAIL_OAUTH_REDIRECT_URI = saved.redirects;
  });

  it("returns 409 mail_not_configured from the authorize-url route", async () => {
    blank("all");
    const res = await app.inject({
      method: "GET",
      url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "mail_not_configured" });
  });

  it("returns 409 from the callback rather than crashing", async () => {
    blank("all");
    const res = await app.inject({
      method: "GET",
      url: "/mail-connections/gmail/callback?code=c&state=s",
    });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "mail_not_configured" });
  });

  it("treats EVERY partial configuration as unconfigured", async () => {
    // A half-configured client cannot complete a flow, so one clear 409 beats
    // three different failures at Google.
    for (const missing of ["id", "secret", "redirects"] as const) {
      blank(missing);
      const res = await app.inject({
        method: "GET",
        url: `/mail-connections/gmail/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
      });
      expect(res.statusCode, `blanking ${missing} should 409`).toBe(409);
      env.GMAIL_OAUTH_CLIENT_ID = saved.id;
      env.GMAIL_OAUTH_CLIENT_SECRET = saved.secret;
      env.GMAIL_OAUTH_REDIRECT_URI = saved.redirects;
    }
  });

  it("still LISTS connections, reporting configured:false", async () => {
    blank("all");
    const res = await app.inject({ method: "GET", url: "/mail-connections" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ configured: false, items: [] });
  });

  it("leaves every other API surface working", async () => {
    // The actual regression this guards: an unconfigured optional integration
    // must not take down capture, tasks, today or the liveness probe.
    blank("all");
    for (const url of ["/health", "/tasks", "/today?tz=America/Chicago", "/inbox"]) {
      const res = await app.inject({ method: "GET", url });
      expect(res.statusCode, `${url} should still work`).toBeLessThan(400);
    }
  });
});

describe("GET /mail-connections/gmail/callback — browser landing (Checkpoint 7.7)", () => {
  // Google redirects the USER'S BROWSER here. Before this, the route answered a
  // raw JSON body, so a person who completed consent landed on a wall of JSON
  // with no sign it had worked. The connection was created; the ending was
  // unreadable.

  it("gives a BROWSER a readable page", async () => {
    const state = await mintState();
    const res = await callback({
      state,
      email: "person@example.com",
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Mailbox connected");
    expect(res.body).toContain("return to Personal OS");
  });

  it("the page carries NO address, token or identifier", async () => {
    // It is static, so there is nothing to leak and nothing to escape.
    const state = await mintState();
    const res = await callback({ state, email: "person@example.com", accept: "text/html" });
    expect(res.body).not.toContain("@");
    expect(res.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    expect(res.body).not.toContain("auth-code");
    expect(res.body.toLowerCase()).not.toContain("token");
  });

  it("STILL gives an API client JSON — nothing that worked has changed", async () => {
    const state = await mintState();
    const res = await callback({ state, email: "person@example.com", accept: "application/json" });
    expect(res.headers["content-type"]).toContain("application/json");
    expect(res.json()).toMatchObject({ provider: "gmail", status: "active" });
  });

  it("treats a bare */* as an API client, not a browser", async () => {
    // curl sends `*/*`. Only an explicit text/html preference gets the page.
    const state = await mintState();
    const res = await callback({ state, email: "person@example.com", accept: "*/*" });
    expect(res.headers["content-type"]).toContain("application/json");
  });

  it("gives a browser a readable FAILURE page carrying only the static code", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/mail-connections/gmail/callback?code=x&state=not-a-real-state",
      headers: { accept: "text/html" },
    });
    expect(res.statusCode).toBe(400);
    expect(res.headers["content-type"]).toContain("text/html");
    expect(res.body).toContain("Couldn");
    expect(res.body).toContain("invalid_state");
    // Nothing was changed, and the page says so rather than implying a partial
    // connection.
    expect(res.body).toContain("Nothing was changed");
  });
});
