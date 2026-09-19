import { aiModels, aiProviderConnections, aiTaskRoutes } from "@personal-os/db";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildTestApp, truncateTestTables } from "../test/build-test-app.js";
import {
  askRouteEnabled,
  assertGrant,
  authorizeAgentRead,
  authorizeCloudAsk,
  AskUnauthorizedError,
  consumeGrant,
  type CloudAskGrant,
} from "./authorize.js";

function fakeRequest(id = "req-1"): FastifyRequest {
  return { id } as unknown as FastifyRequest;
}

describe("Cloud Ask authorization (Checkpoint 8.6B)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  async function seedAskRoute(): Promise<string> {
    const [connection] = await app.db
      .insert(aiProviderConnections)
      .values({
        name: "Test provider",
        providerType: "openai_compatible",
        baseUrl: "https://example.invalid/v1",
        apiKeyCiphertext: Buffer.from("ciphertext"),
        apiKeyIv: Buffer.from("iv"),
        apiKeyAuthTag: Buffer.from("authtag"),
      })
      .returning();
    const [model] = await app.db
      .insert(aiModels)
      .values({ providerConnectionId: connection!.id, modelId: "test-model" })
      .returning();
    await app.db.insert(aiTaskRoutes).values({ taskName: "ask", primaryModelId: model!.id });
    return model!.id;
  }

  describe("askRouteEnabled", () => {
    it("is false when no ask row exists", async () => {
      expect(await askRouteEnabled(app.db)).toBe(false);
    });

    it("is true once an ask row exists", async () => {
      await seedAskRoute();
      expect(await askRouteEnabled(app.db)).toBe(true);
    });
  });

  describe("authorizeCloudAsk", () => {
    it("returns null when the switch is off -- no notes/tasks row is read to determine this", async () => {
      const grant = await authorizeCloudAsk(fakeRequest(), app.db);
      expect(grant).toBeNull();
    });

    it("returns a grant bound to the request once the switch is on", async () => {
      await seedAskRoute();
      const request = fakeRequest("req-42");
      const grant = await authorizeCloudAsk(request, app.db);
      expect(grant).not.toBeNull();
      expect(grant!.requestId).toBe("req-42");
      expect(typeof grant!.grantedAt).toBe("string");
    });

    it("a grant it minted passes assertGrant", async () => {
      await seedAskRoute();
      const grant = await authorizeCloudAsk(fakeRequest(), app.db);
      expect(() => assertGrant(grant)).not.toThrow();
    });
  });

  describe("assertGrant", () => {
    it("rejects null, undefined, a string and a plain object -- nothing forges membership", () => {
      for (const forged of [null, undefined, "grant", 42, {}]) {
        expect(() => assertGrant(forged)).toThrow(AskUnauthorizedError);
      }
    });

    it("rejects a STRUCTURALLY IDENTICAL look-alike object -- membership is by identity, not shape", async () => {
      await seedAskRoute();
      const real = await authorizeCloudAsk(fakeRequest(), app.db);
      assertGrant(real);
      const forged: CloudAskGrant = { requestId: real.requestId, grantedAt: real.grantedAt };
      expect(() => assertGrant(forged)).toThrow(AskUnauthorizedError);
    });

    it("rejects a value cast through unknown -- the type assertion has no runtime effect", () => {
      const forged = { requestId: "x", grantedAt: "y" } as unknown as CloudAskGrant;
      expect(() => assertGrant(forged)).toThrow(AskUnauthorizedError);
    });
  });

  describe("consumeGrant", () => {
    it("makes a grant single-use -- assertGrant fails on it after consumption", async () => {
      await seedAskRoute();
      const grant = await authorizeCloudAsk(fakeRequest(), app.db);
      assertGrant(grant);
      consumeGrant(grant);
      expect(() => assertGrant(grant)).toThrow(AskUnauthorizedError);
    });

    it("two separate authorizations are independent grants", async () => {
      await seedAskRoute();
      const first = await authorizeCloudAsk(fakeRequest("a"), app.db);
      const second = await authorizeCloudAsk(fakeRequest("b"), app.db);
      assertGrant(first);
      consumeGrant(first);
      expect(() => assertGrant(first)).toThrow(AskUnauthorizedError);
      expect(() => assertGrant(second)).not.toThrow();
    });
  });

  describe("authorizeAgentRead (Checkpoint 10.9)", () => {
    const live = { id: "agent-1", trustLevel: "read", revokedAt: null };

    it("mints a grant for a live read or propose agent whose permission is granted -- without an ask row", async () => {
      expect(await askRouteEnabled(app.db)).toBe(false);
      for (const trustLevel of ["read", "propose"]) {
        const grant = await authorizeAgentRead(fakeRequest(), { ...live, trustLevel }, true);
        expect(grant).not.toBeNull();
        expect(() => assertGrant(grant)).not.toThrow();
        expect(Object.isFrozen(grant)).toBe(true);
      }
    });

    it("returns null for a paused, revoked or ungranted agent, and for a request without an id", async () => {
      expect(
        await authorizeAgentRead(fakeRequest(), { ...live, trustLevel: "none" }, true),
      ).toBeNull();
      expect(
        await authorizeAgentRead(fakeRequest(), { ...live, trustLevel: "operator" }, true),
      ).toBeNull();
      expect(
        await authorizeAgentRead(fakeRequest(), { ...live, revokedAt: new Date() }, true),
      ).toBeNull();
      expect(await authorizeAgentRead(fakeRequest(), live, false)).toBeNull();
      expect(await authorizeAgentRead(fakeRequest(""), live, true)).toBeNull();
    });

    it("a structural look-alike of an agent grant still fails assertGrant", async () => {
      const real = await authorizeAgentRead(fakeRequest(), live, true);
      expect(real).not.toBeNull();
      const forged = { requestId: real!.requestId, grantedAt: real!.grantedAt };
      expect(() => assertGrant(forged)).toThrow(AskUnauthorizedError);
      consumeGrant(real!);
      expect(() => assertGrant(real)).toThrow(AskUnauthorizedError);
    });
  });
});
