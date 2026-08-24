import { decryptSecret, encryptSecret } from "@personal-os/ai-providers";
import { healthConnections, healthOauthStates } from "@personal-os/db";
import {
  createFakeGoogleHealthClient,
  GoogleHealthOAuthError,
} from "@personal-os/health-providers";
import { eq } from "drizzle-orm";
import type { FastifyInstance } from "fastify";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import {
  assertAllowedRedirectUri,
  consumeOAuthState,
  createOAuthState,
  disconnectHealthConnection,
  getHealthOAuthConfig,
  InvalidRedirectUriError,
  InvalidStateError,
  isHealthConfigured,
  markNeedsReauth,
  resolveFreshAccessToken,
  sweepExpiredOAuthStates,
} from "./health-connection.js";

const REDIRECT = "https://personal-os.tail62a68f.ts.net/health-connections/google/callback";
const ALT_REDIRECT = "https://alt.example.ts.net/health-connections/google/callback";
const KEY = process.env["CREDENTIALS_ENCRYPTION_KEY"]!;

let app: FastifyInstance;

beforeAll(async () => {
  app = await buildTestApp({ googleHealthClient: createFakeGoogleHealthClient() });
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

/** Inserts a connection directly, so token-lifecycle tests need no OAuth flow. */
async function seedConnection(over: Record<string, unknown> = {}) {
  const access = encryptSecret("stale-access-token", KEY);
  const refresh = encryptSecret("stored-refresh-token", KEY);
  const [row] = await app.db
    .insert(healthConnections)
    .values({
      provider: "google_health",
      healthUserId: "hu-primary",
      accessTokenCiphertext: access.ciphertext,
      accessTokenIv: access.iv,
      accessTokenAuthTag: access.authTag,
      // Already expired, so any call must refresh.
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
      refreshTokenCiphertext: refresh.ciphertext,
      refreshTokenIv: refresh.iv,
      refreshTokenAuthTag: refresh.authTag,
      grantedScope: "scope",
      ...over,
    })
    .returning();
  return row!;
}

describe("configuration", () => {
  it("reports configured in the test environment", () => {
    expect(isHealthConfigured()).toBe(true);
    expect(getHealthOAuthConfig().allowedRedirectUris).toContain(REDIRECT);
  });

  it("treats the allowlist as exact, with no normalization", () => {
    const config = getHealthOAuthConfig();
    expect(() => assertAllowedRedirectUri(config, REDIRECT)).not.toThrow();
    for (const bad of [
      REDIRECT + "/",
      REDIRECT.toUpperCase(),
      REDIRECT.replace("https", "http"),
      REDIRECT + "?x=1",
      " " + REDIRECT,
    ]) {
      expect(() => assertAllowedRedirectUri(config, bad), bad).toThrow(InvalidRedirectUriError);
    }
  });

  it("says nothing about what WAS allowed when rejecting", () => {
    try {
      assertAllowedRedirectUri(getHealthOAuthConfig(), "https://evil.example.com/cb");
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).not.toContain("tail62a68f");
      expect((err as Error).message).not.toContain("evil.example.com");
    }
  });
});

describe("OAuth state", () => {
  it("stores only a hash and never the raw state", async () => {
    const { state } = await createOAuthState(app.db, REDIRECT);
    const [row] = await app.db.select().from(healthOauthStates);
    expect(row!.stateHash).not.toBe(state);
    expect(row!.stateHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("mints high-entropy values", async () => {
    const a = await createOAuthState(app.db, REDIRECT);
    const b = await createOAuthState(app.db, REDIRECT);
    expect(a.state).not.toBe(b.state);
    // 32 random bytes, base64url -> 43 chars.
    expect(a.state.length).toBeGreaterThanOrEqual(43);
  });

  it("consumes exactly once", async () => {
    const { state } = await createOAuthState(app.db, REDIRECT);
    await expect(consumeOAuthState(app.db, state, REDIRECT)).resolves.toBeUndefined();
    await expect(consumeOAuthState(app.db, state, REDIRECT)).rejects.toThrow(InvalidStateError);
  });

  // Two concurrent callbacks racing on one state: the atomic
  // UPDATE ... WHERE consumed_at IS NULL ... RETURNING means exactly one wins.
  it("survives a concurrent double-consume with exactly one winner", async () => {
    const { state } = await createOAuthState(app.db, REDIRECT);
    const results = await Promise.allSettled([
      consumeOAuthState(app.db, state, REDIRECT),
      consumeOAuthState(app.db, state, REDIRECT),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("rejects an unknown state", async () => {
    await expect(consumeOAuthState(app.db, "never-issued", REDIRECT)).rejects.toThrow(
      InvalidStateError,
    );
  });

  it("rejects an expired state", async () => {
    const { state } = await createOAuthState(app.db, REDIRECT);
    await app.db.update(healthOauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    await expect(consumeOAuthState(app.db, state, REDIRECT)).rejects.toThrow(/expired/);
  });

  // A state minted for one allowlisted redirect must not be replayable against
  // another allowlisted redirect.
  it("is bound to the redirect it was issued for", async () => {
    const { state } = await createOAuthState(app.db, REDIRECT);
    await expect(consumeOAuthState(app.db, state, ALT_REDIRECT)).rejects.toThrow(
      /different redirect_uri/,
    );
  });

  it("sweeps expired states and leaves live ones", async () => {
    await createOAuthState(app.db, REDIRECT);
    await app.db.update(healthOauthStates).set({ expiresAt: new Date(Date.now() - 1000) });
    await createOAuthState(app.db, REDIRECT);
    expect(await sweepExpiredOAuthStates(app.db)).toBe(1);
    expect(await app.db.select().from(healthOauthStates)).toHaveLength(1);
  });
});

describe("access-token refresh", () => {
  it("refreshes an expired token and stores the new one encrypted", async () => {
    const connection = await seedConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "fresh-access-token",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await resolveFreshAccessToken(app.db, connection);
    expect(result.accessToken).toBe("fresh-access-token");

    const [row] = await app.db.select().from(healthConnections);
    expect(row!.accessTokenCiphertext!.toString("utf8")).not.toContain("fresh-access-token");
    expect(
      decryptSecret(
        {
          ciphertext: row!.accessTokenCiphertext!,
          iv: row!.accessTokenIv!,
          authTag: row!.accessTokenAuthTag!,
        },
        KEY,
      ),
    ).toBe("fresh-access-token");
    expect(row!.accessTokenExpiresAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("does not overwrite the stored refresh token on refresh", async () => {
    const connection = await seedConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "a2",
            refresh_token: "rotated",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
          }),
          { status: 200 },
        ),
      ),
    );
    await resolveFreshAccessToken(app.db, connection);
    const [row] = await app.db.select().from(healthConnections);
    expect(
      decryptSecret(
        {
          ciphertext: row!.refreshTokenCiphertext!,
          iv: row!.refreshTokenIv!,
          authTag: row!.refreshTokenAuthTag!,
        },
        KEY,
      ),
    ).toBe("stored-refresh-token");
  });

  it("reuses a still-fresh token without calling Google", async () => {
    const connection = await seedConnection({
      accessTokenExpiresAt: new Date(Date.now() + 30 * 60_000),
    });
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    const result = await resolveFreshAccessToken(app.db, connection);
    expect(result.accessToken).toBe("stale-access-token");
    expect(f).not.toHaveBeenCalled();
  });

  // A dead grant must be recorded, not retried forever.
  it("marks needs_reauth on invalid_grant and rethrows as permanent", async () => {
    const connection = await seedConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: "invalid_grant", error_description: "expired" }), {
          status: 400,
        }),
      ),
    );

    await expect(resolveFreshAccessToken(app.db, connection)).rejects.toSatisfy(
      (err) => err instanceof GoogleHealthOAuthError && err.isPermanent,
    );

    const [row] = await app.db.select().from(healthConnections);
    expect(row!.status).toBe("needs_reauth");
    expect(row!.lastSyncError).toContain("invalid_grant");
    expect(row!.lastSyncErrorAt).not.toBeNull();
  });

  it("does NOT mark needs_reauth on a transient 5xx", async () => {
    const connection = await seedConnection();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 503 })));
    await expect(resolveFreshAccessToken(app.db, connection)).rejects.toThrow();
    const [row] = await app.db.select().from(healthConnections);
    expect(row!.status).toBe("active");
  });

  it("marks needs_reauth when no refresh token is stored at all", async () => {
    const connection = await seedConnection({
      refreshTokenCiphertext: null,
      refreshTokenIv: null,
      refreshTokenAuthTag: null,
    });
    await expect(resolveFreshAccessToken(app.db, connection)).rejects.toThrow();
    const [row] = await app.db.select().from(healthConnections);
    expect(row!.status).toBe("needs_reauth");
  });
});

