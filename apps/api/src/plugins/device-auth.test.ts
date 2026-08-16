import { generateDeviceToken, hashDeviceToken } from "@personal-os/core";
import { devices } from "@personal-os/db";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateTestTables } from "../test/build-test-app.js";
import { registerDb } from "./db.js";
import { deviceAuthPreHandler } from "./device-auth.js";

// A minimal throwaway app with one dummy route behind the preHandler --
// isolates the plugin's own behavior (request.device population,
// last_seen_at bump) from the full route surface devices.test.ts already
// covers end-to-end.
async function buildThrowawayApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerDb(app);
  app.get("/protected", { preHandler: deviceAuthPreHandler }, (request) => ({
    deviceId: request.device?.id,
  }));
  return app;
}

describe("deviceAuthPreHandler", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await buildThrowawayApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await truncateTestTables(app);
  });

  it("401s with no Authorization header", async () => {
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("401s with a malformed Authorization header (no Bearer prefix)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "sometoken" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("401s with a token matching no device", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer nonexistent" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("401s for a revoked device", async () => {
    const token = generateDeviceToken();
    await app.db.insert(devices).values({
      name: "x",
      platform: "android",
      tokenHash: hashDeviceToken(token),
      revokedAt: new Date(),
    });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "device_revoked" });
  });

  it("succeeds for a valid token, populates request.device, and bumps last_seen_at", async () => {
    const token = generateDeviceToken();
    const [inserted] = await app.db
      .insert(devices)
      .values({ name: "x", platform: "android", tokenHash: hashDeviceToken(token) })
      .returning();
    expect(inserted?.lastSeenAt).toBeNull();

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ deviceId: inserted?.id });

    const [after] = await app.db.select().from(devices).where(eq(devices.id, inserted!.id));
    expect(after?.lastSeenAt).not.toBeNull();
  });
});
