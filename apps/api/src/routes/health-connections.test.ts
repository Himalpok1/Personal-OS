import { decryptSecret } from "@personal-os/ai-providers";
import {
  healthConnections,
  healthMetricStreams,
  healthOauthStates,
  healthSyncRuns,
} from "@personal-os/db";
import { createFakeGoogleHealthClient, PHASE_6A_SCOPES } from "@personal-os/health-providers";
import { and, eq, sql } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import { HEALTH_SYNC_CONNECTION_QUEUE } from "../queue-names.js";

const REDIRECT = "https://personal-os.tail62a68f.ts.net/health-connections/google/callback";
const ALT_REDIRECT = "https://alt.example.ts.net/health-connections/google/callback";
const ALL_SCOPES = PHASE_6A_SCOPES.join(" ");

let app: FastifyInstance;
let fake: ReturnType<typeof createFakeGoogleHealthClient>;

beforeAll(async () => {
  fake = createFakeGoogleHealthClient({
    identity: { healthUserId: "hu-primary", legacyUserId: "fitbit-legacy-1" },
  });
  app = await buildTestApp({ googleHealthClient: fake });
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

beforeEach(async () => {
  await truncateTestTables(app);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs Google's token endpoint. No test ever reaches the network. */
function stubTokenEndpoint(body: unknown, status = 200) {
  const f = vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", f);
  return f;
}

function tokenResponse(over: Record<string, unknown> = {}) {
  return {
    access_token: "ya29.access-token-value",
    refresh_token: "1//refresh-token-value",
    expires_in: 3600,
    scope: ALL_SCOPES,
    token_type: "Bearer",
    ...over,
  };
}

/** Mints a real state through the API, exactly as a browser flow would. */
async function mintState(redirect = REDIRECT): Promise<string> {
  const res = await app.inject({
    method: "GET",
    url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(redirect)}`,
  });
  expect(res.statusCode).toBe(200);
  return new URL(res.json<{ url: string }>().url).searchParams.get("state")!;
}

// ---------------------------------------------------------------------------
// Authorization URL
// ---------------------------------------------------------------------------

describe("GET /health-connections/google/authorize-url", () => {
  it("requests exactly the three Phase 6A read scopes", async () => {
    const url = new URL(
      (
        await app.inject({
          method: "GET",
          url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
        })
      ).json<{ url: string }>().url,
    );
    const scopes = url.searchParams.get("scope")!.split(" ").sort();
    expect(scopes).toEqual([...PHASE_6A_SCOPES].sort());
    expect(scopes).toHaveLength(3);
    expect(url.searchParams.get("scope")).not.toContain("writeonly");
    expect(url.searchParams.get("scope")).not.toContain("settings");
  });

  it("targets Google, carries the redirect and requests offline access", async () => {
    const url = new URL(
      (
        await app.inject({
          method: "GET",
          url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
        })
      ).json<{ url: string }>().url,
    );
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("redirect_uri")).toBe(REDIRECT);
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("response_type")).toBe("code");
  });

  // No connection yet, so a refresh token is genuinely required.
  it("forces consent when there is no existing connection", async () => {
    const url = new URL(
      (
        await app.inject({
          method: "GET",
          url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
        })
      ).json<{ url: string }>().url,
    );
    expect(url.searchParams.get("prompt")).toBe("consent");
  });

  it("persists only a HASH of the state, never the raw value", async () => {
    const state = await mintState();
    const rows = await app.db.select().from(healthOauthStates);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.stateHash).not.toBe(state);
    expect(rows[0]!.stateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(rows[0]!.redirectUri).toBe(REDIRECT);
    expect(rows[0]!.consumedAt).toBeNull();
  });

  it("returns a state expiry in the near future", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(REDIRECT)}`,
    });
    const expires = Date.parse(res.json<{ state_expires_at: string }>().state_expires_at);
    expect(expires).toBeGreaterThan(Date.now());
    expect(expires).toBeLessThanOrEqual(Date.now() + 11 * 60_000);
  });

  it("mints a different state every time", async () => {
    expect(await mintState()).not.toBe(await mintState());
  });

  // The endpoint must not become an open redirect against our own client.
  it("rejects a redirect_uri that is not allowlisted", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent("https://evil.example.com/cb")}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_redirect_uri" });
  });

  it("rejects near-miss redirects: trailing slash, different port, path extension", async () => {
    for (const bad of [
      REDIRECT + "/",
      REDIRECT.replace("://", "://") + "?x=1",
      "https://personal-os.tail62a68f.ts.net:8443/health-connections/google/callback",
      REDIRECT + "/extra",
    ]) {
      const res = await app.inject({
        method: "GET",
        url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent(bad)}`,
      });
      expect(res.statusCode, bad).toBe(400);
    }
  });

  it("writes no state row when the redirect is rejected", async () => {
    await app.inject({
      method: "GET",
      url: `/health-connections/google/authorize-url?redirect_uri=${encodeURIComponent("https://evil.example.com/cb")}`,
    });
    expect(await app.db.select().from(healthOauthStates)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Callback
// ---------------------------------------------------------------------------

describe("GET /health-connections/google/callback", () => {
  it("completes a connection and binds it to healthUserId", async () => {
    const state = await mintState();
    stubTokenEndpoint(tokenResponse());
    fake.queueIdentity({ healthUserId: "hu-primary", legacyUserId: "fitbit-legacy-1" });

    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=auth-code-1&state=${encodeURIComponent(state)}`,
    });

    expect(res.statusCode).toBe(201);
    const body = res.json<Record<string, unknown>>();
    expect(body["health_user_id"]).toBe("hu-primary");
    expect(body["status"]).toBe("active");
    expect(body["granted_scope"]).toBe(ALL_SCOPES);
  });

  it("SENDS redirect_uri on the exchange", async () => {
    const state = await mintState();
    const f = stubTokenEndpoint(tokenResponse());
    fake.queueIdentity({ healthUserId: "hu-primary", legacyUserId: null });
    await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    const sent = f.mock.calls[0]![1] as { body: URLSearchParams };
    expect(sent.body.get("redirect_uri")).toBe(REDIRECT);
    expect(sent.body.get("grant_type")).toBe("authorization_code");
  });

  it("rejects a missing code", async () => {
    const state = await mintState();
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "missing_code_or_state" });
  });

  it("rejects a missing state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health-connections/google/callback?code=abc",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "missing_code_or_state" });
  });

  // Google reports a denied consent screen as ?error=access_denied.
  it("surfaces a provider error callback cleanly", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health-connections/google/callback?error=access_denied&state=x",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "google_consent_failed" });
  });

  it("rejects an unknown state", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health-connections/google/callback?code=c&state=never-issued",
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
  });

  // Single use: a replayed callback must not mint a second connection.
  it("rejects a replayed state", async () => {
    const state = await mintState();
    stubTokenEndpoint(tokenResponse());
    fake.queueIdentity({ healthUserId: "hu-primary", legacyUserId: null });
    const first = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c1&state=${encodeURIComponent(state)}`,
    });
    expect(first.statusCode).toBe(201);

    const replay = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c2&state=${encodeURIComponent(state)}`,
    });
    expect(replay.statusCode).toBe(400);
    expect(replay.json()).toEqual({ error: "invalid_state" });
    expect(await app.db.select().from(healthConnections)).toHaveLength(1);
  });

  it("rejects an expired state", async () => {
    const state = await mintState();
    // Backdate every state row. (An earlier version of this test used
    // eq(consumedAt, consumedAt), which is NULL = NULL -> no match, so nothing
    // was backdated and the assertion passed for the wrong reason.)
    await app.db.update(healthOauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    stubTokenEndpoint(tokenResponse());
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
  });

  // A forged callback must never cause an authorization code to be spent.
  it("does not call Google's token endpoint when the state is invalid", async () => {
    const f = stubTokenEndpoint(tokenResponse());
    await app.inject({
      method: "GET",
      url: "/health-connections/google/callback?code=c&state=forged",
    });
    expect(f).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Manual completion path
// ---------------------------------------------------------------------------

describe("POST /health-connections/google", () => {
  it("goes through the same allowlist as the callback", async () => {
    const state = await mintState();
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/google",
      payload: { auth_code: "c", redirect_uri: "https://evil.example.com/cb", state },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_redirect_uri" });
  });

  // A state minted for one allowlisted redirect must not work against another.
  it("rejects a state issued for a different allowlisted redirect", async () => {
    const state = await mintState(REDIRECT);
    stubTokenEndpoint(tokenResponse());
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/google",
      payload: { auth_code: "c", redirect_uri: ALT_REDIRECT, state },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: "invalid_state" });
  });

  it("rejects an unknown body field", async () => {
    const state = await mintState();
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/google",
      payload: { auth_code: "c", redirect_uri: REDIRECT, state, extra: 1 },
    });
    expect(res.statusCode).toBe(400);
  });

  it("completes successfully with an allowlisted redirect", async () => {
    const state = await mintState();
    stubTokenEndpoint(tokenResponse());
    fake.queueIdentity({ healthUserId: "hu-primary", legacyUserId: null });
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/google",
      payload: { auth_code: "c", redirect_uri: REDIRECT, state },
    });
    expect(res.statusCode).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Token handling
// ---------------------------------------------------------------------------

async function connect(scope = ALL_SCOPES, identity = "hu-primary") {
  const state = await mintState();
  stubTokenEndpoint(tokenResponse({ scope }));
  fake.queueIdentity({ healthUserId: identity, legacyUserId: null });
  const res = await app.inject({
    method: "GET",
    url: `/health-connections/google/callback?code=c&state=${encodeURIComponent(state)}`,
  });
  return res;
}

describe("token storage", () => {
  it("stores both tokens encrypted, never as plaintext", async () => {
    await connect();
    const [row] = await app.db.select().from(healthConnections);

    for (const buf of [row!.accessTokenCiphertext!, row!.refreshTokenCiphertext!]) {
      const raw = buf.toString("utf8");
      expect(raw).not.toContain("ya29.access-token-value");
      expect(raw).not.toContain("1//refresh-token-value");
    }
    // AES-256-GCM: 12-byte IV, 16-byte auth tag.
    expect(row!.accessTokenIv!.length).toBe(12);
    expect(row!.accessTokenAuthTag!.length).toBe(16);
    expect(row!.refreshTokenIv!.length).toBe(12);
    expect(row!.refreshTokenAuthTag!.length).toBe(16);
  });

  it("round-trips through the existing credential system", async () => {
    await connect();
    const [row] = await app.db.select().from(healthConnections);
    const plain = decryptSecret(
      {
        ciphertext: row!.refreshTokenCiphertext!,
        iv: row!.refreshTokenIv!,
        authTag: row!.refreshTokenAuthTag!,
      },
      process.env["CREDENTIALS_ENCRYPTION_KEY"]!,
    );
    expect(plain).toBe("1//refresh-token-value");
  });

  it("errors when Google returns no refresh token on a first connection", async () => {
    const state = await mintState();
    stubTokenEndpoint(tokenResponse({ refresh_token: undefined }));
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "google_oauth_failed" });
    expect(await app.db.select().from(healthConnections)).toHaveLength(0);
  });

  it("surfaces invalid_grant from the exchange as a provider failure", async () => {
    const state = await mintState();
    stubTokenEndpoint({ error: "invalid_grant", error_description: "Bad Request" }, 400);
    const res = await app.inject({
      method: "GET",
      url: `/health-connections/google/callback?code=c&state=${encodeURIComponent(state)}`,
    });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: "google_oauth_failed" });
  });
});

