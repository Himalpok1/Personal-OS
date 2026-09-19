import { generatePairingCode, hashPairingCode } from "@personal-os/core";
import { devicePairingCodes } from "@personal-os/db";
import {
  AgentRegisterResponseSchema,
  type Agent,
  type AgentPermission,
  type AgentTrustLevel,
} from "@personal-os/schema";
import type { FastifyInstance } from "fastify";
import { expect } from "vitest";

// Shared fixtures for the Agent Gateway suites (Checkpoint 10.9). Every
// helper goes through the REAL routes -- a pairing code minted the way
// generate-pairing-code.ts mints one, `POST /devices`, `POST /agents`,
// `PATCH /permissions/agent/:permission` -- never a bypass, so what a test
// proves is what production does.

/** Pairs a fresh device through the pairing-code route and returns its bearer token. */
export async function pairTestDevice(app: FastifyInstance, name = "Test device"): Promise<string> {
  const code = generatePairingCode();
  await app.db
    .insert(devicePairingCodes)
    .values({ codeHash: hashPairingCode(code), expiresAt: new Date(Date.now() + 15 * 60_000) });
  const response = await app.inject({
    method: "POST",
    url: "/devices",
    payload: { name, platform: "android", pairing_code: code },
  });
  expect(response.statusCode, response.body).toBe(201);
  return response.json<{ token: string }>().token;
}

export async function registerTestAgent(
  app: FastifyInstance,
  deviceToken: string,
  options: { name?: string; trust_level: AgentTrustLevel },
): Promise<{ agent: Agent; token: string }> {
  const response = await app.inject({
    method: "POST",
    url: "/agents",
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: { name: options.name ?? "Test agent", trust_level: options.trust_level },
  });
  expect(response.statusCode, response.body).toBe(201);
  return AgentRegisterResponseSchema.parse(response.json());
}

export async function grantAgentPermission(
  app: FastifyInstance,
  deviceToken: string,
  permission: AgentPermission,
  granted = true,
): Promise<{ cancelled_pending: number }> {
  const response = await app.inject({
    method: "PATCH",
    url: `/permissions/agent/${permission}`,
    headers: { authorization: `Bearer ${deviceToken}` },
    payload: { granted },
  });
  expect(response.statusCode, response.body).toBe(200);
  return response.json<{ cancelled_pending: number }>();
}

export function agentHeaders(token: string): { authorization: string } {
  return { authorization: `Bearer ${token}` };
}
