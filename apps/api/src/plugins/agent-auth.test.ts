import {
  AGENT_TOKEN_PREFIX as CORE_AGENT_TOKEN_PREFIX,
  generateAgentToken,
  generateDeviceToken,
  hashAgentToken,
  hashDeviceToken,
} from "@personal-os/core";
import { agents, devices } from "@personal-os/db";
import { AGENT_TOKEN_PREFIX } from "@personal-os/schema";
import { eq } from "drizzle-orm";
import Fastify, { type FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { truncateTestTables } from "../test/build-test-app.js";
import { agentAuthPreHandler } from "./agent-auth.js";
import { registerDb } from "./db.js";

// A minimal throwaway app with one dummy route behind the preHandler --
// the device-auth.test.ts idiom -- isolating the plugin's own behaviour
// (request.agent population, last_seen_at bump, the token-shape and
// cross-table refusals) from the full route surface agent.test.ts covers.
async function buildThrowawayApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });
  registerDb(app);
  app.get("/protected", { preHandler: agentAuthPreHandler }, (request) => ({
    agentId: request.agent?.id,
  }));
  return app;
}

async function insertAgent(
  app: FastifyInstance,
  token: string,
  overrides: Partial<typeof agents.$inferInsert> = {},
) {
  const [row] = await app.db
    .insert(agents)
    .values({
      name: "x",
      trustLevel: "read",
      tokenHash: hashAgentToken(token),
      disclosureVersion: "2026-09-18",
      ...overrides,
    })
    .returning();
  return row!;
}

describe("agentAuthPreHandler", () => {
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

  it("the schema's AGENT_TOKEN_PREFIX equals core's, so what the wire promises is what the hash side checks", () => {
    expect(AGENT_TOKEN_PREFIX).toBe(CORE_AGENT_TOKEN_PREFIX);
    expect(generateAgentToken().startsWith(AGENT_TOKEN_PREFIX)).toBe(true);
  });

  it("401s unauthorized with no Authorization header", async () => {
    const response = await app.inject({ method: "GET", url: "/protected" });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("401s unauthorized with a malformed Authorization header (no Bearer prefix)", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: generateAgentToken() },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "unauthorized" });
  });

  it("401s invalid_token for a value that does not look like an agent token, before any hash lookup", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: "Bearer nonexistent" },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("401s invalid_token for the bare posa_ prefix alone", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${AGENT_TOKEN_PREFIX}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("401s invalid_token for a well-formed agent token matching no agent", async () => {
    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${generateAgentToken()}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("401s invalid_token for a VALID DEVICE token -- the two principals never share a table", async () => {
    const deviceToken = generateDeviceToken();
    await app.db
      .insert(devices)
      .values({ name: "x", platform: "android", tokenHash: hashDeviceToken(deviceToken) });
    // Even if the device token were stored as an agent hash by mistake, the
    // shape check refuses it first: a device token carries no prefix.
    await insertAgent(app, deviceToken);

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${deviceToken}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "invalid_token" });
  });

  it("401s agent_revoked for a revoked agent", async () => {
    const token = generateAgentToken();
    await insertAgent(app, token, { revokedAt: new Date() });

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(401);
    expect(response.json()).toEqual({ error: "agent_revoked" });
  });

  it("succeeds for a valid token, populates request.agent, and bumps last_seen_at", async () => {
    const token = generateAgentToken();
    const inserted = await insertAgent(app, token);
    expect(inserted.lastSeenAt).toBeNull();

    const response = await app.inject({
      method: "GET",
      url: "/protected",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ agentId: inserted.id });

    const [after] = await app.db.select().from(agents).where(eq(agents.id, inserted.id));
    expect(after?.lastSeenAt).not.toBeNull();
  });
});