// ---------------------------------------------------------------------------
// No token ever leaves the server
// ---------------------------------------------------------------------------

describe("responses never expose credentials", () => {
  it("omits every token field from the connection response", async () => {
    const created = await connect();
    const list = await app.inject({ method: "GET", url: "/health-connections" });
    const detail = await app.inject({
      method: "GET",
      url: `/health-connections/${created.json<{ id: string }>().id}`,
    });

    for (const payload of [created.body, list.body, detail.body]) {
      expect(payload).not.toContain("ya29.access-token-value");
      expect(payload).not.toContain("1//refresh-token-value");
      for (const forbidden of [
        "access_token",
        "refresh_token",
        "ciphertext",
        "auth_tag",
        "client_secret",
      ]) {
        expect(payload).not.toContain(forbidden);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Partial consent
// ---------------------------------------------------------------------------

describe("partial consent within the three scopes", () => {
  const ACTIVITY = "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly";

  it("enables only metrics whose scope was granted", async () => {
    const res = await connect(ACTIVITY);
    const id = res.json<{ id: string }>().id;

    const streams = await app.inject({ method: "GET", url: `/health-connections/${id}/streams` });
    const items = streams.json<{
      items: { metric: string; sync_enabled: boolean; last_sync_error: string | null }[];
    }>().items;

    const steps = items.find((i) => i.metric === "steps")!;
    const sleep = items.find((i) => i.metric === "sleep")!;
    expect(steps.sync_enabled).toBe(true);
    expect(steps.last_sync_error).toBeNull();
    expect(sleep.sync_enabled).toBe(false);
    expect(sleep.last_sync_error).toBe("scope_not_granted");
  });

  // Raw HR is the only high-volume stream and its identity strategy is unproven
  // until the 6.2P probe, so it stays off even when its scope is granted.
  it("leaves intraday heart rate disabled even when fully granted", async () => {
    const res = await connect(ALL_SCOPES);
    const id = res.json<{ id: string }>().id;
    const streams = await app.inject({ method: "GET", url: `/health-connections/${id}/streams` });
    const items = streams.json<{ items: { metric: string; sync_enabled: boolean }[] }>().items;
    expect(items.find((i) => i.metric === "heart-rate-intraday")!.sync_enabled).toBe(false);
    expect(items.find((i) => i.metric === "heart-rate")!.sync_enabled).toBe(true);
  });

  it("refuses to enable a stream whose scope was never granted", async () => {
    const res = await connect(ACTIVITY);
    const id = res.json<{ id: string }>().id;
    const patch = await app.inject({
      method: "PATCH",
      url: `/health-connections/${id}/streams`,
      payload: [{ metric: "sleep", sync_enabled: true }],
    });
    expect(patch.statusCode).toBe(409);
    expect(patch.json()).toMatchObject({ error: "scope_not_granted", metric: "sleep" });
  });

  it("allows disabling and re-enabling a granted stream", async () => {
    const res = await connect(ALL_SCOPES);
    const id = res.json<{ id: string }>().id;
    const off = await app.inject({
      method: "PATCH",
      url: `/health-connections/${id}/streams`,
      payload: [{ metric: "steps", sync_enabled: false }],
    });
    expect(off.statusCode).toBe(200);
    const items = off.json<{ items: { metric: string; sync_enabled: boolean }[] }>().items;
    expect(items.find((i) => i.metric === "steps")!.sync_enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Reconnection and account binding
// ---------------------------------------------------------------------------

describe("reconnection", () => {
  it("updates the existing connection rather than creating a second", async () => {
    const first = await connect();
    expect(first.statusCode).toBe(201);
    const second = await connect();
    expect(second.statusCode).toBe(200);
    expect(await app.db.select().from(healthConnections)).toHaveLength(1);
  });

  it("rejects a different Google Health account", async () => {
    await connect(ALL_SCOPES, "hu-primary");
    const res = await connect(ALL_SCOPES, "hu-someone-else");
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: "account_mismatch" });

    const [row] = await app.db.select().from(healthConnections);
    expect(row!.healthUserId).toBe("hu-primary");
  });

  it("preserves a user's own stream choice across a reconnect", async () => {
    const first = await connect();
    const id = first.json<{ id: string }>().id;
    await app.inject({
      method: "PATCH",
      url: `/health-connections/${id}/streams`,
      payload: [{ metric: "steps", sync_enabled: false }],
    });

    await connect();
    const streams = await app.inject({ method: "GET", url: `/health-connections/${id}/streams` });
    const items = streams.json<{ items: { metric: string; sync_enabled: boolean }[] }>().items;
    expect(items.find((i) => i.metric === "steps")!.sync_enabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Disconnect
// ---------------------------------------------------------------------------

describe("POST /health-connections/:id/disconnect", () => {
  it("revokes at Google, clears every secret column and keeps the row", async () => {
    const created = await connect();
    const id = created.json<{ id: string }>().id;

    const revoke = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", revoke);

    const res = await app.inject({ method: "POST", url: `/health-connections/${id}/disconnect` });
    expect(res.statusCode).toBe(200);
    expect(res.json<{ status: string }>().status).toBe("disconnected");

    expect(String(revoke.mock.calls[0]![0])).toBe("https://oauth2.googleapis.com/revoke");

    const [row] = await app.db.select().from(healthConnections);
    // The row SURVIVES as connection history -- only the credentials die.
    expect(row).toBeDefined();
    expect(row!.accessTokenCiphertext).toBeNull();
    expect(row!.accessTokenIv).toBeNull();
    expect(row!.accessTokenAuthTag).toBeNull();
    expect(row!.refreshTokenCiphertext).toBeNull();
    expect(row!.refreshTokenIv).toBeNull();
    expect(row!.refreshTokenAuthTag).toBeNull();
    expect(row!.accessTokenExpiresAt).toBeNull();
    expect(row!.healthUserId).toBe("hu-primary");
  });

  // A user must always be able to disconnect, even if Google is unreachable.
  it("clears local credentials even when revocation fails", async () => {
    const created = await connect();
    const id = created.json<{ id: string }>().id;
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));

    const res = await app.inject({ method: "POST", url: `/health-connections/${id}/disconnect` });
    expect(res.statusCode).toBe(200);
    const [row] = await app.db.select().from(healthConnections);
    expect(row!.refreshTokenCiphertext).toBeNull();
    expect(row!.status).toBe("disconnected");
  });

  it("disables every stream on disconnect", async () => {
    const created = await connect();
    const id = created.json<{ id: string }>().id;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("", { status: 200 })));
    await app.inject({ method: "POST", url: `/health-connections/${id}/disconnect` });

    const rows = await app.db
      .select()
      .from(healthMetricStreams)
      .where(eq(healthMetricStreams.connectionId, id));
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => !r.syncEnabled)).toBe(true);
  });

  it("404s for an unknown connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/11111111-1111-4111-8111-111111111111/disconnect",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

describe("connection reads", () => {
  it("lists nothing before a connection exists", async () => {
    const res = await app.inject({ method: "GET", url: "/health-connections" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ items: [] });
  });

  it("404s an unknown connection id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health-connections/11111111-1111-4111-8111-111111111111",
    });
    expect(res.statusCode).toBe(404);
  });

  it("404s streams for an unknown connection id", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/health-connections/11111111-1111-4111-8111-111111111111/streams",
    });
    expect(res.statusCode).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Checkpoint 6.3 -- sync, sync-runs and backfill routes
// ---------------------------------------------------------------------------

async function connectedId(): Promise<string> {
  await connect();
  const [row] = await app.db.select().from(healthConnections);
  return row!.id;
}

describe("POST /health-connections/:id/sync", () => {
  it("enqueues exactly one connection-level job and reports it", async () => {
    const id = await connectedId();
    const res = await app.inject({ method: "POST", url: `/health-connections/${id}/sync` });
    expect(res.statusCode).toBe(202);
    expect(res.json<{ queued: number }>().queued).toBe(1);
  });

  it("suppresses duplicates: repeated requests never build an unbounded queue", async () => {
    const id = await connectedId();
    // `stately` allows one job per state per singletonKey. With retryLimit 0
    // no `retry` row can exist, so the depth is provably <= 1 created + 1
    // active per connection no matter how fast requests arrive.
    for (let i = 0; i < 25; i += 1) {
      const res = await app.inject({ method: "POST", url: `/health-connections/${id}/sync` });
      expect(res.statusCode).toBe(202);
    }
    const rows = await app.db.execute(
      sql`select count(*)::int as n from pgboss.job
          where name = ${HEALTH_SYNC_CONNECTION_QUEUE}
            and singleton_key = ${id}
            and state < 'completed'`,
    );
    const n = (rows.rows[0] as { n: number }).n;
    expect(n).toBeLessThanOrEqual(2);
  });

  it("honours an explicit kind:hot rather than promoting it to an authoritative pass", async () => {
    const id = await connectedId();
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/sync`,
      payload: { kind: "hot" },
    });
    expect(res.statusCode).toBe(202);
    const rows = await app.db.execute(
      sql`select data from pgboss.job
          where name = ${HEALTH_SYNC_CONNECTION_QUEUE} and singleton_key = ${id}
          order by created_on desc limit 1`,
    );
    const data = (rows.rows[0] as { data: { requestedKind?: string; trigger?: string } }).data;
    expect(data.requestedKind).toBe("hot");
    expect(data.trigger).toBe("manual");
  });

  it("carries no token and no health value in the job payload", async () => {
    const id = await connectedId();
    await app.inject({ method: "POST", url: `/health-connections/${id}/sync` });
    const rows = await app.db.execute(
      sql`select data::text as d from pgboss.job
          where name = ${HEALTH_SYNC_CONNECTION_QUEUE} and singleton_key = ${id} limit 1`,
    );
    const d = (rows.rows[0] as { d: string }).d;
    expect(d).not.toMatch(/ya29\.|1\/\/|access_token|refresh_token|ciphertext/i);
  });

  it("409s when the connection is not active", async () => {
    const id = await connectedId();
    await app.db
      .update(healthConnections)
      .set({ status: "needs_reauth" })
      .where(eq(healthConnections.id, id));
    const res = await app.inject({ method: "POST", url: `/health-connections/${id}/sync` });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("connection_not_active");
  });

  it("404s for an unknown connection", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/health-connections/11111111-1111-4111-8111-111111111111/sync",
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /health-connections/:id/sync-runs", () => {
  it("returns runs newest-first and never exposes error_message", async () => {
    const id = await connectedId();
    const [stream] = await app.db
      .select()
      .from(healthMetricStreams)
      .where(eq(healthMetricStreams.metric, "steps"));
    for (const [i, metric] of ["steps", "distance"].entries()) {
      await app.db.insert(healthSyncRuns).values({
        connectionId: id,
        streamId: stream!.id,
        metric,
        kind: "warm",
        rangeStartDate: "2026-08-01",
        rangeEndDate: "2026-08-02",
        status: "succeeded",
        startedAt: new Date(Date.UTC(2026, 7, 20 + i)),
      });
    }
    const res = await app.inject({ method: "GET", url: `/health-connections/${id}/sync-runs` });
    expect(res.statusCode).toBe(200);
    const items = res.json<{ items: { metric: string }[] }>().items;
    expect(items.map((r) => r.metric)).toEqual(["distance", "steps"]);
    // HealthSyncRunSchema deliberately omits error_message: it is free text
    // and must never reach a client.
    expect(res.body).not.toContain("error_message");
  });
});

describe("backfill routes", () => {
  async function streamRow(connectionId: string, metric: string) {
    const [row] = await app.db
      .select()
      .from(healthMetricStreams)
      .where(
        and(
          eq(healthMetricStreams.connectionId, connectionId),
          eq(healthMetricStreams.metric, metric),
        ),
      );
    return row!;
  }

  it("starts a backfill, setting status/target/cursor together", async () => {
    const id = await connectedId();
    await app.db
      .update(healthMetricStreams)
      .set({ earliestVerifiedDate: "2026-07-01" })
      .where(
        and(eq(healthMetricStreams.connectionId, id), eq(healthMetricStreams.metric, "steps")),
      );
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/steps/backfill`,
      payload: { target_date: "2026-01-01" },
    });
    expect(res.statusCode).toBe(200);
    const row = await streamRow(id, "steps");
    expect(row.backfillStatus).toBe("running");
    expect(row.backfillTargetDate).toBe("2026-01-01");
    expect(row.backfillCursorDate).toBe("2026-07-01");
    expect(row.backfillCancelRequested).toBe(false);
  });

  it("cancel sets only the flag, leaving the run for the worker to settle", async () => {
    const id = await connectedId();
    await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/steps/backfill`,
      payload: { target_date: "2026-01-01" },
    });
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/steps/backfill/cancel`,
    });
    expect(res.statusCode).toBe(200);
    const row = await streamRow(id, "steps");
    expect(row.backfillCancelRequested).toBe(true);
    expect(row.backfillStatus).toBe("running");
  });

  it("409s a cancel when nothing is running", async () => {
    const id = await connectedId();
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/steps/backfill/cancel`,
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("backfill_not_running");
  });

  it("409s heart-rate-intraday structurally, by acquisition mode", async () => {
    const id = await connectedId();
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/heart-rate-intraday/backfill`,
      payload: { target_date: "2026-01-01" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("metric_out_of_scope");
  });

  it("409s a target that is not strictly older than the verified frontier", async () => {
    const id = await connectedId();
    await app.db
      .update(healthMetricStreams)
      .set({ earliestVerifiedDate: "2026-07-01" })
      .where(
        and(eq(healthMetricStreams.connectionId, id), eq(healthMetricStreams.metric, "steps")),
      );
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/steps/backfill`,
      payload: { target_date: "2026-08-01" },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json<{ error: string }>().error).toBe("backfill_target_not_in_past");
  });

  it("404s an unknown metric", async () => {
    const id = await connectedId();
    const res = await app.inject({
      method: "POST",
      url: `/health-connections/${id}/streams/not-a-metric/backfill`,
      payload: { target_date: "2026-01-01" },
    });
    expect(res.statusCode).toBe(404);
  });
});