describe("markNeedsReauth", () => {
  it("records the reason and timestamp", async () => {
    const connection = await seedConnection();
    await markNeedsReauth(app.db, connection.id, "test reason");
    const [row] = await app.db
      .select()
      .from(healthConnections)
      .where(eq(healthConnections.id, connection.id));
    expect(row!.status).toBe("needs_reauth");
    expect(row!.lastSyncError).toBe("test reason");
  });
});

describe("disconnect", () => {
  it("clears credentials even when the stored token cannot be decrypted", async () => {
    // Simulates a rotated CREDENTIALS_ENCRYPTION_KEY: decryption throws, and a
    // user must still be able to disconnect.
    const connection = await seedConnection({
      refreshTokenCiphertext: Buffer.from("not-valid-ciphertext"),
    });
    const result = await disconnectHealthConnection(app.db, connection);
    expect(result.revoked).toBe(false);
    expect(result.connection.status).toBe("disconnected");
    expect(result.connection.refreshTokenCiphertext).toBeNull();
  });
});

describe("no credential ever reaches a queue payload", () => {
  it("performs no job enqueue during the whole connect path", async () => {
    // 6.2 introduces no worker jobs at all; this pins that, so a future change
    // cannot start shipping a token through pg-boss unnoticed.
    const send = vi.spyOn(app.boss, "send");
    const connection = await seedConnection();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            access_token: "a",
            expires_in: 3600,
            token_type: "Bearer",
            scope: "s",
          }),
          { status: 200 },
        ),
      ),
    );
    await resolveFreshAccessToken(app.db, connection);
    await disconnectHealthConnection(app.db, connection);
    expect(send).not.toHaveBeenCalled();
    send.mockRestore();
  });
});
